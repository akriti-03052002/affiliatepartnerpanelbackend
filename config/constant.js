/**
 * Shared enum constants used across the Partner Panel schemas.
 * Moved out of models/index.js so they live in one place.
 */

const PARTNER_TYPES = [
  "affiliate"
];

const PARTNER_STATUS = [
  "draft",
  "pending_verification",
  "under_review",
  "active",
  "suspended",
  "rejected",
  "inactive"
];

const VERIFICATION_STATUS = [
  "not_submitted",
  "pending",
  "verified",
  "rejected",
  "expired"
];

// Lead lifecycle — see models/Partnerreferral.js.
const LEAD_STATUSES = ["new", "contacted", "won", "rejected"];

// "manual" is the only type created now (admin enters the commission per
// won deal). The rest remain so older ledger rows still validate.
const COMMISSION_TYPES = [
  "manual",
  "percentage",
  "fixed_per_deal",
  "fixed_per_screen",
  "recurring_percentage",
  "recurring_fixed",
  "hybrid"
];

const SETTLEMENT_TYPES = [
  "monthly",
  "quarterly",
  "threshold",
  "manual"
];

// Why a settlement is on_hold. Objective codes (bank_unverified,
// bank_change_pending, partner_suspended) can only be released once the
// underlying condition is actually resolved — see utils/settlementHold.js.
// compliance_review/incomplete_info/manual are judgment calls, released
// at an admin's discretion.
const SETTLEMENT_HOLD_CODES = [
  "bank_unverified",
  "bank_change_pending",
  "partner_suspended",
  "compliance_review",
  "incomplete_info",
  "manual"
];

module.exports = {
  PARTNER_TYPES,
  PARTNER_STATUS,
  VERIFICATION_STATUS,
  LEAD_STATUSES,
  COMMISSION_TYPES,
  SETTLEMENT_TYPES,
  SETTLEMENT_HOLD_CODES
};