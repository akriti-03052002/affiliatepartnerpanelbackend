const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const { PARTNER_TYPES, PARTNER_STATUS, VERIFICATION_STATUS } = require("../config/constant");

/* ============================================================
   PARTNER
============================================================ */

const PartnerSchema = new Schema(
  {
    /* BASIC IDENTITY */
    partnerCode: {
      type: String,
      unique: true,
      index: true,
      uppercase: true
    },

    partnerType: {
      type: String,
      enum: PARTNER_TYPES,
      required: true
    },

    /* BUSINESS INFORMATION */
    legalEntity: {
      // Not required at registration anymore — only phone/email/type/password
      // are collected up front (see partnerAuthController.registerPartner and
      // adminPartnerController.createPartner). The partner fills this in from
      // their Profile page afterward; until then dashboards/controllers treat
      // a blank businessName as "profile incomplete".
      businessName: {
        type: String,
        default: "",
        trim: true
      },
      legalName: {
        type: String,
        default: ""
      },
      entityType: {
        type: String,
        enum: [
          "proprietorship",
          "partnership",
          "llp",
          "private_limited",
          "public_limited",
          "individual",
          "other"
        ]
      },
      website: {
        type: String,
        default: ""
      },
      industry: {
        type: String,
        default: ""
      }
    },

    /* PRIMARY CONTACT */
    primaryContact: {
      name: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
      },
      phone: {
        type: String,
        default: ""
      },
      designation: {
        type: String,
        default: ""
      }
    },

    /* ADDRESS */
    address: {
      country: { type: String, default: "India" },
      state: { type: String, default: "" },
      city: { type: String, default: "" },
      addressLine1: { type: String, default: "" },
      addressLine2: { type: String, default: "" },
      pincode: { type: String, default: "" }
    },

    /* REFERRAL */
    referral: {
      referralCode: {
        type: String,
        unique: true,
        sparse: true,
        index: true,
        uppercase: true
      },
      referralLink: {
        type: String,
        default: ""
      }
    },

    /* VERIFICATION STATUS */
    verification: {
      overallStatus: {
        type: String,
        enum: VERIFICATION_STATUS,
        default: "not_submitted"
      },
      verifiedBy: {
        type: ObjectId,
        ref: "User"
      },
      verifiedAt: {
        type: Date
      },
      rejectionReason: {
        type: String,
        default: ""
      }
    },

    /* DASHBOARD AGGREGATES */
    stats: {
      totalLeads: { type: Number, default: 0 },
      qualifiedLeads: { type: Number, default: 0 },
      totalDeals: { type: Number, default: 0 },
      wonDeals: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      totalCommission: { type: Number, default: 0 },
      pendingCommission: { type: Number, default: 0 },
      approvedCommission: { type: Number, default: 0 },
      paidCommission: { type: Number, default: 0 }
    },

    /* SPOTX INTERNAL OWNER */
    owner: {
      salesUserId: {
        type: ObjectId,
        ref: "User"
      }
    },

    /* STATUS */
    status: {
      type: String,
      enum: PARTNER_STATUS,
      default: "draft",
      index: true
    }
  },
  {
    timestamps: true
  }
);

PartnerSchema.index({ partnerType: 1, status: 1 });

module.exports = model("Partner", PartnerSchema);