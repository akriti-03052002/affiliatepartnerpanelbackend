const { SettlementSetting, ScreenPricing } = require("../models/Index");
const { getMaskedSettings, updateSettings } = require("../utils/paymentGatewayConfig");
const { getAffiliatePartnerIds, isAffiliatePartner } = require("../utils/affiliateScope");

/* ============================================================
   ADMIN — SETTLEMENT SETTING / PRICING / GATEWAY
   Plain CRUD for the configuration resources. Grouped in one
   file since each is a small, near-identical pattern.
============================================================ */

// ---- Settlement Settings ----

const listSettlementSettings = async (req, res) => {
  const settings = await SettlementSetting.find({
    partnerId: { $in: await getAffiliatePartnerIds() }
  }).populate("partnerId", "partnerCode legalEntity.businessName");
  return res.json({ success: true, data: settings });
};

const upsertSettlementSetting = async (req, res) => {
  try {
    const { partnerId, ...rest } = req.body;

    if (!partnerId) {
      return res.status(400).json({ success: false, message: "partnerId is required." });
    }
    if (!(await isAffiliatePartner(partnerId))) {
      return res.status(404).json({ success: false, message: "Affiliate not found." });
    }

    const setting = await SettlementSetting.findOneAndUpdate(
      { partnerId },
      { $set: rest, $setOnInsert: { partnerId } },
      { returnDocument: "after", upsert: true, runValidators: true }
    );

    return res.json({ success: true, message: "Settlement setting saved.", data: setting });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ---- Screen Pricing (global Basic / Premium price-per-screen plans) ----

const getScreenPricing = async (req, res) => {
  let pricing = await ScreenPricing.findOne();
  if (!pricing) pricing = await ScreenPricing.create({});
  return res.json({ success: true, data: pricing });
};

const updateScreenPricing = async (req, res) => {
  try {
    const { basicPricePerScreen, premiumPricePerScreen } = req.body;

    if (Number(basicPricePerScreen) < 0 || Number(premiumPricePerScreen) < 0) {
      return res.status(400).json({ success: false, message: "Valid prices are required for both plans." });
    }

    const existing = await ScreenPricing.findOne();
    const update = { basicPricePerScreen, premiumPricePerScreen };
    const pricing = existing
      ? await ScreenPricing.findByIdAndUpdate(existing._id, update, { returnDocument: "after", runValidators: true })
      : await ScreenPricing.create(update);

    return res.json({ success: true, message: "Screen pricing updated.", data: pricing });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ---- Payment Gateway (Razorpay credentials) ----
// Never returns a decrypted secret — see utils/paymentGatewayConfig for
// exactly what's exposed vs kept write-only.

const getPaymentGatewaySettings = async (req, res) => {
  const settings = await getMaskedSettings();
  return res.json({ success: true, data: settings });
};

const updatePaymentGatewaySettings = async (req, res) => {
  try {
    const { razorpay } = req.body;
    await updateSettings({ razorpay }, req.adminUser._id);
    const settings = await getMaskedSettings();
    return res.json({ success: true, message: "Payment gateway settings saved.", data: settings });
  } catch (error) {
    console.error("updatePaymentGatewaySettings error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong saving these settings." });
  }
};

module.exports = {
  listSettlementSettings, upsertSettlementSetting,
  getScreenPricing, updateScreenPricing,
  getPaymentGatewaySettings, updatePaymentGatewaySettings
};
