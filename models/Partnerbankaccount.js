const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const { VERIFICATION_STATUS } = require("../config/constant");

/* ============================================================
   SECURE PARTNER BANK DETAILS
   VERY IMPORTANT:
   This collection should have restricted application access.
   accountNumberEncrypted and ifscEncrypted should be encrypted
   BEFORE they reach MongoDB.
   Partner users should NOT be allowed to query this collection
   directly.
============================================================ */

const PartnerBankAccountSchema = new Schema(
  {
    partnerId: {
      type: ObjectId,
      ref: "Partner",
      required: true,
      unique: true,
      index: true
    },

    accountHolderName: {
      type: String,
      required: true
    },

    bankName: {
      type: String,
      required: true
    },

    /* SENSITIVE */
    accountNumberEncrypted: {
      type: String,
      required: true,
      select: false
    },

    accountNumberLast4: {
      type: String,
      required: true
    },

    ifscEncrypted: {
      type: String,
      required: true,
      select: false
    },

    ifscMasked: {
      type: String,
      default: ""
    },

    accountType: {
      type: String,
      enum: ["current", "savings", "other"],
      required: true
    },

    /* CANCELLED CHEQUE */
    cancelledChequeDocumentId: {
      type: ObjectId,
      ref: "PartnerDocument"
    },

    /* VERIFICATION */
    verification: {
      status: {
        type: String,
        enum: VERIFICATION_STATUS,
        default: "pending"
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
      },

      // Set alongside a "verified" decision made without a Razorpay match
      // (razorpayCheck.nameMatchStatus !== "matched") — an admin's explicit
      // reason for overriding the automated check (e.g. maiden vs married
      // name). Logged to PartnerActivity too; kept here for a quick audit
      // trail on the account itself.
      overrideReason: {
        type: String,
        default: ""
      }
    },

    /* RAZORPAY ₹1 VERIFICATION PAYMENT (test-mode Checkout during dev)
       Populated by partnerBankController.initiateBankVerification (creates
       the ₹1 Order) and confirmBankVerification / razorpayWebhookController
       (fill in the result once the payment is confirmed captured — see
       services/partnerBankVerification.applyBankVerificationPayment, the
       shared logic both of those call). Purely informational until an
       admin acts on it via adminBankController.verifyBankAccount, which is
       the only thing that flips `verification.status` and
       `commissionEligibility` below. */
    razorpayCheck: {
      paymentStatus: {
        type: String,
        enum: ["not_initiated", "pending", "captured", "failed"],
        default: "not_initiated"
      },
      orderId: { type: String, default: "", index: true },
      paymentId: { type: String, default: "" },
      // Payment method the partner actually used (upi/card/netbanking/
      // wallet) — bank-name matching only works for netbanking, where
      // Razorpay reports which bank the test payment went through.
      method: { type: String, default: "" },
      bankCode: { type: String, default: "" },
      matchedBankName: { type: String, default: "" },
      nameMatchStatus: {
        type: String,
        enum: ["not_checked", "matched", "mismatched", "unverifiable"],
        default: "not_checked"
      },
      failureReason: { type: String, default: "" },
      completedAt: { type: Date }
    },

    // Only ever set to "eligible" by adminBankController.verifyBankAccount
    // once both the Razorpay check and the admin's own review pass —
    // commissionEngine.js refuses to generate commission for a partner
    // whose bank account isn't "eligible".
    commissionEligibility: {
      type: String,
      enum: ["not_eligible", "eligible"],
      default: "not_eligible"
    },

    /* SECURITY AUDIT */
    security: {
      encryptedAt: {
        type: Date
      },

      keyVersion: {
        type: String
      },

      lastAccessedAt: {
        type: Date
      },

      lastAccessedBy: {
        type: ObjectId,
        ref: "User"
      }
    }
  },
  {
    timestamps: true
  }
);

module.exports = model("PartnerBankAccount", PartnerBankAccountSchema);