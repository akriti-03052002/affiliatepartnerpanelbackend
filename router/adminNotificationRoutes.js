const express = require("express");
const router = express.Router();

const { listNotifications, markAsRead, markAllAsRead } = require("../controller/adminNotificationController");

// Every admin role has a notification feed; the controller filters it to
// what that role should see.
router.get("/", listNotifications);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);

module.exports = router;
