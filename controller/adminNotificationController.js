const { AdminNotification } = require("../models/Index");

/* ============================================================
   ADMIN NOTIFICATIONS
============================================================ */

// super_admin sees every notification; other roles see the ones addressed
// to their role plus any addressed to everyone.
const visibleTo = (adminUser) =>
  adminUser.role === "super_admin"
    ? {}
    : { $or: [{ audienceRoles: adminUser.role }, { audienceRoles: { $size: 0 } }] };

const listNotifications = async (req, res) => {
  const adminId = req.adminUser._id;
  const filter = visibleTo(req.adminUser);

  const [notifications, unreadCount] = await Promise.all([
    AdminNotification.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
    AdminNotification.countDocuments({ ...filter, readBy: { $ne: adminId } })
  ]);

  const data = notifications.map(({ readBy, ...n }) => ({
    ...n,
    read: readBy.some((id) => id.equals(adminId))
  }));

  return res.json({ success: true, data, unreadCount });
};

const markAsRead = async (req, res) => {
  const notification = await AdminNotification.findOneAndUpdate(
    { _id: req.params.id, ...visibleTo(req.adminUser) },
    { $addToSet: { readBy: req.adminUser._id } }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found." });
  }

  return res.json({ success: true });
};

const markAllAsRead = async (req, res) => {
  await AdminNotification.updateMany(
    { ...visibleTo(req.adminUser), readBy: { $ne: req.adminUser._id } },
    { $addToSet: { readBy: req.adminUser._id } }
  );

  return res.json({ success: true, message: "All notifications marked as read." });
};

module.exports = { listNotifications, markAsRead, markAllAsRead };
