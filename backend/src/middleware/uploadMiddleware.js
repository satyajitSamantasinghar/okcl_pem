const multer = require("multer");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
//  uploadMiddleware — multer config for Manual file uploads.
//
//  Storage: IN MEMORY. This middleware only receives and validates the file;
//  it writes nothing to the server's disk. The controller hands the buffer
//  to services/oneDriveService.js, which stores it in OneDrive. That keeps
//  the API server stateless — safe behind a load balancer, on containers with
//  ephemeral disks, and across redeploys.
//
//  Why memory and not streaming: OneDrive's resumable upload needs the total
//  size up front and a chunk can be re-sent on a transient failure, both of
//  which are trivial with a Buffer. The 20 MB cap plus admin-only access
//  (see adminRoutes.js) bounds the memory this can ever use.
//
//  Validation, cheapest first:
//    1. multer limits   — 1 file, size cap, bounded number of text fields
//    2. mimetype filter — rejects obvious non-PDFs before buffering starts
//    3. "%PDF-" magic bytes — the mimetype is client-supplied and trivially
//       spoofed; the file's own first bytes are the real check
//
//  PDF-only for v1. To add PPT later: extend ALLOWED_MIME_TYPES and
//  PDF_SIGNATURE handling here, Manual.fileType's validate.isIn, and the
//  ".pdf" naming + Content-Type in services/oneDriveService.js together.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ["application/pdf"];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB — adjust if manuals run larger
const PDF_SIGNATURE = "%PDF-";

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Only PDF files are allowed."));
  }
  cb(null, true);
}

const uploadManualFile = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 10, // title, description, category, targetRoles (+ headroom)
  },
});

// The filename is display-only (stored as Manual.fileName), but it still comes
// from the client, so normalise it: strip any path, drop control characters,
// fix the UTF-8 mojibake multer produces for non-ASCII names, and cap length
// to the column size.
function normalizeOriginalName(raw) {
  let name = typeof raw === "string" && raw ? raw : "manual.pdf";

  // multer decodes multipart filenames as latin1 while browsers send UTF-8,
  // so "Guía.pdf" arrives as "GuÃ­a.pdf". Recover it — ASCII names are untouched.
  if (/[\u0080-\u00ff]/.test(name)) {
    const recovered = Buffer.from(name, "latin1").toString("utf8");
    if (!recovered.includes("\uFFFD")) name = recovered;
  }

  // eslint-disable-next-line no-control-regex
  name = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) name = "manual.pdf";

  if (name.length > 255) {
    const ext = path.extname(name);
    name = name.slice(0, 255 - ext.length) + ext;
  }
  return name;
}

// Wraps multer's single-file upload with JSON error responses, so a bad
// upload (wrong type, too large) returns the same { message } shape as
// every other error in this codebase instead of falling through to
// whatever Express's default error handler does.
function handleManualUpload(req, res, next) {
  uploadManualFile.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: `File too large — max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ message: 'Unexpected file field — send the PDF in the "file" field.' });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      // fileFilter rejection surfaces here (not as a MulterError)
      return res.status(400).json({ message: err.message });
    }

    if (req.file) {
      // Trust the file's own bytes, not the client-declared mimetype.
      if (req.file.buffer.subarray(0, PDF_SIGNATURE.length).toString("latin1") !== PDF_SIGNATURE) {
        return res.status(400).json({ message: "The uploaded file is not a valid PDF." });
      }
      req.file.originalname = normalizeOriginalName(req.file.originalname);
    }
    next();
  });
}

module.exports = { handleManualUpload, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };