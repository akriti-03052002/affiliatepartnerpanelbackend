const { PartnerBankAccount } = require("../models/Index");
const { applyBankVerificationPayment } = require("../services/partnerBankVerification");
const { verifyWebhookSignature } = require("../utils/razorpay");

/* ============================================================
   RAZORPAY WEBHOOK
   Safety net for the partner's ₹1 bank verification payment: if the
   partner's browser closes (or the network drops) right after Checkout
   succeeds but before the app's own confirm call lands, this still records
   the result — Razorpay retries webhook delivery on failure, the browser
   call does not.

   (Partner settlement payouts are always Offline or Razorpay-verify,
   admin-initiated and admin-confirmed — there's no automated payout flow
   needing a webhook here.)

   Mounted in index.js with express.raw() BEFORE the global express.json()
   parser — the signature below is computed over the exact raw bytes
   Razorpay sent, so it must never be re-serialized through JSON.parse
   first.

   Configure this in the Razorpay Dashboard -> Webhooks:
     URL: <your API base>/api/webhooks/razorpay
     Secret: same value as RAZORPAY_WEBHOOK_SECRET in .env
     Events: payment.captured, payment.failed
     Only payments with payment.notes.purpose === "partner_bank_verification"
     are handled (see partnerBankController.initiateBankVerification).
============================================================ */

const handleRazorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];

  if (!signature || !(await verifyWebhookSignature({ rawBody: req.body, signature }))) {
    return res.status(400).json({ success: false, message: "Invalid webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ success: false, message: "Malformed webhook payload." });
  }

  try {
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (!payment?.order_id) return res.json({ success: true });

      if (payment.notes?.purpose === "partner_bank_verification") {
        const bankAccount = await PartnerBankAccount.findOne({ "razorpayCheck.orderId": payment.order_id });
        if (bankAccount && payment.amount === 100) {
          await applyBankVerificationPayment(bankAccount, payment);
        }
      }
    } else if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      if (!payment?.order_id) return res.json({ success: true });

      if (payment.notes?.purpose === "partner_bank_verification") {
        await PartnerBankAccount.findOneAndUpdate(
          { "razorpayCheck.orderId": payment.order_id, "razorpayCheck.paymentStatus": { $ne: "captured" } },
          {
            $set: {
              "razorpayCheck.paymentStatus": "failed",
              "razorpayCheck.failureReason": payment.error_description || "Payment failed."
            }
          }
        );
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("handleRazorpayWebhook error:", error);
    // 500 so Razorpay retries delivery instead of treating this as handled.
    return res.status(500).json({ success: false, message: "Webhook processing failed." });
  }
};

module.exports = { handleRazorpayWebhook };
