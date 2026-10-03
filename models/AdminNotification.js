const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/* ============================================================
   ADMIN NOTIFICATIONS
   One shared feed for the SPOTX team. Each notification names the admin
   roles that can act on it (super_admin always sees everything), and
   read state is tracked per admin in readBy.
============================================================ */

const AdminNotificationSchema = new Schema(
  {
    type: {
      type: String,
      required: true
    },

    title: {
      type: String,
      default: ""
    },

    message: {
      type: String,
      default: ""
    },

    // Admin panel path to open when the notification is clicked.
    link: {
      type: String,
      default: ""
    },

    // Empty = every admin role.
    audienceRoles: {
      type: [{ type: String, enum: ["super_admin", "kyc_reviewer", "finance"] }],
      default: []
    },

    partnerId: {
      type: ObjectId,
      ref: "Partner"
    },

    entity: {
      type: { type: String },
      entityId: { type: ObjectId }
    },

    readBy: {
      type: [{ type: ObjectId, ref: "User" }],
      default: []
    }
  },
  {
    timestamps: true
  }
);

AdminNotificationSchema.index({ createdAt: -1 });

module.exports = model("AdminNotification", AdminNotificationSchema);
