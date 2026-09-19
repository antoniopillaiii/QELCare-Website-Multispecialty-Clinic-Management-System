const Notification = require("../models/Notification");
const DeviceToken = require("../models/DeviceToken");

const notificationController = {
  // Register (or refresh) an FCM device token for the authenticated user so the
  // backend can push OS notifications to this device.
  async registerDeviceToken(req, res) {
    try {
      const token = String(req.body.token || "").trim();
      const platform = String(req.body.platform || "android").trim().toLowerCase();
      if (!token) {
        return res.status(400).json({ success: false, message: "Device token is required." });
      }
      await DeviceToken.register({ user_id: req.user.user_id, token, platform });
      res.json({ success: true, message: "Device registered for notifications." });
    } catch (err) {
      console.error("Register device token error:", err.message);
      res.status(500).json({ success: false, message: "Failed to register device." });
    }
  },

  // Remove a device token (called on logout). Scoped to the caller's own tokens.
  async removeDeviceToken(req, res) {
    try {
      const token = String(req.body.token || req.query.token || "").trim();
      if (!token) {
        return res.status(400).json({ success: false, message: "Device token is required." });
      }
      await DeviceToken.removeForUser({ user_id: req.user.user_id, token });
      res.json({ success: true, message: "Device removed from notifications." });
    } catch (err) {
      console.error("Remove device token error:", err.message);
      res.status(500).json({ success: false, message: "Failed to remove device." });
    }
  },

  async getMine(req, res) {
    try {
      const rows = await Notification.findForUser(req.user.user_id, {
        unread_only: String(req.query.unread_only || "").toLowerCase() === "true",
        limit: req.query.limit,
      });
      const unread_count = await Notification.unreadCount(req.user.user_id);
      res.json({
        success: true,
        data: rows,
        notifications: rows,
        unread_count,
      });
    } catch (err) {
      console.error("Get notifications error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch notifications." });
    }
  },

  async markRead(req, res) {
    try {
      const notification = await Notification.markRead({
        id: req.params.id,
        user_id: req.user.user_id,
      });

      if (!notification) {
        return res.status(404).json({ success: false, message: "Notification not found." });
      }

      const unread_count = await Notification.unreadCount(req.user.user_id);
      res.json({
        success: true,
        message: "Notification marked as read.",
        data: notification,
        notification,
        unread_count,
      });
    } catch (err) {
      console.error("Mark notification read error:", err);
      res.status(500).json({ success: false, message: "Failed to update notification." });
    }
  },

  async markAllRead(req, res) {
    try {
      const updated = await Notification.markAllRead(req.user.user_id);
      res.json({
        success: true,
        message: "Notifications marked as read.",
        updated,
        unread_count: 0,
      });
    } catch (err) {
      console.error("Mark all notifications read error:", err);
      res.status(500).json({ success: false, message: "Failed to update notifications." });
    }
  },
};

module.exports = notificationController;
