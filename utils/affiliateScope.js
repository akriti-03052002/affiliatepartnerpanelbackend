const mongoose = require("mongoose");
const { Partner } = require("../models/Index");

const getAffiliatePartnerIds = () => Partner.distinct("_id", { partnerType: "affiliate" });

const isAffiliatePartner = async (partnerId) => {
  if (!mongoose.isValidObjectId(partnerId)) return false;
  return Boolean(await Partner.exists({ _id: partnerId, partnerType: "affiliate" }));
};

module.exports = { getAffiliatePartnerIds, isAffiliatePartner };
