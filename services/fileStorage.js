const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Files uploaded before the move to Cloudinary still live on local disk
// (storageProvider "private_storage") and keep being served from there.
const LEGACY_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "partners");
const ROOT_FOLDER = "spotx/partners";

// KYC documents, bills and agreements are stored as "raw" + "authenticated":
// raw keeps PDFs and images byte-for-byte (no transformations, no PDF
// delivery restrictions), authenticated means the plain URL returns 401 —
// only a URL signed with the API secret can fetch them, and that only ever
// happens server-side, behind the app's own auth checks.
const RESOURCE_TYPE = "raw";
const DELIVERY_TYPE = "authenticated";

/**
 * Uploads a buffer and returns file metadata in the shape PartnerDocument
 * and PartnerSettlementBill store under `file`.
 *
 * `subfolder` is relative to the partner's folder (e.g. "bills"). Pass a
 * fixed `publicId` to overwrite the same asset on re-upload (agreement,
 * demo seed); otherwise a unique name is generated.
 */
const uploadPartnerFile = async ({ buffer, partnerId, subfolder, originalName, mimeType, publicId }) => {
  const ext = path.extname(originalName || "").toLowerCase();
  const name = publicId || `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const folder = [ROOT_FOLDER, String(partnerId), subfolder].filter(Boolean).join("/");

  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          resource_type: RESOURCE_TYPE,
          type: DELIVERY_TYPE,
          folder,
          // Raw assets keep their extension as part of the public ID.
          public_id: `${name}${ext}`,
          overwrite: Boolean(publicId),
          use_filename: false,
          unique_filename: false
        },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded))
      )
      .end(buffer);
  });

  return {
    storageProvider: "cloudinary",
    objectKey: result.public_id,
    originalName: originalName || "",
    mimeType: mimeType || "",
    size: result.bytes
  };
};

/**
 * Streams a stored file to the response as a download, whichever provider
 * it lives on. Callers do their own authorization before calling this.
 */
const sendStoredFile = async (res, file) => {
  if (file.storageProvider !== "cloudinary") {
    const filePath = path.join(LEGACY_UPLOAD_ROOT, file.objectKey);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "File not found on server." });
    }

    return res.download(filePath, file.originalName);
  }

  const signedUrl = cloudinary.url(file.objectKey, {
    resource_type: RESOURCE_TYPE,
    type: DELIVERY_TYPE,
    sign_url: true,
    secure: true
  });

  const upstream = await fetch(signedUrl);

  if (!upstream.ok) {
    console.error(`sendStoredFile: Cloudinary returned ${upstream.status} for ${file.objectKey}`);
    return res.status(upstream.status === 404 ? 404 : 502).json({
      success: false,
      message: upstream.status === 404 ? "File not found on server." : "Couldn't fetch the file from storage."
    });
  }

  res.attachment(file.originalName || path.basename(file.objectKey));
  res.type(file.mimeType || upstream.headers.get("content-type") || "application/octet-stream");
  const length = upstream.headers.get("content-length");
  if (length) res.set("Content-Length", length);

  Readable.fromWeb(upstream.body).pipe(res);
};

module.exports = { uploadPartnerFile, sendStoredFile };
