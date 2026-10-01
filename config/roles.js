/**
 * Permission catalogue for PartnerUser roles.
 * "owner" always bypasses permission checks (see requirePermission middleware).
 */

const ALL_PARTNER_PERMISSIONS = [
  "dashboard:view",

  "team:view",
  "team:manage",

  "profile:view",
  "profile:update",

  "documents:view",
  "documents:upload",

  "bank:view",
  "bank:manage",

  "referrals:view",
  "referrals:create",

  "commissions:view",

  "settlements:view",

  "notifications:view"
];

/*
  documents:* and bank:* are deliberately owner-only (KYC + payout
  account are the most sensitive data on a partner account). No other
  role gets them, no matter what's passed in from the invite form.
*/
const OWNER_ONLY_PERMISSIONS = ["documents:view", "documents:upload", "bank:view", "bank:manage"];

const ROLE_PERMISSIONS = {
  owner: [...ALL_PARTNER_PERMISSIONS],

  admin: [
    "dashboard:view",
    "team:view",
    "team:manage",
    "profile:view",
    "profile:update",
    "referrals:view",
    "referrals:create",
    "commissions:view",
    "settlements:view",
    "notifications:view"
  ],

  sales: [
    "dashboard:view",
    "profile:view",
    "referrals:view",
    "referrals:create",
    "notifications:view"
  ],

  finance: [
    "dashboard:view",
    "profile:view",
    "commissions:view",
    "settlements:view",
    "notifications:view"
  ],

  viewer: [
    "dashboard:view",
    "profile:view",
    "referrals:view",
    "commissions:view",
    "settlements:view",
    "notifications:view"
  ]
};

const ADMIN_ROLES = ["super_admin", "kyc_reviewer", "finance"];

module.exports = {
  ALL_PARTNER_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  ADMIN_ROLES
};
