const Inquiry = require("../models/Inquiry");
const logger = require("../../../shared/utils/activityLogger");
const { isValidDateString } = require("../../../shared/utils/manilaTime");

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

module.exports = {
  // PUBLIC — no auth. A visitor without an account submits an inquiry.
  async create(req, res) {
    try {
      const full_name = clean(req.body.full_name, 120);
      const email = clean(req.body.email, 150);
      const phone = clean(req.body.phone, 30);
      const subject = clean(req.body.subject, 150);
      const message = clean(req.body.message, 2000);
      const preferred_date = req.body.preferred_date || null;

      if (preferred_date && !isValidDateString(preferred_date)) {
        return res.status(400).json({ success: false, message: "Please enter a valid preferred date." });
      }
      if (!full_name || !message) {
        return res.status(400).json({ success: false, message: "Your name and a message are required." });
      }
      if (!email && !phone) {
        return res.status(400).json({ success: false, message: "Please provide an email or phone number so the clinic can reach you." });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address." });
      }

      const inquiry = await Inquiry.create({ full_name, email, phone, subject, message, preferred_date });
      return res.status(201).json({
        success: true,
        message: "Your inquiry has been sent. The clinic front desk will contact you soon.",
        data: inquiry,
        inquiry,
      });
    } catch (err) {
      console.error("Create inquiry error:", err);
      res.status(500).json({ success: false, message: "Failed to submit inquiry. Please try again." });
    }
  },

  // STAFF — Admin / Front desk inbox.
  async list(req, res) {
    try {
      const result = await Inquiry.list({
        status: req.query.status,
        search: req.query.search,
        page: req.query.page,
        limit: req.query.limit,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("List inquiries error:", err);
      res.status(500).json({ success: false, message: "Failed to load inquiries." });
    }
  },

  async update(req, res) {
    try {
      const { status } = req.body || {};
      if (status && !Inquiry.VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `Invalid status. Use: ${Inquiry.VALID_STATUSES.join(", ")}` });
      }
      const touchedByStaff = status !== undefined || req.body.admin_notes !== undefined;
      const inquiry = await Inquiry.update(req.params.id, {
        status,
        admin_notes: req.body.admin_notes,
        handled_by: touchedByStaff ? req.user.user_id : null,
      });
      if (!inquiry) return res.status(404).json({ success: false, message: "Inquiry not found." });

      await logger.log({
        userId: req.user.user_id,
        action: "INQUIRY_UPDATED",
        entityType: "inquiry",
        entityId: inquiry.inquiry_id,
        description: `Inquiry #${inquiry.inquiry_id} updated to ${inquiry.status}`,
        ip: logger.getIP(req),
        metadata: { status: inquiry.status },
      });

      res.json({ success: true, message: "Inquiry updated.", data: inquiry, inquiry });
    } catch (err) {
      console.error("Update inquiry error:", err);
      res.status(500).json({ success: false, message: "Failed to update inquiry." });
    }
  },
};
