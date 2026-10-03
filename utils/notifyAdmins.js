const { AdminNotification } = require("../models/Index");

/**
 * Posts a notification to the admin panel. `audienceRoles` limits who sees
 * it (super_admin always does); pass `actorAdminId` when an admin caused
 * the event so it starts out read for them. Never throws — like
 * logActivity, a failed notification must not fail the request.
 */
const notifyAdmins = async ({ type, title, message = "", link = "", audienceRoles = [], partnerId, entityType, entityId, actorAdminId }) => {
  try {
    await AdminNotification.create({
      type,
      title,
      message,
      link,
      audienceRoles,
      partnerId,
      entity: entityType ? { type: entityType, entityId } : undefined,
      readBy: actorAdminId ? [actorAdminId] : []
    });
  } catch (error) {
    console.error("Admin notification failed:", error.message);
  }
};

// "Example Studio (PTN-DEMO01)" — business name once the profile has one,
// otherwise the contact's name.
const partnerLabel = (partner) => {
  const name = partner.legalEntity?.businessName || partner.primaryContact?.name || "An affiliate";
  return partner.partnerCode ? `${name} (${partner.partnerCode})` : name;
};

module.exports = notifyAdmins;
module.exports.partnerLabel = partnerLabel;
