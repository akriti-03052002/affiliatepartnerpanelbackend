const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   PARTNER ACTIVITY / AUDIT LOG
   Especially important for: bank details access, KYC verification,
   commission approval, settlement approval, tier changes
============================================================ */

const PartnerActivitySchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },

    performedBy: {
      type: {
        type: String,
        enum: ["partner_user", "spotx_user", "system"],
        required: true
      },
      userId: {
        type: ObjectId
      }
    },

    activityType: {
      type: String,
      enum: [
        "login",

        "lead_created",
        "lead_updated",

        "demo_scheduled",
        "demo_completed",

        "proposal_sent",

        "deal_won",
        "deal_lost",

        "commission_created",
        "commission_approved",

        "settlement_created",
        "settlement_paid",
        "settlement_held",
        "settlement_released",
        "settlement_failed",
        "settlement_retried",

        "document_uploaded",
        "document_verified",

        "bank_details_accessed",

        "tier_changed",

        "status_changed",

        "note"
      ],
      required: true
    },

    entity: {
      type: { type: String },
      entityId: { type: ObjectId }
    },

    description: {
      type: String,
      default: ""
    },

    metadata: {
      type: Schema.Types.Mixed
    },

    ipAddress: {
      type: String
    },

    userAgent: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

PartnerActivitySchema.index({ partnerId: 1, createdAt: -1 });

module.exports = model("PartnerActivity", PartnerActivitySchema);