'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  MANUAL CONTROLLER
//
//  Six handlers, split between admin-only writes and any-authenticated-role
//  reads:
//    ADMIN-only (mounted in adminRoutes.js, verifyToken + authorizeRoles('ADMIN')):
//      1. uploadManual        — create a new manual (multipart: file + metadata)
//      2. updateManual        — edit metadata, optionally replace the file
//      3. updateManualStatus  — PATCH isActive (soft add/remove), mirrors
//                                adminController.js's updateEmployeeStatus
//      4. listAllManuals      — admin's management table (all roles, incl. inactive)
//    Any authenticated role (mounted in manualRoutes.js, verifyToken only —
//    a single shared implementation instead of duplicating these in
//    employeeController.js AND raController.js):
//      5. listMyManuals       — active manuals visible to the caller's role
//      6. downloadManual      — streams the file; ADMIN bypasses the
//                                active/role check (so admin can preview
//                                anything they manage), everyone else gets
//                                re-checked server-side even though the
//                                frontend already filtered the list, since a
//                                manual id can be bookmarked or guessed
//
//  FILE STORAGE
//    PDFs live in OneDrive (services/oneDriveService.js) — never on this
//    server's disk, never behind express.static. downloadManual is the only
//    way to read one; it proxies the bytes from OneDrive after the role check.
//
//  CONSISTENCY BETWEEN THE DATABASE AND ONEDRIVE
//    These are two systems with no shared transaction, so every write orders
//    its steps so that a failure at ANY point leaves the manual usable:
//      create   : upload file → [DB row + audit log in ONE transaction]
//                 if the transaction fails, the just-uploaded file is deleted
//      replace  : upload new file → [DB update + audit log in ONE transaction]
//                 → only after commit, delete the OLD file (best effort)
//                 if the transaction fails, the NEW file is deleted and the
//                 manual keeps pointing at its old, intact file
//    Worst case (server dies between steps, or a cleanup call fails) is a
//    harmless orphan file in the OneDrive folder — never a manual whose file
//    is missing. Orphans are logged with their drive/item ids.
// ─────────────────────────────────────────────────────────────────────────────

const { pipeline } = require('stream/promises');
const { Op } = require('sequelize');
const { User, Manual, AuditLog } = require('../models');
const oneDrive = require('../services/oneDriveService');

const { OneDriveError } = oneDrive;

/* ─── Which roles a manual can target — single source of truth, mirrors
   adminController.js's ADMIN_TRACKED_ROLES. Extend this (not a DB ENUM) if
   HRD/MD manuals are added later — no migration needed. ────────────────── */
const MANUAL_ROLES = ['EMPLOYEE', 'RA'];

const FIELD_LIMITS = { title: 200, description: 2000, category: 100 };
const MAX_DISPLAY_ORDER = 1_000_000;

// Storage pointers are internal — they must never appear in an API response.
const INTERNAL_FIELDS = ['driveId', 'driveItemId', 'storedFileName'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function validateTargetRoles(targetRoles) {
  return (
    Array.isArray(targetRoles) &&
    targetRoles.length > 0 &&
    targetRoles.every(r => MANUAL_ROLES.includes(r))
  );
}

// Normalizes a multipart body field that may arrive as a single string or
// an array, depending on how the client sends repeated form fields.
function normalizeRoles(raw) {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw : [raw];
}

// Validates + trims one free-text field. Returns { value } or { error }.
// typeof check matters: a repeated multipart field arrives as an array, and
// calling .trim() on it would throw and surface as a 500.
function parseTextField(field, raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: `${field} is required and cannot be empty.` };
  }
  const value = raw.trim();
  if (value.length > FIELD_LIMITS[field]) {
    return { error: `${field} must be at most ${FIELD_LIMITS[field]} characters.` };
  }
  return { value };
}

function parseDisplayOrder(raw) {
  const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isInteger(value) || Math.abs(value) > MAX_DISPLAY_ORDER) {
    return { error: `displayOrder must be a whole number between -${MAX_DISPLAY_ORDER} and ${MAX_DISPLAY_ORDER}.` };
  }
  return { value };
}

// A malformed id would otherwise reach Postgres as an invalid uuid and blow
// up as a 500. Treat it as "not found" — same answer as any other bad id.
const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

