const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { Partner, PartnerUser, EmailOtp } = require("../models/Index");
const { generatePartnerCode, generateReferralCode } = require("../utils/generateCode");
const { ROLE_PERMISSIONS } = require("../config/roles");
const logActivity = require("../utils/logActivity");
const notifyAdmins = require("../utils/notifyAdmins");
const { sendMail } = require("../utils/mailer");

// =====================================================
// GENERATE JWT
// =====================================================

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, partnerId: user.partnerId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

// =====================================================
// EMAIL OTP — registration email verification
// Two-step: sendEmailOtp emails a 6-digit code and upserts an EmailOtp
// record; verifyEmailOtp checks it and hands back a single-use
// verificationToken. registerPartner requires that token rather than
// trusting a client-side "verified" flag, so the OTP step can't be
// skipped by calling /register directly.
// =====================================================

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_VERIFIED_GRACE_MS = 30 * 60 * 1000; // how long a verified token stays usable for registration
const OTP_MAX_ATTEMPTS = 5;

const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

const sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await PartnerUser.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const otp = String(crypto.randomInt(100000, 1000000));

    await EmailOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otpHash: hashOtp(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        verified: false,
        verificationToken: undefined,
        verifiedAt: undefined
      },
      { upsert: true }
    );

    await sendMail({
      to: normalizedEmail,
      subject: "Your SPOTX Partner verification code",
      text: `Your verification code is ${otp}. It expires in 10 minutes.`,
      html: `
        <p>Your SPOTX Partner verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
        <p>This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      `
    });

    return res.json({ success: true, message: "OTP sent to your email." });
  } catch (error) {
    console.error("sendEmailOtp error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong sending the OTP." });
  }
};

const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = await EmailOtp.findOne({ email: normalizedEmail });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: "This OTP has expired. Request a new one." });
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: "Too many incorrect attempts. Request a new OTP." });
    }

    if (record.otpHash !== hashOtp(String(otp).trim())) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: "Incorrect OTP." });
    }

    const verificationToken = crypto.randomBytes(24).toString("hex");

    record.verified = true;
    record.verificationToken = verificationToken;
    record.verifiedAt = new Date();
    await record.save();

    return res.json({ success: true, message: "Email verified.", verificationToken });
  } catch (error) {
    console.error("verifyEmailOtp error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong verifying the OTP." });
  }
};

// =====================================================
// REGISTER PARTNER
// =====================================================

