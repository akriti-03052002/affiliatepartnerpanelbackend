const { PartnerCommission } = require("../models/Index");
const { getAffiliatePartnerIds } = require("../utils/affiliateScope");

/* ============================================================
   ADMIN — REFERRAL REWARDS (read-only)
   A reward is created already approved when a lead is marked won, and
   goes straight into a settlement (see adminLeadController.markWon), so
   there is nothing to approve here — this list feeds the affiliate page
   and the Settlements page.
============================================================ */

const listCommissions = async (req, res) => {
  const { status, partnerId } = req.query;

  const affiliatePartnerIds = await getAffiliatePartnerIds();
  const filter = { partnerId: { $in: affiliatePartnerIds } };
  if (status) filter["settlement.status"] = status;
  if (partnerId) {
    filter.partnerId = affiliatePartnerIds.some((id) => String(id) === partnerId) ? partnerId : { $in: [] };
  }

  const commissions = await PartnerCommission.find(filter)
    .sort({ createdAt: -1 })
    .populate("partnerId", "partnerCode legalEntity.businessName")
    .populate("referralId", "customer.companyName");

  return res.json({ success: true, data: commissions });
};

module.exports = { listCommissions };
