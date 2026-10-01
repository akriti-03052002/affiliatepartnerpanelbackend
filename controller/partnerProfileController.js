const { Partner } = require("../models/Index");
const { getRequiredDocumentTypes } = require("../utils/partnerVerification");
const { applyProfileUpdate } = require("../utils/partnerProfile");

/* ============================================================
   PARTNER PROFILE
============================================================ */

const getProfile = async (req, res) => {
  // Deal value (stats.totalRevenue) is SPOTX-internal — never sent to partners.
  const partner = req.partner.toObject();
  delete partner.stats?.totalRevenue;

  return res.json({
    success: true,
    data: {
      partner,
      user: req.partnerUser,
      requiredDocumentTypes: getRequiredDocumentTypes(req.partner.partnerType),
      profileComplete: Boolean(req.partner.legalEntity.businessName)
    }
  });
};

const updateProfile = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner._id);

    applyProfileUpdate(partner, req.body);
    await partner.save();

    return res.json({ success: true, message: "Profile updated.", data: partner });
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong updating your profile." });
  }
};

module.exports = { getProfile, updateProfile };
