const { Partner, PartnerBankAccount, PartnerDocument, PartnerSettlement, PartnerNotification } = require("../models/Index");
const PartnerSettlementBill = require("../models/PartnerSettlementBill");
const logActivity = require("./logActivity");
const { recordSettlementHistory } = require("./settlementHistory");
const { SETTLEMENT_HOLD_CODES } = require("../config/constant");
const { getRequiredDocumentTypes } = require("./partnerVerification");

/* ============================================================
   SETTLEMENT HOLD
   Central place for putting settlements on hold / releasing them, and
   for deciding whether a partner is currently payout-eligible at all.
   "on_hold" isn't a dead end — hold.previousStatus + hold.code are what
   let release restore the right state instead of guessing, and what let
   release refuse to fire until the actual cause is gone.
============================================================ */

// Statuses a settlement can be swept out of into a hold. Once paid/failed/
// cancelled/on_hold, holding again either doesn't apply or must go through
// the dedicated release/retry path instead.
const HOLDABLE_STATUSES = ["draft", "pending_approval", "approved", "processing"];

const HOLD_REASON_LABEL = {
  bank_unverified: "Partner's bank account is not verified.",
  bank_change_pending: "Bank details were recently changed and the new account is pending verification.",
  partner_suspended: "Partner account is suspended.",
  compliance_review: "Partner account is under compliance review.",
  incomplete_info: "Required settlement/payout information is incomplete.",
  manual: "On hold."
};

/* Partner + bank state only — doesn't look at any one settlement. Used
   before creating/approving/paying a settlement to decide if it should
   go through or land on hold instead. */
const checkPartnerPayoutEligibility = async (partnerId) => {
  const partner = await Partner.findById(partnerId);

  if (!partner) {
    return { eligible: false, code: "incomplete_info", reason: "Partner record not found." };
  }

  if (partner.status === "suspended") {
    return { eligible: false, code: "partner_suspended", reason: HOLD_REASON_LABEL.partner_suspended };
  }

  if (partner.status === "under_review") {
    return { eligible: false, code: "compliance_review", reason: HOLD_REASON_LABEL.compliance_review };
  }

  if (partner.status !== "active") {
    return { eligible: false, code: "incomplete_info", reason: `Partner account is ${partner.status.replace(/_/g, " ")}.` };
  }

  const bankAccount = await PartnerBankAccount.findOne({ partnerId });

  if (!bankAccount) {
    return { eligible: false, code: "incomplete_info", reason: "No bank account on file for this partner." };
  }

  if (bankAccount.verification.status !== "verified") {
    return { eligible: false, code: "bank_unverified", reason: HOLD_REASON_LABEL.bank_unverified };
  }

  return { eligible: true };
};

/* GST-registered = a business type whose KYC includes a GST certificate
   (see utils/partnerVerification.js) AND that certificate is verified.
   Only these partners get GST added on top of their bill; everyone else
   bills the plain reward amount. */
const isGstRegistered = async (partnerId) => {
  const partner = await Partner.findById(partnerId).select("partnerType").lean();
  if (!partner || !getRequiredDocumentTypes(partner.partnerType).includes("gst_certificate")) return false;

  return Boolean(await PartnerDocument.exists({
    partnerId,
    documentType: "gst_certificate",
    "verification.status": "verified"
  }));
};

/* Every affiliate submits a bill (invoice) for each settlement once it's
   approved, and an admin verifies it before the payout can go out. This
   is checked only at payment time (see adminSettlementController
   .guardBeforePayout) — a missing bill doesn't put the settlement on hold,
   it just stays "approved" and waits for the bill. */
const checkBillRequirement = async (settlementId) => {
  const bill = await PartnerSettlementBill.findOne({ settlementId });

  if (!bill) {
    return { ready: false, reason: "Waiting for the affiliate to upload a bill for this settlement." };
  }

  if (bill.status === "rejected") {
    return { ready: false, reason: `The bill was rejected (${bill.rejectionReason || "no reason given"}) — waiting for the affiliate to upload a corrected one.` };
  }

  if (bill.status !== "verified") {
    return { ready: false, reason: "The affiliate's bill has been submitted — verify it before paying." };
  }

  return { ready: true };
};

/* Partner + bank eligibility for a settlement — what decides whether
   create/approve/pay goes through or lands on hold instead. The bill is
   deliberately not part of this: it comes after approval and is checked
   separately right before payment. */
const checkSettlementPayoutReadiness = (settlement) => checkPartnerPayoutEligibility(settlement.partnerId);

const notifyPartner = (partnerId, { type, title, message, entityId }) =>
  PartnerNotification.create({
    partnerId,
    type,
    title,
    message,
    entity: { type: "PartnerSettlement", entityId }
  }).catch((error) => console.error("settlementHold: notification failed:", error.message));

/* Tells the affiliate a settlement was approved and that it's waiting on
   their bill — called from every path that approves a settlement. */
const notifyBillDue = (settlement) => notifyPartner(settlement.partnerId, {
  type: "settlement_bill_due",
  title: "Settlement approved — upload your bill",
  message: `Settlement ${settlement.settlementNumber} was approved. Upload your bill on the Settlements page; SPOTX pays it once the bill is verified.`,
  entityId: settlement._id
});

