const crypto = require("crypto");

const randomSegment = (length) =>
  crypto.randomBytes(length).toString("hex").toUpperCase().slice(0, length);

const generatePartnerCode = () => "PTN-" + Date.now().toString().slice(-8);

// Excludes visually ambiguous characters (0/O, 1/I) since partners will
// be reading these out loud / typing them in manually.
const REFERRAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 4;

const generateReferralCode = () => {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_CHARS[crypto.randomInt(REFERRAL_CODE_CHARS.length)];
  }
  return code;
};

const generateSettlementNumber = () => "STL-" + Date.now().toString().slice(-8) + "-" + randomSegment(3);

module.exports = {
  generatePartnerCode,
  generateReferralCode,
  generateSettlementNumber
};
