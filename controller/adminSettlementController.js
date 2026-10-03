const { sendStoredFile } = require("../services/fileStorage");
const { PartnerSettlement, PartnerCommission, PartnerNotification, PartnerBankAccount } = require("../models/Index");
const PartnerSettlementBill = require("../models/PartnerSettlementBill");
const { createSettlementBatch } = require("../services/settlementCreation");
const logActivity = require("../utils/logActivity");
const { recordSettlementHistory, getSettlementHistory } = require("../utils/settlementHistory");
const {
  checkSettlementPayoutReadiness, checkBillRequirement, notifyBillDue, putSettlementOnHold,
  releaseSettlementHold, HoldReleaseError
} = require("../utils/settlementHold");
const { RazorpayXError } = require("../utils/razorpayX");
const { getPartnerBankDetails, verifyOnlinePayout } = require("../services/onlinePayoutVerification");
const { finalizeSettlementPaid, computePayableAmount } = require("../services/settlementPayoutFulfillment");
const { getAffiliatePartnerIds, isAffiliatePartner } = require("../utils/affiliateScope");

const affiliateSettlementFilter = async (settlementId) => ({
  _id: settlementId,
  partnerId: { $in: await getAffiliatePartnerIds() }
});

/* ============================================================
   ADMIN — SETTLEMENT / PAYOUT BATCHES
============================================================ */

// What the admin needs to pay a settlement: the amount and the partner's
// full bank account (shown on the Pay screen). Every view is audit-logged.
const getPayoutDetails = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
  if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found." });

  const [bank, payable] = await Promise.all([getPartnerBankDetails(settlement.partnerId), computePayableAmount(settlement)]);

  if (bank) {
    await logActivity({
      partnerId: settlement.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "bank_details_accessed",
      entityType: "PartnerSettlement",
      entityId: settlement._id,
      description: `${req.adminUser.name} viewed bank details to pay settlement ${settlement.settlementNumber}.`,
      req
    });
  }

  return res.json({ success: true, data: { settlementNumber: settlement.settlementNumber, payable, bank } });
};

// Online: look up a RazorpayX payout ID and show whether it matches this
// settlement (status, amount, partner's account). Doesn't change anything.
const checkOnlinePayout = async (req, res) => {
  try {
    const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
    if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found." });
    return res.json({ success: true, data: await verifyOnlinePayout(settlement, req.query.transactionId) });
  } catch (error) {
    if (error instanceof RazorpayXError) return res.status(error.statusCode).json({ success: false, message: error.message });
    console.error("checkOnlinePayout error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong checking this transaction." });
  }
};

// Bank details are a separate, access-restricted collection (see
// PartnerBankAccount) — only the pre-masked fields (bankName,
// accountNumberLast4, ifscMasked) are safe to surface here, never the
// encrypted account number/IFSC.
const attachMaskedBankAccounts = async (settlements) => {
  const partnerIds = [...new Set(settlements.map((s) => String(s.partnerId?._id || s.partnerId)))];

  const accounts = await PartnerBankAccount.find(
    { partnerId: { $in: partnerIds } },
    "partnerId bankName accountNumberLast4 ifscMasked"
  ).lean();

  const byPartnerId = new Map(accounts.map((a) => [String(a.partnerId), a]));

  return settlements.map((s) => ({
    ...s,
    bankAccount: byPartnerId.get(String(s.partnerId?._id || s.partnerId)) || null
  }));
};

// One bill per settlement (see PartnerSettlementBill's unique index) — a
// single query keyed by settlementId is enough to attach each row's bill
// (or null, for partners who aren't GST-registered and never needed one).
const attachBills = async (settlements) => {
  const settlementIds = settlements.map((s) => s._id);

  const bills = await PartnerSettlementBill.find(
    { settlementId: { $in: settlementIds } },
    "settlementId status amount.totalBillAmount file.originalName"
  ).lean();

  const bySettlementId = new Map(bills.map((b) => [String(b.settlementId), b]));

  return settlements.map((s) => ({
    ...s,
    bill: bySettlementId.get(String(s._id)) || null
  }));
};

