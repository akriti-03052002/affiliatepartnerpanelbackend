const { uploadPartnerFile } = require("../services/fileStorage");
const { PartnerSettlement } = require("../models/Index");
const PartnerSettlementBill = require("../models/PartnerSettlementBill");
const { GST_RATE_PERCENT } = require("../config/constant");
const logActivity = require("../utils/logActivity");
const notifyAdmins = require("../utils/notifyAdmins");
const { partnerLabel } = notifyAdmins;
const { recordSettlementHistory } = require("../utils/settlementHistory");
const { isGstRegistered } = require("../utils/settlementHold");

/* ============================================================
   PARTNER — SETTLEMENT BILL SUBMISSION
   Every affiliate submits one bill per settlement once it's approved; an
   admin verifies it before the payout goes out (see
   utils/settlementHold.checkBillRequirement). The bill amount is always
   server-computed off the settlement's own gross commission, plus
   GST_RATE_PERCENT only for verified GST-registered partners — never
   taken from the partner's input, same "never trust the client for
   money" rule as everywhere else Razorpay touches this app.
============================================================ */

const round2 = (n) => Math.round(n * 100) / 100;

// A bill can be uploaded once SPOTX has approved the settlement (or while
// an approved one is on hold / being retried) — never before approval.
const BILLABLE_STATUSES = ["approved", "on_hold", "failed"];

const submitBill = async (req, res) => {
  try {
    // The bill is the affiliate's own document (PDF/image) — they upload
    // it as-is; the admin reads the details off the file when verifying.
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Choose your bill file (PDF, PNG or JPG) to upload." });
    }

    const gstRegistered = await isGstRegistered(req.partner._id);

    const settlement = await PartnerSettlement.findOne({ _id: req.params.id, partnerId: req.partner._id });

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (!BILLABLE_STATUSES.includes(settlement.status)) {
      return res.status(400).json({
        success: false,
        message: ["paid", "cancelled"].includes(settlement.status)
          ? `A bill can't be submitted for a settlement that's already ${settlement.status}.`
          : "You can upload a bill once SPOTX approves this settlement."
      });
    }

    const existing = await PartnerSettlementBill.findOne({ settlementId: settlement._id });
    if (existing && existing.status !== "rejected") {
      return res.status(400).json({ success: false, message: `A bill has already been ${existing.status} for this settlement.` });
    }

    // GST is added only for verified GST-registered partners — decided from
    // their KYC on file, never from anything on the uploaded bill.
    const commission = settlement.amount.gross;
    const gstRatePercent = gstRegistered ? GST_RATE_PERCENT : 0;
    const gstAmount = round2((commission * gstRatePercent) / 100);
    const totalBillAmount = round2(commission + gstAmount);

    const file = await uploadPartnerFile({
      buffer: req.file.buffer,
      partnerId: req.partner._id,
      subfolder: "bills",
      originalName: req.file.originalname,
      mimeType: req.file.mimetype
    });

    const billData = {
      partnerId: req.partner._id,
      settlementId: settlement._id,
      amount: { commission, gstRatePercent, gstAmount, totalBillAmount, currency: settlement.amount.currency },
      file,
      status: "submitted",
      verifiedBy: undefined,
      verifiedAt: undefined,
      rejectionReason: ""
    };

    // Resubmitting after a rejection replaces the prior bill (unique index
    // on settlementId) rather than erroring or piling up duplicates.
    const bill = existing
      ? await PartnerSettlementBill.findOneAndUpdate({ _id: existing._id }, { $set: billData }, { returnDocument: "after" })
      : await PartnerSettlementBill.create(billData);

    await recordSettlementHistory(settlement, {
      action: "bill_submitted",
      amount: { net: 0, gst: gstAmount, total: totalBillAmount, currency: settlement.amount.currency },
      meta: { fileName: file.originalName },
      byPartnerUser: req.partnerUser._id,
      req
    });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      // "document_uploaded" — the existing PartnerActivity.activityType enum
      // (a model, can't be extended) has no bill-specific value; this is the
      // closest accurate fit and is what document uploads elsewhere use too.
      activityType: "document_uploaded",
      entityType: "PartnerSettlement",
      entityId: settlement._id,
      description: `${req.partnerUser.name} uploaded a bill for settlement ${settlement.settlementNumber}.`,
      req
    });

    await notifyAdmins({
      type: "bill_submitted",
      title: existing ? "Bill resubmitted for review" : "Bill to verify",
      message: `${partnerLabel(req.partner)} ${existing ? "re-uploaded" : "uploaded"} a bill for settlement ${settlement.settlementNumber}. Payout waits on this bill being verified.`,
      link: "/admin/settlements",
      audienceRoles: ["finance"],
      partnerId: req.partner._id,
      entityType: "PartnerSettlement",
      entityId: settlement._id
    });

    return res.status(201).json({ success: true, message: "Bill submitted — awaiting verification.", data: bill });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: "A bill already exists for this settlement." });
    }
    console.error("submitBill error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong submitting the bill." });
  }
};

const getBillForSettlement = async (req, res) => {
  const settlement = await PartnerSettlement.findOne({ _id: req.params.id, partnerId: req.partner._id });
  if (!settlement) {
    return res.status(404).json({ success: false, message: "Settlement not found." });
  }

  const bill = await PartnerSettlementBill.findOne({ settlementId: settlement._id });
  return res.json({ success: true, data: bill || null });
};

module.exports = { submitBill, getBillForSettlement };
