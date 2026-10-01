const express = require("express");
const router = express.Router();

const { listCommissions } = require("../controller/adminCommissionController");
const requireAdminRole = require("../middleware/requireAdminRole");

router.get("/", requireAdminRole("finance"), listCommissions);

module.exports = router;