const listSettlements = async (req, res) => {
  const { status, partnerId } = req.query;

  const affiliatePartnerIds = await getAffiliatePartnerIds();
  const filter = { partnerId: { $in: affiliatePartnerIds } };
  if (status) filter.status = status;
  if (partnerId) {
    filter.partnerId = affiliatePartnerIds.some((id) => String(id) === partnerId) ? partnerId : { $in: [] };
  }

  const settlements = await PartnerSettlement.find(filter)
    .sort({ createdAt: -1 })
    .populate("partnerId", "partnerCode legalEntity.businessName")
    .lean();

  return res.json({ success: true, data: await attachBills(await attachMaskedBankAccounts(settlements)) });
};

/* Bundles a partner's approved commissions into a draft settlement batch */
const createSettlement = async (req, res) => {
  try {
    const { partnerId, commissionIds, periodFrom, periodTo } = req.body;

    if (!partnerId || !Array.isArray(commissionIds) || commissionIds.length === 0) {
      return res.status(400).json({ success: false, message: "partnerId and at least one reward are required." });
    }
    if (!(await isAffiliatePartner(partnerId))) {
      return res.status(404).json({ success: false, message: "Affiliate not found." });
    }

    const commissions = await PartnerCommission.find({
      _id: { $in: commissionIds },
      partnerId,
      "settlement.status": "approved"
    });

    if (commissions.length === 0) {
      return res.status(400).json({ success: false, message: "No approved rewards found for this selection." });
    }

    const { settlement, heldReason } = await createSettlementBatch({
      partnerId,
      commissions,
      byUserId: req.adminUser._id,
      req,
      period: { from: periodFrom, to: periodTo }
    });

    if (heldReason) {
      return res.status(201).json({
        success: true,
        message: `Settlement batch created, but placed on hold: ${heldReason}`,
        data: settlement
      });
    }

    return res.status(201).json({ success: true, message: "Settlement batch created.", data: settlement });
  } catch (error) {
    console.error("createSettlement error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong creating the settlement." });
  }
};

const approveSettlement = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

  if (!settlement) {
    return res.status(404).json({ success: false, message: "Settlement not found." });
  }

  if (settlement.status === "on_hold") {
    return res.status(400).json({ success: false, message: "Settlement is on hold — release the hold before approving it." });
  }

  if (!["draft", "pending_approval"].includes(settlement.status)) {
    return res.status(400).json({ success: false, message: `Settlement is already ${settlement.status}.` });
  }

  // Re-check right before approving — the partner may have been suspended,
  // put under review, or had their bank account invalidated since this
  // batch was drafted. (The bill comes after approval, so it isn't checked here.)
  const eligibility = await checkSettlementPayoutReadiness(settlement);
  if (!eligibility.eligible) {
    await putSettlementOnHold(settlement, { code: eligibility.code, reason: eligibility.reason, byUserId: req.adminUser._id, req });
    return res.json({ success: true, message: `Settlement placed on hold instead of approved: ${eligibility.reason}`, data: settlement });
  }

  const fromStatus = settlement.status;
  settlement.status = "approved";
  settlement.approvedBy = req.adminUser._id;
  settlement.approvedAt = new Date();
  await settlement.save();

  await recordSettlementHistory(settlement, {
    action: "approved",
    fromStatus,
    toStatus: "approved",
    byUserId: req.adminUser._id,
    req
  });

  await notifyBillDue(settlement);

  return res.json({ success: true, message: "Settlement approved.", data: settlement });
};

// Shared precondition check for all three payment paths below — approved
// status + full readiness (bank/partner eligibility + GST bill, if
// required). Returns the settlement on success, or null after already
// having written a response (either an error or a hold).
const guardBeforePayout = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

  if (!settlement) {
    res.status(404).json({ success: false, message: "Settlement not found." });
    return null;
  }

  if (settlement.status !== "approved") {
    res.status(400).json({ success: false, message: "Only an approved settlement can be paid." });
    return null;
  }

  // Every settlement needs the affiliate's bill, verified by an admin,
  // before it's paid. Not a hold — the settlement stays approved and
  // simply waits for the bill.
  const billCheck = await checkBillRequirement(settlement._id);
  if (!billCheck.ready) {
    res.status(400).json({ success: false, message: billCheck.reason });
    return null;
  }

  // Last check before money actually moves — the bank account could've
  // been invalidated or the partner suspended since approval.
  const eligibility = await checkSettlementPayoutReadiness(settlement);
  if (!eligibility.eligible) {
    await putSettlementOnHold(settlement, { code: eligibility.code, reason: eligibility.reason, byUserId: req.adminUser._id, req });
    res.json({ success: true, message: `Settlement placed on hold instead of paid: ${eligibility.reason}`, data: settlement });
    return null;
  }

  return settlement;
};

