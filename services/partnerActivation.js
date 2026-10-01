const { Partner, PartnerNotification } = require("../models/Index");
const { isPartnerFullyVerified } = require("../utils/partnerVerification");
const { attachPartnerAgreement } = require("./generatePartnerAgreement");

const autoActivatePartnerIfVerified = async (partnerId, adminUserId) => {
  const partner = await Partner.findOne({ _id: partnerId, partnerType: "affiliate" });

  if (!partner || partner.status === "active") return null;

  const fullyVerified = await isPartnerFullyVerified(partnerId, partner.partnerType);
  if (!fullyVerified) return null;

  partner.status = "active";
  partner.verification.overallStatus = "verified";
  partner.verification.verifiedBy = adminUserId;
  partner.verification.verifiedAt = new Date();
  await partner.save();

  await attachPartnerAgreement(partner, adminUserId);

  await PartnerNotification.create({
    partnerId: partner._id,
    type: "account_verified",
    title: "Your account is fully verified",
    message: "Your documents and bank account are verified — you're now an active Affiliate.",
    entity: { type: "Partner", entityId: partner._id }
  });

  return { partner };
};

module.exports = { autoActivatePartnerIfVerified };
