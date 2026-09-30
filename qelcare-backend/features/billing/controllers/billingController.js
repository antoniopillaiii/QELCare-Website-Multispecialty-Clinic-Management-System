const Billing = require("../models/Billing");
const logger = require("../../../shared/utils/activityLogger");
const { isValidDateString } = require("../../../shared/utils/manilaTime");
const { logSafeError } = require("../../../shared/utils/safeErrorLog");

// Same limit as the void dialog's text box.
const MAX_VOID_REASON = 500;

function sendError(res, err, context, fallbackMessage) {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logSafeError(context, err);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

// List filters are validated up front, so bad input is a 400 (not an empty
// result for a status that can't exist, and not a database error).
function parseListQuery(query) {
  const status = String(query.status || "").trim().toUpperCase();
  if (status && status !== "ALL" && !Billing.VALID_STATUSES.includes(status)) {
    return { error: `Invalid status filter. Use one of: ${Billing.VALID_STATUSES.join(", ").toLowerCase()}.` };
  }
  const methods = String(query.payment_method || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const badMethod = methods.find((value) => !Billing.VALID_PAYMENT_METHODS.includes(value));
  if (badMethod) return { error: `Invalid payment method filter "${badMethod}".` };
  for (const key of ["date_from", "date_to"]) {
    if (query[key] && !isValidDateString(query[key])) return { error: `Invalid ${key.replace("_", " ")}. Use YYYY-MM-DD.` };
  }
  if (query.date_from && query.date_to && query.date_from > query.date_to) {
    return { error: "The start date must be on or before the end date." };
  }
  return {
    filters: {
      search: query.search || "",
      status: status && status !== "ALL" ? status : null,
      payment_methods: methods,
      date_from: query.date_from || null,
      date_to: query.date_to || null,
    },
  };
}

const billingController = {
  async create(req, res) {
    const { appointment_id, patient_id, line_items, payment_method } = req.body || {};

    if (!appointment_id || !patient_id) {
      return res.status(400).json({ success: false, message: "appointment_id and patient_id are required." });
    }
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one billable line item is required." });
    }
    if (!payment_method) {
      return res.status(400).json({ success: false, message: "payment_method is required." });
    }

    try {
      // Validation (ids, amounts, method, discount, exists / patient match /
      // FOR_BILLING / not already billed) and the FOR_BILLING -> COMPLETED
      // flip all happen inside Billing.create; the flip runs in one transaction
      // under a row lock, so two cashiers can never double-bill.
      const billing = await Billing.create({
        ...req.body,
        cashier_id: req.user.user_id,
      });

      await logger.log({
        userId: req.user.user_id,
        action: "BILLING_PAID",
        entityType: "billing",
        entityId: billing.id,
        description: `Payment processed OR#${billing.or_number} - PHP ${billing.total_amount}`,
        ip: logger.getIP(req),
        metadata: {
          appointment_id: billing.appointment_id,
          patient_id: billing.patient_id,
          or_number: billing.or_number,
          subtotal: billing.subtotal,
          discount_amount: billing.discount_amount,
          total: billing.total_amount,
          method: billing.payment_method,
        },
      });

      res.status(201).json({
        success: true,
        message: "Payment processed.",
        data: { billing },
        billing,
      });
    } catch (err) {
      sendError(res, err, "Billing create error", "Failed to process payment.");
    }
  },

  async getAll(req, res) {
    try {
      const { error, filters } = parseListQuery(req.query);
      if (error) return res.status(400).json({ success: false, message: error });

      const result = await Billing.findAll({
        ...filters,
        page: parseInt(req.query.page, 10),
        limit: parseInt(req.query.limit, 10),
      });

      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "Billing getAll error", "Failed to fetch billing records.");
    }
  },

  async getById(req, res) {
    try {
      const bill = await Billing.findById(req.params.id);
      if (!bill) return res.status(404).json({ success: false, message: "Billing record not found." });
      res.json({ success: true, data: bill, billing: bill });
    } catch (err) {
      sendError(res, err, "Billing getById error", "Failed to fetch billing record.");
    }
  },

  async getByAppointment(req, res) {
    try {
      const bill = await Billing.findByAppointment(req.params.appointmentId);
      if (!bill) return res.status(404).json({ success: false, message: "No billing found for this appointment." });
      res.json({ success: true, data: bill, billing: bill });
    } catch (err) {
      sendError(res, err, "Billing getByAppointment error", "Failed to fetch billing.");
    }
  },

  async voidBill(req, res) {
    try {
      const body = req.body || {};
      const raw = body.reason !== undefined && body.reason !== null && body.reason !== "" ? body.reason : body.void_reason;
      if (raw !== undefined && raw !== null && typeof raw !== "string") {
        return res.status(400).json({ success: false, message: "The void reason must be text." });
      }
      const reason = String(raw || "").trim();
      if (!reason) return res.status(400).json({ success: false, message: "A void reason is required." });
      if (reason.length > MAX_VOID_REASON) {
        return res.status(400).json({ success: false, message: `Keep the void reason to ${MAX_VOID_REASON} characters or fewer.` });
      }

      const bill = await Billing.void(req.params.id, req.user.user_id, reason);
      if (!bill) return res.status(404).json({ success: false, message: "Billing not found or already voided." });

      await logger.log({
        userId: req.user.user_id,
        action: "BILLING_VOIDED",
        entityType: "billing",
        entityId: bill.id,
        description: `Billing OR#${bill.or_number} voided`,
        ip: logger.getIP(req),
        metadata: {
          appointment_id: bill.appointment_id,
          total: bill.total_amount,
          collected_by: bill.cashier_id,
          reason,
        },
      });

      res.json({ success: true, message: "Billing voided. The visit is back in For Billing and can be re-billed.", data: bill, billing: bill });
    } catch (err) {
      sendError(res, err, "Billing void error", "Failed to void billing.");
    }
  },

  async getDashboard(req, res) {
    try {
      const [stats, recent] = await Promise.all([
        Billing.getDashboardStats(),
        Billing.getRecentTransactions(10),
      ]);

      res.json({ success: true, data: { stats, recent } });
    } catch (err) {
      sendError(res, err, "Billing dashboard error", "Failed to fetch dashboard data.");
    }
  },
};

module.exports = billingController;
