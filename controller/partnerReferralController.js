const { PartnerReferral, Partner } = require("../models/Index");
const logActivity = require("../utils/logActivity");

/* ============================================================
   PARTNER LEADS
   Partners only generate leads and follow them. Moving a lead to a
   deal and closing it (with the commission) is done by SPOTX —
   see adminLeadController.
============================================================ */

const listReferrals = async (req, res) => {
  // Deal value is SPOTX-internal; the partner only sees their reward.
  const referrals = await PartnerReferral.find({ partnerId: req.partner._id })
    .select("-closure.dealValue -closure.closedBy")
    .sort({ createdAt: -1 });

  return res.json({ success: true, data: referrals });
};

const createReferral = async (req, res) => {
  try {
    const { customer, requirement } = req.body;

    if (!customer?.companyName) {
      return res.status(400).json({ success: false, message: "Customer company name is required." });
    }

    const screenCount = Number(requirement?.screenCount);
    if (!Number.isInteger(screenCount) || screenCount < 1) {
      return res.status(400).json({ success: false, message: "Enter how many screens the customer needs." });
    }

    // Partners don't set a value — only the screen count. SPOTX estimates
    // the value from screens × screen pricing on its side.
    const referral = await PartnerReferral.create({
      partnerId: req.partner._id,
      referralCode: req.partner.referral?.referralCode || "",
      customer,
      requirement: {
        screenCount,
        businessType: requirement?.businessType || "",
        notes: requirement?.notes || ""
      },
      source: "partner_portal",
      status: "new"
    });

    await Partner.updateOne({ _id: req.partner._id }, { $inc: { "stats.totalLeads": 1 } });

    await logActivity({
      partnerId: req.partner._id,
      performedByType: "partner_user",
      performedByUserId: req.partnerUser._id,
      activityType: "lead_created",
      entityType: "PartnerReferral",
      entityId: referral._id,
      description: `${req.partnerUser.name} generated a lead for ${customer.companyName}.`,
      req
    });

    return res.status(201).json({ success: true, message: "Lead generated. SPOTX will take it from here.", data: referral });
  } catch (error) {
    console.error("createReferral error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong generating the lead." });
  }
};

module.exports = { listReferrals, createReferral };
