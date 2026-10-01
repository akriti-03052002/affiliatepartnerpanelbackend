const { PartnerActivity, PartnerCommission, PartnerNotification, PartnerDocument, PartnerBankAccount } = require("../models/Index");
const { getRequiredDocumentTypes, getDefaultMetricLabel } = require("../utils/partnerVerification");

/* ============================================================
   PARTNER DASHBOARD
============================================================ */

// Distinct from partner.verification.overallStatus (a single flag for the
// whole partner) — this breaks it down into the two things the partner
// actually needs to act on separately. Affiliate verification requires
// PAN and a cancelled cheque.
const computeKycStatus = (documents, partnerType) => {
  const requiredTypes = getRequiredDocumentTypes(partnerType);
  const required = documents.filter((d) => requiredTypes.includes(d.documentType));

  if (required.length === 0) return "not_submitted";
  if (required.some((d) => d.verification.status === "rejected")) return "rejected";

  const verifiedTypes = new Set(required.filter((d) => d.verification.status === "verified").map((d) => d.documentType));
  if (requiredTypes.every((type) => verifiedTypes.has(type))) return "verified";

  return "pending";
};

const computeBankStatus = (bankAccount) => {
  if (!bankAccount) return "not_submitted";
  return bankAccount.verification.status; // pending | verified | rejected
};

const getDashboard = async (req, res) => {
  try {
    const partner = req.partner;

    const [recentActivity, unreadNotifications, commissionTrend, documents, bankAccount] = await Promise.all([
      PartnerActivity.find({ partnerId: partner._id }).sort({ createdAt: -1 }).limit(10),
      PartnerNotification.countDocuments({ partnerId: partner._id, read: false }),
      PartnerCommission.aggregate([
        { $match: { partnerId: partner._id } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            total: { $sum: "$calculation.netCommission" }
          }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        { $limit: 12 }
      ]),
      PartnerDocument.find({ partnerId: partner._id }),
      PartnerBankAccount.findOne({ partnerId: partner._id })
    ]);

    const metricLabel = getDefaultMetricLabel(partner.partnerType);
    const metricValue = partner.stats.totalLeads;

    return res.json({
      success: true,
      data: {
        // totalRevenue is deal value — SPOTX-internal, not shown to partners.
        stats: (({ totalRevenue, ...rest }) => rest)(partner.toObject().stats),
        metricLabel,
        metricValue,
        verificationStatus: partner.verification.overallStatus,
        partnerStatus: partner.status,
        partnerRejectionReason: partner.status === "rejected" ? partner.verification.rejectionReason : "",
        // Registration only collects name/email/phone/type now — business
        // name is the first thing filled in from Profile afterward, so its
        // absence is what "incomplete" hinges on.
        profileComplete: Boolean(partner.legalEntity.businessName),
        kycStatus: computeKycStatus(documents, partner.partnerType),
        bankStatus: computeBankStatus(bankAccount),
        unreadNotifications,
        recentActivity,
        commissionTrend: commissionTrend.map((row) => ({
          period: `${row._id.year}-${String(row._id.month).padStart(2, "0")}`,
          total: row.total
        }))
      }
    });
  } catch (error) {
    console.error("getDashboard error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong loading the dashboard." });
  }
};

module.exports = { getDashboard };