// PATH 1 — Offline: admin paid the partner directly (bank transfer/UPI/
// cheque/cash) outside Razorpay entirely. No Razorpay artifact exists to
// verify, so this is trusted on the admin's word — same trust model as
// every other admin-attested action in this app. Still gated by the exact
// same readiness check (bank eligibility + GST bill) as the other two paths.
const markSettlementPaidOffline = async (req, res) => {
  try {
    const { method, referenceNumber, paidAt, note } = req.body;

    if (!["cash", "cheque"].includes(method)) {
      return res.status(400).json({ success: false, message: "Offline payment must be cash or cheque." });
    }
    if (method === "cheque" && !String(referenceNumber || "").trim()) {
      return res.status(400).json({ success: false, message: "Enter the cheque number." });
    }

    const settlement = await guardBeforePayout(req, res);
    if (!settlement) return;

    const payable = await computePayableAmount(settlement);

    await finalizeSettlementPaid(settlement, {
      method,
      transactionId: String(referenceNumber || "").trim(),
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      payableTotal: payable.total,
      byUserId: req.adminUser._id,
      req
    });

    if (note) {
      await logActivity({
        partnerId: settlement.partnerId,
        performedByType: "spotx_user",
        performedByUserId: req.adminUser._id,
        activityType: "settlement_paid",
        entityType: "PartnerSettlement",
        entityId: settlement._id,
        description: `Offline payment note: ${note}`,
        req
      });
    }

    return res.json({ success: true, message: "Settlement marked paid (offline).", data: settlement });
  } catch (error) {
    console.error("markSettlementPaidOffline error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong marking the settlement paid." });
  }
};

// Online: the admin paid through RazorpayX and enters the payout's
// transaction ID. It's only marked paid if RazorpayX confirms the payout was
// processed, for the payable amount, to this partner's account number.
const markSettlementPaid = async (req, res) => {
  try {
    const settlement = await guardBeforePayout(req, res);
    if (!settlement) return;

    const result = await verifyOnlinePayout(settlement, req.body.transactionId);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: `Can't mark paid: ${result.problems.join(" ")}`, data: result });
    }

    await finalizeSettlementPaid(settlement, {
      method: "online",
      transactionId: result.payout.utr ? `${result.payout.id} (UTR ${result.payout.utr})` : result.payout.id,
      paidAt: result.payout.createdAt || new Date(),
      payableTotal: result.payout.expectedAmount,
      byUserId: req.adminUser._id,
      req
    });

    return res.json({ success: true, message: "Payment verified and settlement marked paid.", data: settlement });
  } catch (error) {
    if (error instanceof RazorpayXError) return res.status(error.statusCode).json({ success: false, message: error.message });
    console.error("markSettlementPaid error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong marking the settlement paid." });
  }
};

/* Mirrors partnerSettlementController.getSettlementDetail, just not scoped
   to a single partner — admin can open any settlement's breakdown. */
const getSettlementDetail = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id))
    .populate("partnerId", "partnerCode legalEntity.businessName")
    .populate({
      path: "commissionIds",
      select: "referralId transaction.revenue calculation.netCommission createdAt",
      populate: { path: "referralId", select: "customer.companyName" }
    })
    .lean();

  if (!settlement) {
    return res.status(404).json({ success: false, message: "Settlement not found." });
  }

  const bankAccount = await PartnerBankAccount.findOne(
    { partnerId: settlement.partnerId?._id || settlement.partnerId },
    "bankName accountNumberLast4 ifscMasked"
  ).lean();

  return res.json({ success: true, data: { ...settlement, bankAccount: bankAccount || null } });
};

// Manual hold — compliance review, or any ad hoc reason an admin needs to
// pause a batch for. Not allowed once it's already paid/cancelled/on_hold.
const holdSettlement = async (req, res) => {
  try {
    const { reason, code } = req.body;
    const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (["paid", "cancelled", "on_hold"].includes(settlement.status)) {
      return res.status(400).json({ success: false, message: `Settlement is already ${settlement.status}.` });
    }

    await putSettlementOnHold(settlement, { code, reason, byUserId: req.adminUser._id, req });

    return res.json({ success: true, message: "Settlement put on hold.", data: settlement });
  } catch (error) {
    console.error("holdSettlement error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong holding the settlement." });
  }
};

