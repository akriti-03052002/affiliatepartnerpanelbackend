const { Partner, PartnerCommission, PartnerNotification } = require("../models/Index");
const PartnerSettlementBill = require("../models/PartnerSettlementBill");
const logActivity = require("../utils/logActivity");
const { recordSettlementHistory } = require("../utils/settlementHistory");

/* ============================================================
   SETTLEMENT PAYOUT FULFILLMENT
   The one place that actually marks a PartnerSettlement "paid" and
   cascades the side effects (PartnerCommission rows -> "settled",
   Partner.stats, activity log, notification) — shared by both payment
   paths in adminSettlementController (offline, Razorpay-verify). Keeping
   this in one place is what guarantees the cascade can't drift between
   paths.

   payable.total (net + GST, if a verified bill exists) is what actually
   gets recorded as paid — see adminSettlementController.computePayableAmount.
============================================================ */

const finalizeSettlementPaid = async (settlement, { method, transactionId, paidAt, payableTotal, byUserId, req } = {}) => {
  const fromStatus = settlement.status;
  settlement.status = "paid";
  settlement.payment = {
    method: method || "bank_transfer",
    transactionId: transactionId || "",
    paidAt: paidAt || new Date()
  };
  await settlement.save();

  const paidAmount = payableTotal ?? settlement.amount.net;

  await recordSettlementHistory(settlement, {
    action: method === "online" ? "paid_razorpay" : "paid_offline",
    fromStatus,
    toStatus: "paid",
    amount: { net: settlement.amount.net, gst: paidAmount - settlement.amount.net, total: paidAmount, currency: settlement.amount.currency },
    meta: { method, transactionId },
    byUserId,
    req
  });

  await PartnerCommission.updateMany(
    { _id: { $in: settlement.commissionIds } },
    { $set: { "settlement.status": "settled" } }
  );

  const partner = await Partner.findById(settlement.partnerId);
  if (partner) {
    partner.stats.paidCommission += paidAmount;
    partner.stats.pendingCommission = Math.max(0, partner.stats.pendingCommission - settlement.amount.net);
    await partner.save();
  }

  await logActivity({
    partnerId: settlement.partnerId,
    performedByType: byUserId ? "spotx_user" : "system",
    performedByUserId: byUserId,
    activityType: "settlement_paid",
    entityType: "PartnerSettlement",
    entityId: settlement._id,
    description: `Settlement ${settlement.settlementNumber} marked paid.`,
    req
  });

  await PartnerNotification.create({
    partnerId: settlement.partnerId,
    type: "settlement_paid",
    title: "Payout completed",
    message: `Your settlement of ${paidAmount.toFixed(2)} has been paid.`,
    entity: { type: "PartnerSettlement", entityId: settlement._id }
  }).catch((error) => console.error("finalizeSettlementPaid: notification failed:", error.message));

  return settlement;
};

// net-of-TDS commission + GST from a verified bill (if the partner is
// GST-registered and one exists) — this is what's actually payable, as
// opposed to settlement.amount.net which is pre-GST commission math only.
const computePayableAmount = async (settlement) => {
  const bill = await PartnerSettlementBill.findOne({ settlementId: settlement._id, status: "verified" });
  const gst = bill?.amount?.gstAmount || 0;
  return { net: settlement.amount.net, gst, total: Math.round((settlement.amount.net + gst) * 100) / 100 };
};

module.exports = { finalizeSettlementPaid, computePayableAmount };
