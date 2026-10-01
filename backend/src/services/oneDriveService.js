'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  oneDriveService — file storage for Manual PDFs, backed by Microsoft Graph.
//
//  This is the ONLY module that knows OneDrive exists. Controllers call
//  uploadManualFile / getFileStream / deleteFile and never touch Graph URLs,
//  tokens or retry logic — so swapping storage later (SharePoint, S3, Azure
//  Blob) means rewriting this one file, not the controller.
//
//  AUTH
//    App-only (client-credentials) flow via @azure/msal-node. No user ever
//    signs in to Microsoft; the backend authenticates as an Azure AD app
//    registration. MSAL caches the access token in memory and refreshes it
//    before expiry, so we don't hit the token endpoint on every request.
//
//  ADDRESSING
//    Every call targets an explicit drive: /drives/{driveId}/... — the drive
//    is a configuration value (ONEDRIVE_DRIVE_ID), because an app-only token
//    has no "me" drive. Files are referenced afterwards by driveId + itemId
//    (stable even if the file is renamed or moved), never by path.
//
//  UPLOAD
//    ≤ 4 MB  → single PUT (Graph's limit for simple uploads)
//    > 4 MB  → resumable upload session, sent in 10 MiB chunks
//    On-drive names are random UUIDs (never the user's filename), so uploads
//    can never collide and user input never reaches a Graph URL.
//
//  RESILIENCE
//    Timeouts on every request; automatic retry with exponential backoff on
//    429 / 502 / 503 / 504 and network errors (honouring Retry-After); one
//    transparent token refresh on 401.
//
//  REQUIRED ENV
//    AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_DRIVE_ID
//  OPTIONAL ENV
//    ONEDRIVE_MANUALS_FOLDER  (default "PES/Manuals" — use a different value
//                              per environment, e.g. "PES/Manuals-dev")
//
//  Requires Node 18+ (global fetch / AbortSignal.timeout).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { Readable } = require('stream');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

const SIMPLE_UPLOAD_MAX_BYTES = 4_000_000; // Graph: single-request uploads are limited to 4 MB
const UPLOAD_CHUNK_BYTES = 32 * 320 * 1024; // 10 MiB — Graph requires a multiple of 320 KiB


const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30_000;
const API_TIMEOUT_MS = 30_000; // metadata calls
const TRANSFER_TIMEOUT_MS = 120_000; // file upload / download calls
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/* ─── Error type ─────────────────────────────────────────────────────────── */

class OneDriveError extends Error {
    constructor(message, { status = 502, code = 'onedrive_error', requestId = null, cause } = {}) {
        super(message, { cause });
        this.name = 'OneDriveError';
        this.status = status; // HTTP status returned by Graph (or a synthetic one)
        this.code = code; // Graph error code, or one of our own (not_configured, network_error, auth_failed)
        this.requestId = requestId; // Graph "request-id" header — quote this to Microsoft support
    }
}

/* ─── Configuration ──────────────────────────────────────────────────────── */

let cachedConfig = null;

function getConfig() {
    if (cachedConfig) return cachedConfig;

    const required = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'ONEDRIVE_DRIVE_ID'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new OneDriveError(
            `OneDrive storage is not configured. Missing environment variables: ${missing.join(', ')}`,
            { status: 503, code: 'not_configured' },
        );
    }

    const folder = process.env.ONEDRIVE_MANUALS_FOLDER || 'PES/Manuals';
    cachedConfig = {
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        driveId: process.env.ONEDRIVE_DRIVE_ID,
        // Pre-encoded so it can be dropped straight into a Graph URL.
        folderPath: folder
            .split('/')
            .map((segment) => segment.trim())
            .filter(Boolean)
            .map(encodeURIComponent)
            .join('/'),
    };
    return cachedConfig;
}

/** True when all required env vars are present. Handy for a startup check. */
function isConfigured() {
    try {
        getConfig();
        return true;
    } catch {
        return false;
    }
}

/* ─── Authentication ─────────────────────────────────────────────────────── */

let msalClient = null;

async function getAccessToken(forceRefresh = false) {
    const config = getConfig();
    if (!msalClient) {
        msalClient = new ConfidentialClientApplication({
            auth: {
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                authority: `https://login.microsoftonline.com/${config.tenantId}`,
            },
        });
    }

    try {
        const result = await msalClient.acquireTokenByClientCredential({
            scopes: GRAPH_SCOPES,
            skipCache: forceRefresh,
        });
        if (!result?.accessToken) {
            throw new Error('Token response contained no access token');
        }
        return result.accessToken;
    } catch (err) {
        throw new OneDriveError(`Could not authenticate with Microsoft Graph: ${err.message}`, {
            status: 502,
            code: 'auth_failed',
            cause: err,
        });
    }
}

/* ─── HTTP helper ────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt) {
    return Math.min(500 * 2 ** attempt, 8_000) + Math.random() * 250;
}

function retryAfterMs(response) {
    const seconds = Number(response.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : null;
}

// Frees the socket for a response we're not going to read.
async function discardBody(response) {
    try {
        await response.body?.cancel();
    } catch {
        /* nothing to clean up */
    }
}

async function toOneDriveError(response) {
    let code = 'graph_error';
    let detail = response.statusText;
    try {
        const payload = await response.json();
        if (payload?.error) {
            code = payload.error.code || code;
            detail = payload.error.message || detail;
        }
    } catch {
        /* body wasn't JSON — keep the status text */
    }
    return new OneDriveError(`OneDrive request failed (${response.status} ${code}): ${detail}`, {
        status: response.status,
        code,
        requestId: response.headers.get('request-id'),
    });
}