const registerPartner = async (req, res) => {
  try {
    const {
      partnerType,
      contactName, email, phone,
      password,
      emailVerificationToken
    } = req.body;

    // Everything else (business name, legal details, address) is filled in
    // later from the Profile page — see partnerProfileController.updateProfile
    // — and the partner's Dashboard/Profile flag the account as incomplete
    // until they do.
    if (!partnerType || !contactName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Partner type, name, email and phone are required."
      });
    }

    if (partnerType !== "affiliate") {
      return res.status(400).json({
        success: false,
        message: "Only Affiliate partner registration is available."
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password is required and must contain at least 8 characters."
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const otpRecord = await EmailOtp.findOne({ email: normalizedEmail, verified: true });

    if (
      !otpRecord ||
      !emailVerificationToken ||
      otpRecord.verificationToken !== emailVerificationToken ||
      Date.now() - otpRecord.verifiedAt.getTime() > OTP_VERIFIED_GRACE_MS
    ) {
      return res.status(400).json({ success: false, message: "Please verify your email with the OTP before registering." });
    }

    const existingUser = await PartnerUser.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const partnerCode = generatePartnerCode();

    let referralCode;

    // Only 4 characters wide (~1.1M combinations) — check for a
    // collision before committing to one instead of relying on the
    // unique index to reject it after the fact.
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateReferralCode();
      // eslint-disable-next-line no-await-in-loop
      const taken = await Partner.exists({ "referral.referralCode": candidate });
      if (!taken) {
        referralCode = candidate;
        break;
      }
    }

    if (!referralCode) {
      return res.status(500).json({
        success: false,
        message: "Could not generate a unique referral code right now. Please try again."
      });
    }

    const partner = await Partner.create({
      partnerCode,
      partnerType,
      primaryContact: { name: contactName, email: email.toLowerCase().trim(), phone },
      referral: referralCode
        ? {
            referralCode,
            referralLink: `${process.env.CLIENT_URL || "http://localhost:5173"}/partner/register?ref=${referralCode}`
          }
        : undefined,
      verification: { overallStatus: "not_submitted" },
      status: "draft"
    });

    const passwordHash = await bcrypt.hash(password, 12);

    const partnerUser = await PartnerUser.create({
      partnerId: partner._id,
      name: contactName,
      email: email.toLowerCase().trim(),
      phone: phone || "",
      role: "owner",
      permissions: ROLE_PERMISSIONS.owner,
      auth: { provider: "email", passwordHash },
      status: "active"
    });

    // Single-use — consumed now that registration succeeded.
    await EmailOtp.deleteOne({ email: normalizedEmail });

    await logActivity({
      partnerId: partner._id,
      performedByType: "partner_user",
      performedByUserId: partnerUser._id,
      activityType: "status_changed",
      entityType: "Partner",
      entityId: partner._id,
      description: "Partner account registered successfully.",
      req
    });

    await notifyAdmins({
      type: "affiliate_registered",
      title: "New affiliate registered",
      message: `${contactName} (${partner.partnerCode}) signed up. They'll submit KYC documents and bank details next.`,
      link: `/admin/partners/${partner._id}`,
      audienceRoles: ["kyc_reviewer"],
      partnerId: partner._id,
      entityType: "Partner",
      entityId: partner._id
    });

    const token = generateToken(partnerUser);

    return res.status(201).json({
      success: true,
      message: "Partner registration successful.",
      token,
      partner: {
        id: partner._id,
        partnerCode: partner.partnerCode,
        businessName: partner.legalEntity.businessName,
        partnerType: partner.partnerType,
        status: partner.status,
        verificationStatus: partner.verification.overallStatus
      },
      user: { id: partnerUser._id, name: partnerUser.name, email: partnerUser.email, role: partnerUser.role, permissions: partnerUser.permissions }
    });
  } catch (error) {
    console.error("Partner registration error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong during registration.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

// =====================================================
// LOGIN
// =====================================================

const loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await PartnerUser.findOne({ email: email.toLowerCase().trim() }).select("+auth.passwordHash");

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (user.status === "blocked") {
      return res.status(403).json({ success: false, message: "Your partner account access has been blocked." });
    }

    // Admin-invited accounts start with no password set — the partner sets
    // one via the emailed activation link (createPartner) before they can
    // log in at all.
    if (!user.auth.passwordHash) {
      return res.status(403).json({
        success: false,
        message: "Set your password first using the activation link sent to your email."
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.auth.passwordHash);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    user.auth.lastLoginAt = new Date();
    if (user.status === "invited") user.status = "active";
    await user.save();

    const partner = await Partner.findById(user.partnerId);

    if (!partner) {
      return res.status(404).json({ success: false, message: "Partner account not found." });
    }

    if (partner.partnerType !== "affiliate") {
      return res.status(403).json({
        success: false,
        message: "Only Affiliate partner accounts can access this panel."
      });
    }

    await logActivity({
      partnerId: partner._id,
      performedByType: "partner_user",
      performedByUserId: user._id,
      activityType: "login",
      entityType: "PartnerUser",
      entityId: user._id,
      description: "Partner logged into the portal.",
      req
    });

    const token = generateToken(user);

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      partner: {
        id: partner._id,
        partnerCode: partner.partnerCode,
        businessName: partner.legalEntity.businessName,
        partnerType: partner.partnerType,
        status: partner.status,
        verificationStatus: partner.verification.overallStatus
      },
      user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions }
    });
  } catch (error) {
    console.error("Partner login error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong during login." });
  }
};

// =====================================================
// FORGOT / RESET PASSWORD
// Emailed via Gmail SMTP when SMTP_USER/SMTP_PASS are set in .env;
// falls back to logging the link to the console otherwise.
// =====================================================

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const genericResponse = {
      success: true,
      message: "If an account exists for that email, a reset link has been sent."
    };

    const user = await PartnerUser.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.auth.resetTokenHash = tokenHash;
    user.auth.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const resetLink = `${process.env.CLIENT_URL || "http://localhost:5173"}/partner/reset-password/${rawToken}`;

    await sendMail({
      to: user.email,
      subject: "Reset your SPOTX Partner password",
      text: `Reset your password: ${resetLink}\n\nThis link expires in 30 minutes. If you didn't request this, ignore this email.`,
      html: `
        <p>We received a request to reset your SPOTX Partner account password.</p>
        <p><a href="${resetLink}">Reset your password</a></p>
        <p>This link expires in 30 minutes. If you didn't request this, ignore this email.</p>
      `
    });

    return res.json(genericResponse);
  } catch (error) {
    console.error("forgotPassword error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong processing the request." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await PartnerUser.findOne({
      "auth.resetTokenHash": tokenHash,
      "auth.resetTokenExpires": { $gt: new Date() }
    }).select("+auth.resetTokenHash +auth.resetTokenExpires");

    if (!user) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired." });
    }

    user.auth.passwordHash = await bcrypt.hash(password, 12);
    user.auth.resetTokenHash = undefined;
    user.auth.resetTokenExpires = undefined;
    await user.save();

    return res.json({ success: true, message: "Password reset successful. You can now log in." });
  } catch (error) {
    console.error("resetPassword error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong resetting the password." });
  }
};

module.exports = { registerPartner, loginPartner, forgotPassword, resetPassword, sendEmailOtp, verifyEmailOtp };
