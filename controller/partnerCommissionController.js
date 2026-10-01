const { PartnerCommission } = require("../models/Index");

/* ============================================================
   PARTNER REFERRAL REWARDS (read-only for partners)
   Stored as PartnerCommission internally. Partners see the reward
   SPOTX set for each won lead, never the deal value or estimate.
============================================================ */

const listCommissions = async (req, res) => {
  const commissions = await PartnerCommission.find({ partnerId: req.partner._id })
    .select("-transaction.revenue")
    .sort({ createdAt: -1 })
    .populate("referralId", "customer.companyName");

  return res.json({ success: true, data: commissions });
};

module.exports = { listCommissions };
