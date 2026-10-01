const express = require("express");
const router = express.Router();

const {
  listLeads, markContacted, markWon, rejectLead
} = require("../controller/adminLeadController");
const requireAdminRole = require("../middleware/requireAdminRole");

router.get("/", requireAdminRole("kyc_reviewer", "finance"), listLeads);
router.patch("/:id/contacted", requireAdminRole("kyc_reviewer"), markContacted);
router.patch("/:id/win", requireAdminRole("kyc_reviewer"), markWon);
router.patch("/:id/reject", requireAdminRole("kyc_reviewer"), rejectLead);

module.exports = router;
