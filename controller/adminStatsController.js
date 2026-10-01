const { Partner, PartnerReferral, PartnerDocument, PartnerBankAccount, PartnerCommission, PartnerSettlement } = require("../models/Index");

/* ============================================================
   ADMIN — CROSS-CUTTING KPI AGGREGATION
   Read-only rollups for the admin dashboard, sourced entirely
   from existing collections — no new stat fields.
============================================================ */

const groupCounts = (rows) => rows.reduce((acc, r) => ({ ...acc, [r._id || "unknown"]: r.count }), {});

const getKpis = async (req, res) => {
  const affiliatePartnerIds = await Partner.distinct("_id", { partnerType: "affiliate" });
  const [
    totalPartners, activePartners, partnersByType, partnersByStatus,
    totalLeads, leadsByStatus,
    documentsByStatus, bankAccountsByStatus, commissionsByStatus, settlementsByStatus,
    commissionTotals, paidPayouts
  ] = await Promise.all([
    Partner.countDocuments({ partnerType: "affiliate" }),
    Partner.countDocuments({ partnerType: "affiliate", status: "active" }),
    Partner.aggregate([
      { $match: { partnerType: "affiliate" } },
      { $group: { _id: "$partnerType", count: { $sum: 1 } } }
    ]),
    Partner.aggregate([
      { $match: { partnerType: "affiliate" } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]),
    PartnerReferral.countDocuments({ partnerId: { $in: affiliatePartnerIds } }),
    PartnerReferral.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]),
    PartnerDocument.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: "$verification.status", count: { $sum: 1 } } }
    ]),
    PartnerBankAccount.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: "$verification.status", count: { $sum: 1 } } }
    ]),
    PartnerCommission.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: "$settlement.status", count: { $sum: 1 } } }
    ]),
    PartnerSettlement.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]),
    PartnerCommission.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds } } },
      { $group: { _id: null, total: { $sum: "$calculation.netCommission" } } }
    ]),
    PartnerSettlement.aggregate([
      { $match: { partnerId: { $in: affiliatePartnerIds }, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount.net" } } }
    ])
  ]);

  return res.json({
    success: true,
    data: {
      totalPartners,
      activePartners,
      partnersByType: groupCounts(partnersByType),
      partnersByStatus: groupCounts(partnersByStatus),
      totalLeads,
      leadsByStatus: groupCounts(leadsByStatus),
      documentsByStatus: groupCounts(documentsByStatus),
      bankAccountsByStatus: groupCounts(bankAccountsByStatus),
      commissionsByStatus: groupCounts(commissionsByStatus),
      settlementsByStatus: groupCounts(settlementsByStatus),
      totalCommissionGenerated: commissionTotals[0]?.total || 0,
      totalPayoutsPaid: paidPayouts[0]?.total || 0
    }
  });
};

module.exports = { getKpis };
