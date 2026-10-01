const { PartnerReferral, ScreenPricing } = require("../models/Index");
const { LEAD_STATUSES } = require("../config/constant");
const { createCommissionForWonLead } = require("../services/commissionEngine");
const { createSettlementBatch } = require("../services/settlementCreation");
const logActivity = require("../utils/logActivity");
const { getAffiliatePartnerIds } = require("../utils/affiliateScope");

/* ============================================================
   ADMIN — LEADS & DEALS
   One pipeline: new → contacted → deal (by stage) → won | lost,
   or rejected before it becomes a deal. Closing a lead as won is
   where the admin sets that deal's commission.
============================================================ */

const OPEN_STATUSES = ["new", "contacted"];

// Monthly price per screen for each plan (Admin → Screen Pricing). A lead's
// estimated value uses Basic; when a lead is won the admin picks the plan and
// the deal value is worked out here as screens × that plan's price — never
// typed in, so it always matches the current pricing.
const getPlanPrices = async () => {
  const pricing = await ScreenPricing.findOne().lean();
  const fallback = (field) => ScreenPricing.schema.path(field).defaultValue;
  return {
    basic: pricing?.basicPricePerScreen ?? fallback("basicPricePerScreen"),
    premium: pricing?.premiumPricePerScreen ?? fallback("premiumPricePerScreen")
  };
};

const leadScreens = (lead) => lead.requirement?.screenCount || 0;

const estimateValue = (screens, pricePerScreen) => screens * pricePerScreen;

const findLead = async (id) => PartnerReferral.findOne({
  _id: id,
  partnerId: { $in: await getAffiliatePartnerIds() }
});

const logLead = (req, lead, activityType, description) => logActivity({
  partnerId: lead.partnerId,
  performedByType: "spotx_user",
  performedByUserId: req.adminUser._id,
  activityType,
  entityType: "PartnerReferral",
  entityId: lead._id,
  description,
  req
});

const listLeads = async (req, res) => {
  const { status, partnerId } = req.query;

  const affiliatePartnerIds = await getAffiliatePartnerIds();
  const filter = { partnerId: { $in: affiliatePartnerIds } };
  if (status && LEAD_STATUSES.includes(status)) filter.status = status;
  if (partnerId) {
    filter.partnerId = affiliatePartnerIds.some((id) => String(id) === partnerId) ? partnerId : { $in: [] };
  }

  const [leads, planPrices] = await Promise.all([
    PartnerReferral.find(filter)
      .sort({ updatedAt: -1 })
      .populate("partnerId", "partnerCode legalEntity.businessName primaryContact.name")
      .lean(),
    getPlanPrices()
  ]);

  return res.json({
    success: true,
    planPrices,
    pricePerScreen: planPrices.basic,
    data: leads.map((lead) => ({ ...lead, estimatedValue: estimateValue(leadScreens(lead), planPrices.basic) }))
  });
};

const markContacted = async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

  if (lead.status !== "new") {
    return res.status(400).json({ success: false, message: `Lead is already ${lead.status}.` });
  }

  lead.status = "contacted";
  await lead.save();
  await logLead(req, lead, "lead_updated", `${req.adminUser.name} contacted ${lead.customer.companyName}.`);

  return res.json({ success: true, message: "Lead marked contacted.", data: lead });
};

const markWon = async (req, res) => {
  try {
    const plan = req.body.plan;
    const screenCount = Number(req.body.screenCount);
    const commissionAmount = Number(req.body.commissionAmount);

    if (!["basic", "premium"].includes(plan)) {
      return res.status(400).json({ success: false, message: "Choose the plan (Basic or Premium)." });
    }
    if (!Number.isInteger(screenCount) || screenCount < 1) {
      return res.status(400).json({ success: false, message: "Enter the number of screens." });
    }

    const pricePerScreen = (await getPlanPrices())[plan];
    const dealValue = estimateValue(screenCount, pricePerScreen);
    if (!(dealValue > 0)) {
      return res.status(400).json({ success: false, message: `The ${plan} plan has no price set — set it in Screen Pricing first.` });
    }
    if (!(commissionAmount > 0)) {
      return res.status(400).json({ success: false, message: "Enter the Referral Reward for this lead." });
    }

    const lead = await findLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

    if (!OPEN_STATUSES.includes(lead.status)) {
      return res.status(400).json({ success: false, message: `Lead is already ${lead.status}.` });
    }

    // Commission first: if the partner isn't commission-eligible this
    // throws and the lead stays an open deal instead of "won" with no payout.
    const commission = await createCommissionForWonLead({
      lead, dealValue, screenCount, commissionAmount, req, adminUser: req.adminUser
    });

    lead.status = "won";
    lead.closure = {
      plan,
      pricePerScreen,
      dealValue,
      screenCount,
      commissionAmount,
      commissionId: commission._id,
      reason: "",
      closedAt: new Date(),
      closedBy: req.adminUser._id
    };
    await lead.save();
    await logLead(req, lead, "deal_won", `${req.adminUser.name} closed the deal with ${lead.customer.companyName} as won.`);

    // Straight to payout: one settlement per won lead, ready to pay (offline
    // or online) from Settlements — or on hold with the reason if the partner
    // can't be paid yet (e.g. bank not verified).
    const { settlement, heldReason } = await createSettlementBatch({
      partnerId: lead.partnerId,
      commissions: [commission],
      byUserId: req.adminUser._id,
      req,
      approve: true
    });

    return res.json({
      success: true,
      message: heldReason
        ? `Lead won. Settlement ${settlement.settlementNumber} created but on hold: ${heldReason}`
        : `Lead won. Settlement ${settlement.settlementNumber} is ready to pay in Settlements.`,
      data: { lead, commission, settlement }
    });
  } catch (error) {
    console.error("markWon error:", error);
    return res.status(400).json({ success: false, message: error.message || "Something went wrong closing the deal." });
  }
};

// Rejected = not a fit, duplicate, unreachable, or the customer said no.
const closeWithoutCommission = (status) => async (req, res) => {
  const lead = await findLead(req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });

  if (!OPEN_STATUSES.includes(lead.status)) {
    return res.status(400).json({ success: false, message: `A ${lead.status} lead can't be marked ${status}.` });
  }

  lead.status = status;
  lead.closure = { reason: req.body.reason || "", closedAt: new Date(), closedBy: req.adminUser._id };
  await lead.save();
  await logLead(
    req, lead,
    "lead_updated",
    `${req.adminUser.name} marked the lead for ${lead.customer.companyName} ${status}.`
  );

  return res.json({ success: true, message: `Lead marked ${status}.`, data: lead });
};

module.exports = {
  listLeads,
  markContacted,
  markWon,
  rejectLead: closeWithoutCommission("rejected")
};