/**
 * fetch() wrapper: auth header, timeout, retry/backoff, error normalisation.
 * Resolves with the (successful) Response, throws OneDriveError otherwise.
 *
 * `authenticated: false` is used for upload-session URLs — those are
 * pre-authorised by Graph and must NOT receive an Authorization header.
 * Bodies are always Buffers, so a retry can safely resend them.
 */
async function graphFetch(
    url,
    { method = 'GET', headers = {}, body, authenticated = true, timeoutMs = API_TIMEOUT_MS } = {},
) {
    let attempt = 0;
    let forceTokenRefresh = false;
    let tokenAlreadyRefreshed = false;

    for (; ;) {
        const requestHeaders = { ...headers };
        if (authenticated) {
            requestHeaders.Authorization = `Bearer ${await getAccessToken(forceTokenRefresh)}`;
        }

        let response;
        try {
            response = await fetch(url, {
                method,
                headers: requestHeaders,
                body,
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                await sleep(backoffMs(attempt));
                attempt += 1;
                continue;
            }
            throw new OneDriveError(`Network error while calling OneDrive: ${err.message}`, {
                status: 504,
                code: 'network_error',
                cause: err,
            });
        }

        if (response.ok) return response;

        // Expired / revoked token: fetch a fresh one exactly once, then retry.
        if (response.status === 401 && authenticated && !tokenAlreadyRefreshed) {
            tokenAlreadyRefreshed = true;
            forceTokenRefresh = true;
            await discardBody(response);
            continue;
        }

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
            const wait = retryAfterMs(response) ?? backoffMs(attempt);
            attempt += 1;
            await discardBody(response);
            await sleep(wait);
            continue;
        }

        throw await toOneDriveError(response);
    }
}

/* ─── Upload helpers ─────────────────────────────────────────────────────── */

// conflictBehavior=replace is deliberate: names are fresh UUIDs, so it can
// never overwrite someone else's file — but it makes a retry after a lost
// response idempotent instead of failing with 409 nameAlreadyExists.
async function uploadSimple(config, itemPath, buffer) {
    const url =
        `${GRAPH_BASE_URL}/drives/${encodeURIComponent(config.driveId)}/root:/${itemPath}:/content` +
        '?@microsoft.graph.conflictBehavior=replace';

    const response = await graphFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: buffer,
        timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    return response.json();
}

async function uploadInChunks(config, itemPath, buffer) {
    const sessionResponse = await graphFetch(
        `${GRAPH_BASE_URL}/drives/${encodeURIComponent(config.driveId)}/root:/${itemPath}:/createUploadSession`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
        },
    );
    const { uploadUrl } = await sessionResponse.json();
    if (!uploadUrl) {
        throw new OneDriveError('OneDrive did not return an upload session URL.', { code: 'no_upload_url' });
    }

    try {
        const total = buffer.length;
        let start = 0;
        let item = null;

        while (start < total) {
            const end = Math.min(start + UPLOAD_CHUNK_BYTES, total); // exclusive
            const response = await graphFetch(uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
                body: buffer.subarray(start, end),
                authenticated: false,
                timeoutMs: TRANSFER_TIMEOUT_MS,
            });

            if (end === total) {
                item = await response.json(); // final chunk → the created driveItem
            } else {
                await discardBody(response); // 202 Accepted — more chunks expected
            }
            start = end;
        }
        return item;
    } catch (err) {
        // Tell OneDrive to drop the half-finished session so it doesn't linger.
        await graphFetch(uploadUrl, { method: 'DELETE', authenticated: false }).catch(() => { });
        throw err;
    }
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Uploads a PDF buffer to the configured OneDrive folder under a random name.
 * @param {Buffer} buffer
 * @returns {Promise<{ driveId: string, itemId: string, storedFileName: string }>}
 */
async function uploadManualFile(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new OneDriveError('Cannot upload an empty file.', { status: 400, code: 'empty_file' });
    }

    const config = getConfig();
    const storedFileName = `${crypto.randomUUID()}.pdf`;
    const itemPath = [config.folderPath, storedFileName].filter(Boolean).join('/');

    const item =
        buffer.length <= SIMPLE_UPLOAD_MAX_BYTES
            ? await uploadSimple(config, itemPath, buffer)
            : await uploadInChunks(config, itemPath, buffer);

    if (!item?.id) {
        throw new OneDriveError('OneDrive accepted the upload but returned no item id.', { code: 'no_item_id' });
    }

    return {
        driveId: item.parentReference?.driveId || config.driveId,
        itemId: item.id,
        storedFileName,
    };
}

/**
 * Opens a download stream for a stored file. Graph answers with a redirect to
 * a short-lived pre-authenticated URL; fetch follows it server-side, so that
 * URL never reaches the browser and the caller's role check stays in force.
 * @returns {Promise<{ stream: import('stream').Readable }>}
 * @throws {OneDriveError} status 404 if the item no longer exists on the drive
 */
async function getFileStream({ driveId, itemId }) {
    const response = await graphFetch(
        `${GRAPH_BASE_URL}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
        { timeoutMs: TRANSFER_TIMEOUT_MS },
    );
    if (!response.body) {
        throw new OneDriveError('OneDrive returned an empty download response.', { code: 'empty_body' });
    }
    return { stream: Readable.fromWeb(response.body) };
}

/**
 * Deletes a stored file. Graph moves it to the drive's recycle bin, so an
 * accidental delete is recoverable. Already-gone (404) counts as success.
 */
async function deleteFile({ driveId, itemId }) {
    try {
        await graphFetch(
            `${GRAPH_BASE_URL}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
            { method: 'DELETE' },
        );
    } catch (err) {
        if (err instanceof OneDriveError && err.status === 404) return;
        throw err;
    }
}

module.exports = { uploadManualFile, getFileStream, deleteFile, isConfigured, OneDriveError };