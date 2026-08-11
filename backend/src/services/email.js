'use strict';

const nodemailer = require('nodemailer');

const REQUIRED_ENV_VARS = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM'];

function assertEnv() {
    const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
    if (missing.length) {
        throw new Error(`[email] Missing required env vars: ${missing.join(', ')}`);
    }
}

const MAX_CONCURRENT = parseInt(process.env.EMAIL_MAX_CONCURRENT, 10) || 3;

let transporter;

function getTransporter() {
    if (transporter) return transporter;

    assertEnv();

    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT, 10) || 587,
        secure: false,        // false for port 587 (STARTTLS)
        requireTLS: true,

        // --- concurrency control lives here ---
        pool: true,                    // reuse + queue connections instead of opening one per mail
        maxConnections: MAX_CONCURRENT, // hard cap: never more than 3 simultaneous SMTP connections
        maxMessages: 100,              // recycle a connection after 100 sends (avoids stale/idle drops)

        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    // Surface pool-level events so throttling is visible in logs, not silent
    transporter.on('error', (err) => {
        console.error('[email] Transporter error:', err.message);
    });

    return transporter;
}

async function verifyEmailConnection() {
    if (!process.env.EMAIL_HOST) {
        console.warn('[email] EMAIL_HOST not set — email sending is disabled.');
        return false;
    }
    try {
        await getTransporter().verify();
        console.log(`[email] SMTP connection verified — pooled, max ${MAX_CONCURRENT} concurrent connections`);
        return true;
    } catch (err) {
        console.warn('[email] SMTP transporter not reachable:', err.code || err.message);
        return false;
    }
}


function stripHtml(html = '') {
    return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Core send function. Never throws — a failed email must never break
 * the API request that triggered it (e.g. a plan submission should
 * still succeed even if the notification email fails).
 *
 * Callers get back { success, error } and decide what to do with it.
 */
async function sendMail({ to, cc, subject, html, text, logLabel = 'Notification' }) {
    if (!to) {
        console.warn(`[email] Skipped "${subject}" — no recipient provided`);
        return { success: false, error: 'Missing recipient' };
    }

    // Dev safety net — don't spam real inboxes while developing/testing locally
    // if (process.env.NODE_ENV !== 'production' && process.env.FORCE_EMAIL_SEND !== 'true') {
    //     console.log(`[email:dev] Would send "${subject}" to ${to}${cc ? ` (cc: ${cc})` : ''} — set FORCE_EMAIL_SEND=true to actually send`);
    //     return { success: true, skipped: true };
    // }

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
        text: text || stripHtml(html),
    };
    if (cc) mailOptions.cc = cc;

    try {
        const info = await getTransporter().sendMail(mailOptions);
        console.log(`[email] "${logLabel}" sent to ${to} (messageId: ${info.messageId})`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error(`[email] FAILED "${logLabel}" to ${to}: ${err.code || ''} ${err.message}`);
        return { success: false, error: err.message, code: err.code };
    }
}

module.exports = { getTransporter, verifyEmailConnection, sendMail, MAX_CONCURRENT };
