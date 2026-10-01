const { PartnerReferral, PartnerCommission, PartnerBankAccount } = require("../models/Index");

/**
 * Real numbers for affiliates, counted from their actual leads and rewards
 * at request time — not the cached Partner.stats counters, which only get
 * incremented/decremented in some code paths and can drift.
 *
 * Returns { [partnerId]: stats } for every id passed in (zeros if none).
 */
const EMPTY = () => ({
  leads: 0, newLeads: 0, contacted: 0, openDeals: 0, won: 0, lost: 0, rejected: 0,
  dealValue: 0,
  rewardsPending: 0, rewardsApproved: 0, rewardsPaid: 0, rewardsTotal: 0,
  lastLeadAt: null,
  bankStatus: "not_submitted"
});

const getLiveStats = async (partnerIds) => {
  const ids = partnerIds.map((id) => id);
  const byId = Object.fromEntries(ids.map((id) => [String(id), EMPTY()]));
  if (ids.length === 0) return byId;

  const [leadRows, rewardRows, banks] = await Promise.all([
    PartnerReferral.aggregate([
      { $match: { partnerId: { $in: ids } } },
      {
        $group: {
          _id: { partnerId: "$partnerId", status: "$status" },
          count: { $sum: 1 },
          dealValue: { $sum: { $ifNull: ["$closure.dealValue", 0] } },
          lastLeadAt: { $max: "$createdAt" }
        }
      }
    ]),
    PartnerCommission.aggregate([
      { $match: { partnerId: { $in: ids }, "settlement.status": { $ne: "cancelled" } } },
      { $group: { _id: { partnerId: "$partnerId", status: "$settlement.status" }, total: { $sum: "$calculation.netCommission" } } }
    ]),
    PartnerBankAccount.find({ partnerId: { $in: ids } }).select("partnerId verification.status").lean()
  ]);

  const LEAD_FIELD = { new: "newLeads", contacted: "contacted", deal: "openDeals", won: "won", lost: "lost", rejected: "rejected" };

  for (const row of leadRows) {
    const s = byId[String(row._id.partnerId)];
    s.leads += row.count;
    if (LEAD_FIELD[row._id.status]) s[LEAD_FIELD[row._id.status]] += row.count;
    if (row._id.status === "won") s.dealValue += row.dealValue;
    if (!s.lastLeadAt || row.lastLeadAt > s.lastLeadAt) s.lastLeadAt = row.lastLeadAt;
  }

  for (const row of rewardRows) {
    const s = byId[String(row._id.partnerId)];
    const status = row._id.status;
    if (status === "pending") s.rewardsPending += row.total;
    else if (status === "approved" || status === "eligible") s.rewardsApproved += row.total;
    else if (status === "settled") s.rewardsPaid += row.total;
    s.rewardsTotal += row.total;
  }

  for (const bank of banks) {
    byId[String(bank.partnerId)].bankStatus = bank.verification?.status || "pending";
  }

  return byId;
};

module.exports = { getLiveStats };
