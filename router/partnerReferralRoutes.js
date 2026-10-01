const express = require("express");
const router = express.Router();

const { listReferrals, createReferral } = require("../controller/partnerReferralController");
const requirePermission = require("../middleware/requirePermission");

router.get("/", requirePermission("referrals:view"), listReferrals);
router.post("/", requirePermission("referrals:create"), createReferral);

module.exports = router;
