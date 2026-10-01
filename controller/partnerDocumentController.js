const { PartnerDocument } = require("../models/Index");
const logActivity = require("../utils/logActivity");
const { uploadPartnerFile, sendStoredFile } = require("../services/fileStorage");

/* ============================================================
   PARTNER KYC DOCUMENTS
============================================================ */

const listDocuments = async (req, res) => {
  const documents = await PartnerDocument.find({ partnerId: req.partner._id }).sort({ createdAt: -1 });

  return res.json({ success: true, data: documents });
};

const uploadDocument = async (req, res) => {
  try {
    const { documentType, documentNumber } = req.body;

    if (!documentType) {
      return res.status(400).json({ success: false, message: "Document type is required." });
    }

    // System-generated on verification (see services/generatePartnerAgreement.js)
    // — a partner never uploads their own.
    if (documentType === "partner_agreement") {
      return res.status(403).json({ success: false, message: "The partner agreement is generated automatically by SPOTX and can't be uploaded manually." });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required." });
    }

    const file = await uploadPartnerFile({
      buffer: req.file.buffer,
      partnerId: req.partner._id,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype
    });

    const document = await PartnerDocument.create({
      partnerId: req.partner._id,
      documentType,
      documentNumber: documentNumber || "",
      file,
      verification: { status: "pending" }
    });

    // First submission of anything moves the partner out of "draft"/"not
    // submitted" limbo so the admin queue (and the partner's own status
    // badges) actually reflect that review is needed — nothing else in
    // this flow ever flips these on the way in, only on verification.
    // Kept in its own try/catch: the document is already safely saved above,
    // so a failure here should never make the upload look like it failed.
    try {
      if (req.partner.status === "draft") req.partner.status = "pending_verification";
      if (req.partner.verification.overallStatus === "not_submitted") req.partner.verification.overallStatus = "pending";
      await req.partner.save();
    } catch (statusError) {
      console.error("uploadDocument: partner status flip failed (document was still saved):", statusError);
    }

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "document_uploaded",
      entityType: "PartnerDocument",
      entityId: document._id,
      description: `${req.partnerUser.name} uploaded a ${documentType} document.`,
      req
    });

    return res.status(201).json({ success: true, message: "Document uploaded.", data: document });
  } catch (error) {
    console.error("uploadDocument error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong uploading the document." });
  }
};

const downloadDocument = async (req, res) => {
  try {
    const document = await PartnerDocument.findOne({ _id: req.params.id, partnerId: req.partner._id });

    if (!document) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    // Once the account is fully verified, the underlying KYC proofs are no
    // longer needed on the partner's side — only the Partner Agreement
    // (their actual contract) stays downloadable.
    if (req.partner.status === "active" && document.documentType !== "partner_agreement") {
      return res.status(403).json({ success: false, message: "This document is no longer available for download once your account is verified." });
    }

    return await sendStoredFile(res, document.file);
  } catch (error) {
    console.error("downloadDocument error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong downloading the document." });
  }
};

module.exports = { listDocuments, uploadDocument, downloadDocument };