/* Puts a single settlement on hold, saving whatever status it was in so
   releaseSettlementHold can restore it later instead of guessing.
   byUserId omitted => logged/notified as a system-triggered hold. */
const putSettlementOnHold = async (settlement, { code, reason, byUserId, req } = {}) => {
  const resolvedCode = SETTLEMENT_HOLD_CODES.includes(code) ? code : "manual";
  const resolvedReason = reason || HOLD_REASON_LABEL[resolvedCode] || "On hold.";
  const fromStatus = settlement.status;

  settlement.hold = {
    code: resolvedCode,
    reason: resolvedReason,
    previousStatus: settlement.status,
    heldBy: byUserId || undefined,
    heldAt: new Date(),
    releasedBy: undefined,
    releasedAt: undefined
  };
  settlement.status = "on_hold";
  await settlement.save();

  await recordSettlementHistory(settlement, {
    action: "held",
    fromStatus,
    toStatus: "on_hold",
    reason: resolvedReason,
    meta: { code: resolvedCode },
    byUserId,
    req
  });

  await logActivity({
    partnerId: settlement.partnerId,
    performedByType: byUserId ? "spotx_user" : "system",
    performedByUserId: byUserId,
    activityType: "settlement_held",
    entityType: "PartnerSettlement",
    entityId: settlement._id,
    description: `Settlement ${settlement.settlementNumber} put on hold: ${resolvedReason}`,
    req
  });

  await notifyPartner(settlement.partnerId, {
    type: "settlement_held",
    title: "Settlement on hold",
    message: `Your settlement ${settlement.settlementNumber} of ${settlement.amount.net.toFixed(2)} is on hold: ${resolvedReason}`,
    entityId: settlement._id
  });

  return settlement;
};

/* Bulk version — used when the root cause is partner-level (suspension,
   compliance review, a bank-detail change) rather than about one
   settlement someone is reviewing individually. */
const holdSettlementsForPartner = async (partnerId, { code, reason, byUserId, req } = {}) => {
  const settlements = await PartnerSettlement.find({
    partnerId,
    status: { $in: HOLDABLE_STATUSES }
  });

  for (const settlement of settlements) {
    await putSettlementOnHold(settlement, { code, reason, byUserId, req });
  }

  return settlements;
};

class HoldReleaseError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

/* Releases a hold — but only once the condition that caused it is
   actually gone. An admin can't just wish a bank account verified or a
   partner reactivated; compliance_review/incomplete_info/manual have no
   objective check and are released purely at the admin's discretion. */
const releaseSettlementHold = async (settlement, { byUserId, req } = {}) => {
  const code = settlement.hold?.code;

  if (code === "bank_unverified" || code === "bank_change_pending") {
    const bankAccount = await PartnerBankAccount.findOne({ partnerId: settlement.partnerId });
    if (!bankAccount || bankAccount.verification.status !== "verified") {
      throw new HoldReleaseError("The partner's bank account still isn't verified — verify it before releasing this hold.");
    }
  }

  if (code === "partner_suspended") {
    const partner = await Partner.findById(settlement.partnerId);
    if (!partner || partner.status !== "active") {
      throw new HoldReleaseError("This partner is still suspended — reactivate the partner before releasing this hold.");
    }
  }

  const toStatus = settlement.hold?.previousStatus || "pending_approval";
  settlement.status = toStatus;
  settlement.hold.releasedBy = byUserId || undefined;
  settlement.hold.releasedAt = new Date();
  await settlement.save();

  await recordSettlementHistory(settlement, {
    action: "released",
    fromStatus: "on_hold",
    toStatus,
    byUserId,
    req
  });

  await logActivity({
    partnerId: settlement.partnerId,
    performedByType: byUserId ? "spotx_user" : "system",
    performedByUserId: byUserId,
    activityType: "settlement_released",
    entityType: "PartnerSettlement",
    entityId: settlement._id,
    description: `Settlement ${settlement.settlementNumber} released from hold.`,
    req
  });

  await notifyPartner(settlement.partnerId, {
    type: "settlement_released",
    title: "Settlement hold released",
    message: `Your settlement ${settlement.settlementNumber} is no longer on hold.`,
    entityId: settlement._id
  });

  return settlement;
};

/* Auto-release path for objective causes only — e.g. right after an
   admin re-verifies a bank account. Any settlement whose root cause
   isn't actually resolved yet is silently left on hold. */
const releaseSettlementsForPartnerByCodes = async (partnerId, codes, { byUserId, req } = {}) => {
  const settlements = await PartnerSettlement.find({
    partnerId,
    status: "on_hold",
    "hold.code": { $in: codes }
  });

  const released = [];
  for (const settlement of settlements) {
    try {
      await releaseSettlementHold(settlement, { byUserId, req });
      released.push(settlement);
    } catch (error) {
      // Root cause not actually resolved for this one yet — leave it held.
    }
  }
  return released;
};

module.exports = {
  HOLD_REASON_LABEL,
  HoldReleaseError,
  checkPartnerPayoutEligibility,
  checkBillRequirement,
  isGstRegistered,
  notifyBillDue,
  checkSettlementPayoutReadiness,
  putSettlementOnHold,
  holdSettlementsForPartner,
  releaseSettlementHold,
  releaseSettlementsForPartnerByCodes
};
