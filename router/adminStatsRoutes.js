const express = require("express");
const router = express.Router();

const { getKpis } = require("../controller/adminStatsController");
const requireAdminRole = require("../middleware/requireAdminRole");

router.get("/kpis", requireAdminRole("finance", "kyc_reviewer"), getKpis);

module.exports = router;