// Releases a hold back to whatever status it was in before — but only once
// the underlying cause is actually gone (see utils/settlementHold.js).
const releaseSettlement = async (req, res) => {
  try {
    const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (settlement.status !== "on_hold") {
      return res.status(400).json({ success: false, message: "Settlement is not on hold." });
    }

    await releaseSettlementHold(settlement, { byUserId: req.adminUser._id, req });

    return res.json({ success: true, message: "Settlement hold released.", data: settlement });
  } catch (error) {
    if (error instanceof HoldReleaseError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("releaseSettlement error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong releasing the hold." });
  }
};

// The payout was actually attempted (settlement was approved) and the bank
// transfer itself was rejected — a distinct terminal state from on_hold,
// which is for payouts that were never attempted in the first place.
const failSettlement = async (req, res) => {
  try {
    const { reason } = req.body;
    const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (settlement.status !== "approved") {
      return res.status(400).json({ success: false, message: "Only an approved settlement (payout in progress) can be marked failed." });
    }

    settlement.status = "failed";
    settlement.failureReason = reason || "Payout could not be processed.";
    await settlement.save();

    await recordSettlementHistory(settlement, {
      action: "failed",
      fromStatus: "approved",
      toStatus: "failed",
      reason: settlement.failureReason,
      byUserId: req.adminUser._id,
      req
    });

    await logActivity({
      partnerId: settlement.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "settlement_failed",
      entityType: "PartnerSettlement",
      entityId: settlement._id,
      description: `${req.adminUser.name} marked settlement ${settlement.settlementNumber} as failed: ${settlement.failureReason}`,
      req
    });

    await PartnerNotification.create({
      partnerId: settlement.partnerId,
      type: "settlement_failed",
      title: "Payout failed",
      message: `Your settlement ${settlement.settlementNumber} payout failed: ${settlement.failureReason}`,
      entity: { type: "PartnerSettlement", entityId: settlement._id }
    });

    return res.json({ success: true, message: "Settlement marked failed.", data: settlement });
  } catch (error) {
    console.error("failSettlement error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong marking the settlement failed." });
  }
};

// Admin resolved whatever broke the payout — move it back to approved so
// "Mark Paid" can be retried. If the underlying cause is still unresolved
// (e.g. bank still unverified), it lands on hold instead of silently
// failing again.
const retrySettlement = async (req, res) => {
  try {
    const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));

    if (!settlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    if (settlement.status !== "failed") {
      return res.status(400).json({ success: false, message: "Only a failed settlement can be retried." });
    }

    settlement.failureReason = "";

    const eligibility = await checkSettlementPayoutReadiness(settlement);
    if (!eligibility.eligible) {
      settlement.status = "approved";
      await putSettlementOnHold(settlement, { code: eligibility.code, reason: eligibility.reason, byUserId: req.adminUser._id, req });
      return res.json({ success: true, message: `Payout still blocked — settlement placed on hold: ${eligibility.reason}`, data: settlement });
    }

    settlement.status = "approved";
    await settlement.save();

    await recordSettlementHistory(settlement, {
      action: "retried",
      fromStatus: "failed",
      toStatus: "approved",
      byUserId: req.adminUser._id,
      req
    });

    await logActivity({
      partnerId: settlement.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      activityType: "settlement_retried",
      entityType: "PartnerSettlement",
      entityId: settlement._id,
      description: `${req.adminUser.name} moved settlement ${settlement.settlementNumber} back to approved for a payout retry.`,
      req
    });

    return res.json({ success: true, message: "Settlement moved back to approved — ready to retry payout.", data: settlement });
  } catch (error) {
    console.error("retrySettlement error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong retrying the settlement." });
  }
};

const getSettlementHistoryAsAdmin = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
  if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found." });

  const history = await getSettlementHistory(req.params.id);
  return res.json({ success: true, data: history });
};

const getBillForSettlementAsAdmin = async (req, res) => {
  const settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
  if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found." });

  const bill = await PartnerSettlementBill.findOne({ settlementId: req.params.id });
  return res.json({ success: true, data: bill || null });
};

