const multer = require("multer");

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg"
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Files are held in memory only long enough for the controller to push them
// to Cloudinary (see services/fileStorage.js) — nothing is written to disk.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error("Only PDF, PNG and JPG files are allowed."));
  }

  cb(null, true);
};

const uploadFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Partner KYC documents, admin uploads on a partner's behalf, and settlement
// bills all share the same rules; the controller decides where each lands.
module.exports = { uploadDocument: uploadFile, uploadDocumentAsAdmin: uploadFile, uploadBill: uploadFile };