// Manual → plain JSON without the internal OneDrive pointers.
function serializeManual(manual) {
  const json = manual.toJSON();
  INTERNAL_FIELDS.forEach((field) => delete json[field]);
  return json;
}

// Best-effort delete of a OneDrive file. NEVER throws — it runs on cleanup
// paths where the real outcome (success or the original error) matters more
// than a failed cleanup. A failure is logged with ids so it can be removed by hand.
async function discardStoredFile({ driveId, itemId }, reason) {
  try {
    await oneDrive.deleteFile({ driveId, itemId });
  } catch (err) {
    console.error(
      `[manualController] could not delete OneDrive file (${reason}) — orphan, remove manually. ` +
      `driveId=${driveId} itemId=${itemId}:`,
      err.message,
    );
  }
}

// One place that turns any error into a safe HTTP response. Storage problems
// become 502/503 with a generic message (Graph details stay in the server
// log); raw error text is only echoed outside production.
function sendError(res, err, handler, fallbackMessage) {
  if (err instanceof OneDriveError) {
    console.error(
      `[manualController] ${handler} — OneDrive error (${err.code}, request-id ${err.requestId || 'n/a'}):`,
      err.message,
    );
    if (err.code === 'not_configured') {
      return res.status(503).json({ message: 'Document storage is not configured. Please contact your administrator.' });
    }
    return res.status(502).json({ message: 'Document storage is temporarily unavailable. Please try again shortly.' });
  }

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({ message: err.errors.map(e => e.message).join('; ') });
  }

  console.error(`[manualController] ${handler} error:`, err);
  const body = { message: fallbackMessage };
  if (process.env.NODE_ENV !== 'production') body.error = err.message;
  return res.status(500).json(body);
}

/* ─── 1. POST /api/admin/manuals ─────────────────────────────────────────── */
exports.uploadManual = async (req, res) => {
  let storedFile = null; // tracked so a failure after upload can undo it
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'A PDF file is required.' });
    }

    const title = parseTextField('title', req.body.title);
    if (title.error) return res.status(400).json({ message: title.error });

    const description = parseTextField('description', req.body.description);
    if (description.error) return res.status(400).json({ message: description.error });

    const category = parseTextField('category', req.body.category);
    if (category.error) return res.status(400).json({ message: category.error });

    const targetRoles = normalizeRoles(req.body.targetRoles) || [];
    if (!validateTargetRoles(targetRoles)) {
      return res.status(400).json({
        message: `targetRoles must be a non-empty array from: ${MANUAL_ROLES.join(', ')}`,
      });
    }

    // 1) File first — if this fails there is nothing to clean up.
    storedFile = await oneDrive.uploadManualFile(req.file.buffer);

    // 2) Row + audit log atomically: both persist or neither does.
    const manual = await Manual.sequelize.transaction(async (transaction) => {
      const created = await Manual.create(
        {
          title: title.value,
          description: description.value,
          category: category.value,
          targetRoles,
          fileName: req.file.originalname,
          driveId: storedFile.driveId,
          driveItemId: storedFile.itemId,
          storedFileName: storedFile.storedFileName,
          fileType: 'PDF',
          fileSizeBytes: req.file.size,
          uploadedBy: req.user.userId,
        },
        { transaction },
      );

      await AuditLog.create(
        {
          userId: req.user.userId,
          action: 'CREATE_MANUAL',
          entityType: 'MANUAL',
          entityId: String(created.id),
          ipAddress: req.ip,
        },
        { transaction },
      );

      return created;
    });

    return res.status(201).json({ message: 'Manual uploaded successfully.', manual: serializeManual(manual) });
  } catch (err) {
    // The DB write failed after the file reached OneDrive — remove the file
    // so we don't leave an unreferenced document behind.
    if (storedFile) {
      await discardStoredFile(
        { driveId: storedFile.driveId, itemId: storedFile.itemId },
        'upload rolled back',
      );
    }
    return sendError(res, err, 'uploadManual', 'Failed to upload manual');
  }
};

