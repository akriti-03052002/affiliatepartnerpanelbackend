const { PartnerSettlement, PartnerCommission, SettlementSetting } = require("../models/Index");
const { generateSettlementNumber } = require("../utils/generateCode");
const logActivity = require("../utils/logActivity");
const { recordSettlementHistory } = require("../utils/settlementHistory");
const { checkSettlementPayoutReadiness, putSettlementOnHold, notifyBillDue } = require("../utils/settlementHold");

/**
 * Bundles approved rewards into one settlement (payout) for a partner.
 *
 * approve: true  → the settlement is ready to pay right away (status
 *                  "approved"); used when a lead is marked won, since the
 *                  admin already decided the reward there.
 * approve: false → a "draft" batch that still needs approving.
 *
 * Either way, if the partner can't be paid yet (bank unverified, account
 * suspended...) the settlement goes on hold with the reason. Once approved,
 * the affiliate is asked for their bill, which must be verified before payment.
 * Returns { settlement, heldReason }.
 */
const createSettlementBatch = async ({ partnerId, commissions, byUserId, req, approve = false, period }) => {
  const gross = commissions.reduce((sum, c) => sum + c.calculation.netCommission, 0);

  const settlementSetting = await SettlementSetting.findOne({ partnerId });
  const tdsRate = settlementSetting?.tax?.tdsEnabled ? settlementSetting.tax.tdsRate : 0;
  const tdsAmount = (gross * tdsRate) / 100;
  const net = gross - tdsAmount;

  const settlement = await PartnerSettlement.create({
    settlementNumber: generateSettlementNumber(),
    partnerId,
    commissionIds: commissions.map((c) => c._id),
    period: { from: period?.from || undefined, to: period?.to || undefined },
    settlementType: settlementSetting?.settlementType || "manual",
    amount: { gross, deductions: tdsAmount, net, currency: "INR" },
    tax: { tdsRate, tdsAmount },
    status: "draft"
  });

  await PartnerCommission.updateMany(
    { _id: { $in: commissions.map((c) => c._id) } },
    { $set: { "settlement.status": "eligible", "settlement.settlementId": settlement._id } }
  );

  await recordSettlementHistory(settlement, {
    action: "created",
    toStatus: "draft",
    amount: { net, gst: 0, total: net, currency: "INR" },
    meta: { commissionCount: commissions.length },
    byUserId,
    req
  });

  await logActivity({
    partnerId,
    performedByType: "spotx_user",
    performedByUserId: byUserId,
    activityType: "settlement_created",
    entityType: "PartnerSettlement",
    entityId: settlement._id,
    description: `Settlement ${settlement.settlementNumber} of ₹${net.toFixed(2)} created.`,
    req
  });

  const eligibility = await checkSettlementPayoutReadiness(settlement);
  if (!eligibility.eligible) {
    await putSettlementOnHold(settlement, { code: eligibility.code, reason: eligibility.reason, byUserId, req });
    return { settlement, heldReason: eligibility.reason };
  }

  if (approve) {
    settlement.status = "approved";
    settlement.approvedBy = byUserId;
    settlement.approvedAt = new Date();
    await settlement.save();
    await recordSettlementHistory(settlement, { action: "approved", fromStatus: "draft", toStatus: "approved", byUserId, req });
    await notifyBillDue(settlement);
  }

  return { settlement, heldReason: null };
};

module.exports = { createSettlementBatch };