const downloadBillAsAdmin = async (req, res) => {
  try {
    const scopedSettlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
    if (!scopedSettlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    const bill = await PartnerSettlementBill.findOne({ settlementId: req.params.id });
    if (!bill) {
      return res.status(404).json({ success: false, message: "No bill has been submitted for this settlement." });
    }

    return await sendStoredFile(res, bill.file);
  } catch (error) {
    console.error("downloadBillAsAdmin error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong downloading the bill." });
  }
};

// Verifying/rejecting is scoped to exactly this one settlement's bill —
// deliberately does NOT do a blanket sweep of every "incomplete_info"
// hold for the partner, since a different settlement could be on hold
// with that same code for an unrelated reason (still no bank account, or
// its own bill still unverified). Only re-checks and, if now eligible,
// releases the ONE settlement this bill belongs to.
const verifyBill = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;

    if (!["verified", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'verified' or 'rejected'." });
    }

    const scopedSettlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(req.params.id));
    if (!scopedSettlement) {
      return res.status(404).json({ success: false, message: "Settlement not found." });
    }

    const bill = await PartnerSettlementBill.findOne({ settlementId: req.params.id });
    if (!bill) {
      return res.status(404).json({ success: false, message: "No bill has been submitted for this settlement." });
    }

    if (bill.status !== "submitted") {
      return res.status(400).json({ success: false, message: `This bill has already been ${bill.status}.` });
    }

    bill.status = status;
    bill.verifiedBy = req.adminUser._id;
    bill.verifiedAt = new Date();
    bill.rejectionReason = status === "rejected" ? (rejectionReason || "Rejected.") : "";
    await bill.save();

    await recordSettlementHistory({ _id: bill.settlementId, partnerId: bill.partnerId }, {
      action: status === "verified" ? "bill_verified" : "bill_rejected",
      reason: status === "rejected" ? bill.rejectionReason : "",
      meta: { fileName: bill.file?.originalName, gstAmount: bill.amount.gstAmount },
      byUserId: req.adminUser._id,
      req
    });

    await logActivity({
      partnerId: bill.partnerId,
      performedByType: "spotx_user",
      performedByUserId: req.adminUser._id,
      // "document_verified" regardless of verified/rejected outcome — same
      // convention adminDocumentController.verifyDocument uses; the enum
      // (a model, can't be extended) has no bill-specific value.
      activityType: "document_verified",
      entityType: "PartnerSettlement",
      entityId: bill.settlementId,
      description: `${req.adminUser.name} ${status} the bill for settlement ${scopedSettlement.settlementNumber}.`,
      req
    });

    await PartnerNotification.create({
      partnerId: bill.partnerId,
      type: status === "verified" ? "settlement_bill_verified" : "settlement_bill_rejected",
      title: status === "verified" ? "Bill verified" : "Bill rejected — please re-upload",
      message: status === "verified"
        ? `Your bill for settlement ${scopedSettlement.settlementNumber} was verified. SPOTX will now process your payment.`
        : `Your bill for settlement ${scopedSettlement.settlementNumber} was rejected: ${bill.rejectionReason} Upload a corrected bill on the Settlements page.`,
      entity: { type: "PartnerSettlement", entityId: bill.settlementId }
    }).catch((error) => console.error("verifyBill: notification failed:", error.message));

    let settlement = null;
    if (status === "verified") {
      settlement = await PartnerSettlement.findOne(await affiliateSettlementFilter(bill.settlementId));
      if (settlement && settlement.status === "on_hold" && settlement.hold?.code === "incomplete_info") {
        const readiness = await checkSettlementPayoutReadiness(settlement);
        if (readiness.eligible) {
          await releaseSettlementHold(settlement, { byUserId: req.adminUser._id, req }).catch((error) =>
            console.error("verifyBill: auto-release failed:", error.message)
          );
        }
      }
    }

    return res.json({ success: true, message: `Bill ${status}.`, data: { bill, settlement } });
  } catch (error) {
    console.error("verifyBill error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong verifying the bill." });
  }
};

module.exports = {
  listSettlements,
  createSettlement,
  approveSettlement,
  markSettlementPaid,
  markSettlementPaidOffline,
  getSettlementDetail,
  holdSettlement,
  releaseSettlement,
  failSettlement,
  retrySettlement,
  getPayoutDetails, checkOnlinePayout,
  getBillForSettlementAsAdmin,
  downloadBillAsAdmin,
  verifyBill,
  getSettlementHistoryAsAdmin
};
