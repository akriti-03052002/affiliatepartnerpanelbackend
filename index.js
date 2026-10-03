const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");

const partnerAuthMiddleware = require("./middleware/partnerAuthMiddleware");
const loadPartnerContext = require("./middleware/loadPartnerContext");
const requireVerifiedPartner = require("./middleware/requireVerifiedPartner");
const adminAuthMiddleware = require("./middleware/adminAuthMiddleware");
const { handleRazorpayWebhook } = require("./controller/razorpayWebhookController");

const partnerAuthRoutes = require("./router/partnerAuthRoutes");
const partnerUserRoutes = require("./router/partnerUserRoutes");
const partnerProfileRoutes = require("./router/partnerProfileRoutes");
const partnerDocumentRoutes = require("./router/partnerDocumentRoutes");
const partnerBankRoutes = require("./router/partnerBankRoutes");
const partnerReferralRoutes = require("./router/partnerReferralRoutes");
const partnerCommissionRoutes = require("./router/partnerCommissionRoutes");
const partnerSettlementRoutes = require("./router/partnerSettlementRoutes");
const partnerNotificationRoutes = require("./router/partnerNotificationRoutes");
const partnerDashboardRoutes = require("./router/partnerDashboardRoutes");

const adminAuthRoutes = require("./router/adminAuthRoutes");
const adminPartnerRoutes = require("./router/adminPartnerRoutes");
const adminDocumentRoutes = require("./router/adminDocumentRoutes");
const adminBankRoutes = require("./router/adminBankRoutes");
const adminLeadRoutes = require("./router/adminLeadRoutes");
const adminConfigRoutes = require("./router/adminConfigRoutes");
const adminCommissionRoutes = require("./router/adminCommissionRoutes");
const adminSettlementRoutes = require("./router/adminSettlementRoutes");
const adminStatsRoutes = require("./router/adminStatsRoutes");
const adminNotificationRoutes = require("./router/adminNotificationRoutes");

const app = express();

/* ==========================================
   MIDDLEWARE
========================================== */

// Render (and most hosts) sit one proxy in front of the app. Without this,
// req.ip is the proxy's address, so the login rate limiters would lump
// every visitor into one shared bucket.
app.set("trust proxy", 1);

app.use(helmet());

// The production frontend and local Vite are always allowed; CLIENT_URLS /
// CLIENT_URL add to this list (e.g. a LAN address or a preview deploy).
const DEFAULT_ORIGINS = [
  "https://affiliatepartnerpanelfrontend.vercel.app",
  "http://localhost:5173"
];

const allowedOrigins = [
  ...new Set(
    [...DEFAULT_ORIGINS, ...`${process.env.CLIENT_URLS || ""},${process.env.CLIENT_URL || ""}`.split(",")]
      // Browsers send the Origin header without a trailing slash, so a
      // "https://app.example.com/" entry would otherwise never match.
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean)
  )
];

app.use(
  cors({
    origin: allowedOrigins
  })
);

// Razorpay webhook: must be mounted with a raw body parser BEFORE the
// global express.json() below — signature verification needs the exact
// raw bytes Razorpay sent, which express.json() would otherwise consume.
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), handleRazorpayWebhook);

app.use(express.json());

/* ==========================================
   HEALTH CHECK
========================================== */

app.get("/", (req, res) => {
  res.json({ success: true, message: "SPOTX Partner Panel API running" });
});

/* ==========================================
   PARTNER ROUTES
   /auth is public; everything else requires a
   valid JWT + a fresh PartnerUser/Partner context.
========================================== */

app.use("/api/partner/auth", partnerAuthRoutes);


const partnerGuard = [partnerAuthMiddleware, loadPartnerContext];
// Everything a partner needs in order to GET verified stays open; anything
// that presumes verified status (referring, selling, getting paid, adding
// teammates) is locked until then.
const verifiedGuard = [...partnerGuard, requireVerifiedPartner];

app.use("/api/partner/team", verifiedGuard, partnerUserRoutes);
app.use("/api/partner/profile", partnerGuard, partnerProfileRoutes);
app.use("/api/partner/documents", partnerGuard, partnerDocumentRoutes);
app.use("/api/partner/bank", partnerGuard, partnerBankRoutes);
app.use("/api/partner/referrals", verifiedGuard, partnerReferralRoutes);
app.use("/api/partner/commissions", verifiedGuard, partnerCommissionRoutes);
app.use("/api/partner/settlements", verifiedGuard, partnerSettlementRoutes);
app.use("/api/partner/notifications", partnerGuard, partnerNotificationRoutes);
app.use("/api/partner/dashboard", partnerGuard, partnerDashboardRoutes);

/* ==========================================
   ADMIN ROUTES
   /auth is public; everything else requires a
   valid admin JWT (fully separate secret/model).
========================================== */

app.use("/api/admin/auth", adminAuthRoutes);

app.use("/api/admin/partners", adminAuthMiddleware, adminPartnerRoutes);
app.use("/api/admin/documents", adminAuthMiddleware, adminDocumentRoutes);
app.use("/api/admin/bank", adminAuthMiddleware, adminBankRoutes);
app.use("/api/admin/leads", adminAuthMiddleware, adminLeadRoutes);
app.use("/api/admin/config", adminAuthMiddleware, adminConfigRoutes);
app.use("/api/admin/commissions", adminAuthMiddleware, adminCommissionRoutes);
app.use("/api/admin/settlements", adminAuthMiddleware, adminSettlementRoutes);
app.use("/api/admin/stats", adminAuthMiddleware, adminStatsRoutes);
app.use("/api/admin/notifications", adminAuthMiddleware, adminNotificationRoutes);

/* ==========================================
   404 + ERROR HANDLER
========================================== */

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Something went wrong.",
    error: process.env.NODE_ENV === "development" ? error.stack : undefined
  });
});

/* ==========================================
   START
========================================== */

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
