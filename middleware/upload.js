const fs = require("fs");
const path = require("path");
const multer = require("multer");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "partners");

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg"
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const partnerDir = path.join(UPLOAD_ROOT, String(req.partner._id));

    fs.mkdirSync(partnerDir, { recursive: true });

    cb(null, partnerDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, `${unique}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Only PDF, PNG and JPG files are allowed."));
  }

  cb(null, true);
};

const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Same rules, but for an admin uploading on a partner's behalf (e.g. when
// onboarding one directly) — there's no req.partner in that request, only
// the partnerId in the route params.
const adminStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const partnerDir = path.join(UPLOAD_ROOT, String(req.params.id));

    fs.mkdirSync(partnerDir, { recursive: true });

    cb(null, partnerDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, `${unique}${ext}`);
  }
});

const uploadDocumentAsAdmin = multer({
  storage: adminStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Settlement bills — same rules, own subfolder so they don't mix with KYC
// documents on disk even though both live under the same partner.
const billStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const billDir = path.join(UPLOAD_ROOT, String(req.partner._id), "bills");

    fs.mkdirSync(billDir, { recursive: true });

    cb(null, billDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, `${unique}${ext}`);
  }
});

const uploadBill = multer({
  storage: billStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

module.exports = { uploadDocument, uploadDocumentAsAdmin, uploadBill, UPLOAD_ROOT };