/* ─── 2. PATCH /api/admin/manuals/:id ────────────────────────────────────── */
exports.updateManual = async (req, res) => {
  let newFile = null; // replacement file, if one was uploaded
  let committed = false; // once true, the new file is live and must be kept
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(404).json({ message: 'Manual not found' });
    }

    const manual = await Manual.findByPk(id);
    if (!manual) {
      return res.status(404).json({ message: 'Manual not found' });
    }

    // ── Validate everything BEFORE touching OneDrive ─────────────────────
    const body = req.body || {}; // Express 5 leaves req.body undefined when no parser ran
    const changes = {};

    for (const field of ['title', 'description', 'category']) {
      if (body[field] === undefined) continue;
      const parsed = parseTextField(field, body[field]);
      if (parsed.error) return res.status(400).json({ message: parsed.error });
      changes[field] = parsed.value;
    }

    const targetRoles = normalizeRoles(body.targetRoles);
    if (targetRoles !== undefined) {
      if (!validateTargetRoles(targetRoles)) {
        return res.status(400).json({
          message: `targetRoles must be a non-empty array from: ${MANUAL_ROLES.join(', ')}`,
        });
      }
      changes.targetRoles = targetRoles;
    }

    if (body.displayOrder !== undefined) {
      const parsed = parseDisplayOrder(body.displayOrder);
      if (parsed.error) return res.status(400).json({ message: parsed.error });
      changes.displayOrder = parsed.value;
    }

    if (Object.keys(changes).length === 0 && !req.file) {
      return res.status(400).json({ message: 'Nothing to update — send at least one field or a replacement file.' });
    }

    // ── Optional file replace ────────────────────────────────────────────
    // New file goes up first; the old one is only removed AFTER the row is
    // committed, so a mid-way failure never leaves the manual pointing at a
    // file that no longer exists.
    const previousFile = { driveId: manual.driveId, itemId: manual.driveItemId };

    if (req.file) {
      newFile = await oneDrive.uploadManualFile(req.file.buffer);
      changes.fileName = req.file.originalname;
      changes.driveId = newFile.driveId;
      changes.driveItemId = newFile.itemId;
      changes.storedFileName = newFile.storedFileName;
      changes.fileSizeBytes = req.file.size;
    }

    await Manual.sequelize.transaction(async (transaction) => {
      manual.set(changes);
      await manual.save({ transaction });

      await AuditLog.create(
        {
          userId: req.user.userId,
          action: 'UPDATE_MANUAL',
          entityType: 'MANUAL',
          entityId: String(manual.id),
          ipAddress: req.ip,
        },
        { transaction },
      );
    });
    committed = true;

    // Fire-and-forget: the response doesn't wait on OneDrive, and the helper
    // never throws (a failure is logged as an orphan).
    if (newFile) {
      discardStoredFile(previousFile, 'replaced by a newer file');
    }

    return res.json({ message: 'Manual updated successfully.', manual: serializeManual(manual) });
  } catch (err) {
    // Save failed after the new file was uploaded — drop the new file; the
    // manual is untouched and still points at its original one.
    if (newFile && !committed) {
      await discardStoredFile({ driveId: newFile.driveId, itemId: newFile.itemId }, 'update rolled back');
    }
    return sendError(res, err, 'updateManual', 'Failed to update manual');
  }
};

/* ─── 3. PATCH /api/admin/manuals/:id/status ─────────────────────────────
   Mirrors adminController.js's updateEmployeeStatus response/validation
   shape exactly (boolean body check, 400 on no-op, AuditLog action naming).
   Deactivating only hides the manual — the file stays in OneDrive so it can
   be re-activated later. */
exports.updateManualStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body || {};

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive (boolean) is required in the request body' });
    }
    if (!isUuid(id)) {
      return res.status(404).json({ message: 'Manual not found' });
    }

    const manual = await Manual.findByPk(id);
    if (!manual) {
      return res.status(404).json({ message: 'Manual not found' });
    }
    if (manual.isActive === isActive) {
      return res.status(400).json({
        message: `"${manual.title}" is already ${isActive ? 'active' : 'inactive'}.`,
      });
    }

    await Manual.sequelize.transaction(async (transaction) => {
      manual.isActive = isActive;
      await manual.save({ transaction });

      await AuditLog.create(
        {
          userId: req.user.userId,
          action: isActive ? 'ACTIVATE_MANUAL' : 'DEACTIVATE_MANUAL',
          entityType: 'MANUAL',
          entityId: String(manual.id),
          ipAddress: req.ip,
        },
        { transaction },
      );
    });

    return res.json({
      message: `"${manual.title}" marked ${isActive ? 'active' : 'inactive'} successfully.`,
      manual: serializeManual(manual),
    });
  } catch (err) {
    return sendError(res, err, 'updateManualStatus', 'Failed to update manual status');
  }
};

