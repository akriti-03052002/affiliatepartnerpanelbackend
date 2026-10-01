const express = require("express");
const router = express.Router();

const {
  createPartner, listPartners, getPartner, updatePartnerStatus, updatePartnerProfile, updateTeamMember
} = require("../controller/adminPartnerController");
const { uploadDocumentForPartner } = require("../controller/adminDocumentController");
const requireAdminRole = require("../middleware/requireAdminRole");
const { uploadDocumentAsAdmin } = require("../middleware/upload");

router.post("/", requireAdminRole("kyc_reviewer"), createPartner);
router.get("/", requireAdminRole("kyc_reviewer", "finance"), listPartners);
router.get("/:id", requireAdminRole("kyc_reviewer", "finance"), getPartner);
router.patch("/:id", requireAdminRole("kyc_reviewer"), updatePartnerProfile);
router.patch("/:id/status", requireAdminRole("kyc_reviewer"), updatePartnerStatus);
router.patch("/:id/team/:userId", requireAdminRole("kyc_reviewer"), updateTeamMember);
router.post("/:id/documents", requireAdminRole("kyc_reviewer"), uploadDocumentAsAdmin.single("file"), uploadDocumentForPartner);

module.exports = router;
