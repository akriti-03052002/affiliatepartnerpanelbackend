const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const { LEAD_STATUSES } = require("../config/constant");

/* ============================================================
   PARTNER LEAD
   One record for the whole lifecycle: the partner submits a lead,
   SPOTX works it into a deal, and when the deal closes an admin
   records the deal value and the commission for that deal.

   new → contacted → deal → won | lost
                   ↘ rejected (not a fit, never became a deal)
============================================================ */

const PartnerReferralSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    referralCode: {
      type: String,
      default: ""
    },

    /* CUSTOMER */
    customer: {
      companyName: { type: String, required: true },
      contactName: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "India" }
    },

    /* REQUIREMENT (as submitted by the partner). The partner only gives the
       number of screens — the estimated value is worked out by SPOTX from
       the screen count and current screen pricing (see adminLeadController). */
    requirement: {
      screenCount: { type: Number, default: 0, min: 0 },
      businessType: { type: String, default: "" },
      notes: { type: String, default: "" }
    },

    /* SOURCE */
    source: {
      type: String,
      enum: ["partner_portal", "referral_link", "manual", "campaign", "api"],
      default: "partner_portal"
    },

    tracking: {
      utmSource: String,
      utmMedium: String,
      utmCampaign: String,
      landingPage: String
    },

    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: "new",
      index: true
    },

    /* CLOSURE — set when the lead is won, lost or rejected */
    closure: {
      // Won: deal value = screenCount × pricePerScreen of the chosen plan.
      plan: { type: String, enum: ["basic", "premium"] },
      pricePerScreen: { type: Number, default: 0 },
      dealValue: { type: Number, default: 0 },
      screenCount: { type: Number, default: 0 },
      commissionAmount: { type: Number, default: 0 },
      commissionId: { type: ObjectId, ref: "PartnerCommission" },
      reason: { type: String, default: "" },
      closedAt: Date,
      closedBy: { type: ObjectId, ref: "User" }
    },

    assignedTo: {
      salesUserId: { type: ObjectId, ref: "User" }
    }
  },
  {
    timestamps: true
  }
);

PartnerReferralSchema.index({ partnerId: 1, createdAt: -1 });

module.exports = model("PartnerReferral", PartnerReferralSchema);