/* ─── 4. GET /api/admin/manuals ──────────────────────────────────────────
   Admin's management view — every manual, active or not, every role. */
exports.listAllManuals = async (req, res) => {
  try {
    const manuals = await Manual.findAll({
      attributes: { exclude: INTERNAL_FIELDS },
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name', 'employeeCode'] }],
      order: [['category', 'ASC'], ['displayOrder', 'ASC'], ['createdAt', 'DESC']],
    });
    return res.json({ manuals });
  } catch (err) {
    return sendError(res, err, 'listAllManuals', 'Failed to fetch manuals');
  }
};

/* ─── 5. GET /api/manuals ─────────────────────────────────────────────────
   Any authenticated role — returns manuals that are isActive AND target the
   caller's own role. Role is read from the DB (User.findByPk), not trusted
   off the JWT payload — matches updateEmployeeStatus's existing pattern of
   trusting the live row over the token. */
exports.listMyManuals = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, { attributes: ['id', 'role'] });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const manuals = await Manual.findAll({
      where: {
        isActive: true,
        targetRoles: { [Op.contains]: [user.role] },
      },
      // Explicit whitelist — storage pointers are never selected.
      attributes: [
        'id', 'title', 'description', 'category',
        'fileName', 'fileType', 'fileSizeBytes',
        'displayOrder', 'createdAt', 'updatedAt',
      ],
      order: [['category', 'ASC'], ['displayOrder', 'ASC'], ['createdAt', 'DESC']],
    });
    return res.json({ manuals });
  } catch (err) {
    return sendError(res, err, 'listMyManuals', 'Failed to fetch manuals');
  }
};

/* ─── 6. GET /api/manuals/:id/download ───────────────────────────────────
   Streams the file from OneDrive. ADMIN bypasses the active/role check
   entirely (they manage every manual and need to preview it regardless of
   target audience or draft/inactive state). Every other role gets the same
   isActive + targetRoles check listMyManuals applies — re-checked here too,
   since a manual id can be bookmarked or guessed past whatever the list
   showed.

   The bytes are proxied through this server rather than redirecting the
   browser to a OneDrive link: that keeps the access check on every download,
   and means no Microsoft URL (or Microsoft login) is ever exposed to users. */
exports.downloadManual = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, { attributes: ['id', 'role'] });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { id } = req.params;
    const manual = isUuid(id) ? await Manual.findByPk(id) : null;
    const isAdmin = user.role === 'ADMIN';
    const accessible = manual && (isAdmin || (manual.isActive && manual.targetRoles.includes(user.role)));

    if (!accessible) {
      // Same 404 whether the manual doesn't exist, is inactive, or isn't
      // targeted at this role — don't leak which case it is.
      return res.status(404).json({ message: 'Manual not found' });
    }

    let file;
    try {
      file = await oneDrive.getFileStream({ driveId: manual.driveId, itemId: manual.driveItemId });
    } catch (err) {
      if (err instanceof OneDriveError && err.status === 404) {
        console.error('[manualController] file missing in OneDrive for manual', manual.id, manual.driveItemId);
        return res.status(500).json({ message: 'File is unavailable. Please contact your administrator.' });
      }
      throw err;
    }

    // attachment() sets Content-Disposition (RFC 6266, handles non-ASCII names);
    // the explicit Content-Type after it pins the type regardless of extension.
    res.attachment(manual.fileName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', manual.fileSizeBytes);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store'); // internal documents — no shared caches

    // pipeline() handles backpressure and, if the user cancels the download,
    // tears down the OneDrive connection instead of leaking it.
    await pipeline(file.stream, res);
  } catch (err) {
    if (res.headersSent) {
      // Mid-stream failure: the response is already partly sent, so a JSON
      // error is impossible. pipeline() has closed the connection; the
      // client sees an interrupted download. Client cancels aren't errors.
      if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[manualController] downloadManual stream error:', err);
      }
      return;
    }
    return sendError(res, err, 'downloadManual', 'Failed to download manual');
  }
};