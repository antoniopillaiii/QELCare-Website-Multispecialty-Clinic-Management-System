const Queue = require("../models/Queue");
const Vital = require("../../vitals/models/Vital");
const logger = require("../../../shared/utils/activityLogger");
const { manilaToday, isValidDateString } = require("../../../shared/utils/manilaTime");

// ?date= is optional (defaults to today in Manila) but must be a real date.
function readDate(req) {
  const raw = req.query.date;
  if (raw === undefined || raw === "") return { date: manilaToday() };
  if (!isValidDateString(raw)) return { error: "Invalid date. Use YYYY-MM-DD." };
  return { date: raw };
}

async function writeLog(req, payload) {
  try {
    await logger.log({
      userId: req.user?.user_id,
      ip: logger.getIP(req),
      ...payload,
    });
  } catch (err) {
    console.error("Queue activity log error:", err);
  }
}

const STATUS_ROLE_RULES = {
  WAITING: ["Admin", "Nurse", "Frontdesk"],
  CALLED: ["Admin", "Nurse", "Doctor"],
  IN_PROGRESS: ["Admin", "Nurse", "Doctor"],
  SKIPPED: ["Admin", "Nurse", "Frontdesk"],
  DONE: ["Admin", "Doctor"],
  NO_SHOW: ["Admin", "Frontdesk"],
  CANCELLED: ["Admin", "Frontdesk"],
};

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function canRoleSetQueueStatus(role, status) {
  if (role === "Admin") return true;
  return (STATUS_ROLE_RULES[status] || []).includes(role);
}

async function assertQueueOwnership(req, queueId, nextStatus) {
  const entry = await Queue.findById(queueId);
  if (!entry) return null;

  if (req.user?.role === "Doctor" && Number(entry.doctor_id) !== Number(req.user.user_id)) {
    const err = new Error("Doctors can only update their own assigned queue patients.");
    err.statusCode = 403;
    throw err;
  }

  if (req.user?.role === "Doctor" && !["CALLED", "WAITING", "IN_PROGRESS", "DONE"].includes(nextStatus)) {
    const err = new Error("Doctors can only start or complete consultations.");
    err.statusCode = 403;
    throw err;
  }

  return entry;
}

const queueController = {
  async getDisplay(req, res) {
    try {
      const data = await Queue.getPublicDisplay();
      res.json({ success: true, data });
    } catch (err) {
      console.error("Queue display error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch queue display data." });
    }
  },

  // Read-only: viewing any date (today, past or future) never enqueues or
  // settles anything. Enqueueing and stale-queue settling run in the background
  // lifecycle job (server.js) or through the explicit POST /queue/auto-enqueue.
  async getSpecialties(req, res) {
    try {
      const { date, error } = readDate(req);
      if (error) return res.status(400).json({ success: false, message: error });
      const specialties = await Queue.getSpecialties(date);
      res.json({ success: true, data: specialties, specialties });
    } catch (err) {
      console.error("Queue getSpecialties error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch queue specialties." });
    }
  },

  async getQueueBySpecialty(req, res) {
    try {
      const { specialtyId } = req.params;
      const { date, error } = readDate(req);
      if (error) return res.status(400).json({ success: false, message: error });
      const queue = await Queue.findBySpecialtyAndDate(specialtyId, date);
      res.json({ success: true, data: queue, queue });
    } catch (err) {
      console.error("Queue getBySpecialty error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch queue." });
    }
  },

  async addToQueue(req, res) {
    try {
      const { appointment_id } = req.body || {};
      if (!appointment_id) {
        return res.status(400).json({ success: false, message: "appointment_id is required." });
      }

      const entry = await Queue.addToQueue(appointment_id);

      await writeLog(req, {
        action: "QUEUE_MANUAL_ADD",
        entityType: "queue",
        entityId: entry.queue_id,
        description: "Approved appointment was added to queue.",
        metadata: { appointment_id },
      });

      res.status(201).json({
        success: true,
        message: entry.alreadyQueued ? "Appointment is already in queue." : "Appointment added to queue.",
        data: entry,
        queue_entry: entry,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Queue addToQueue error:", err);
      res.status(500).json({ success: false, message: "Failed to add appointment to queue." });
    }
  },

  async updateStatus(req, res) {
    try {
      const { status, notes } = req.body;
      if (!status) {
        return res.status(400).json({ success: false, message: "Status is required." });
      }

      const nextStatus = normalizeStatus(status);
      if (!Queue.VALID_QUEUE_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ success: false, message: `Invalid queue status "${nextStatus}".` });
      }
      if (!canRoleSetQueueStatus(req.user?.role, nextStatus)) {
        return res.status(403).json({
          success: false,
          message: `${req.user?.role || "This role"} cannot set queue status to ${nextStatus}.`,
        });
      }

      const existingEntry = await assertQueueOwnership(req, req.params.queueId, nextStatus);
      if (!existingEntry) return res.status(404).json({ success: false, message: "Queue entry not found." });

      // Vitals are mandatory: a patient's visit cannot be completed (marked DONE)
      // until the nurse has recorded their vitals for this appointment. A repeat
      // Done on an already-finished entry skips this and is answered as a no-op.
      if (nextStatus === "DONE" && existingEntry.status !== "DONE" && existingEntry.appointment_id) {
        const vitals = await Vital.findByAppointment(existingEntry.appointment_id);
        if (!vitals || vitals.length === 0) {
          return res.status(400).json({
            success: false,
            code: "VITALS_REQUIRED",
            message: "Vitals must be recorded for this patient before the visit can be completed.",
          });
        }
      }

      const result = await Queue.updateStatus(req.params.queueId, nextStatus, notes);
      if (!result) return res.status(404).json({ success: false, message: "Queue entry not found." });
      const { entry, unchanged } = result;

      if (!unchanged) {
        await writeLog(req, {
          action: "QUEUE_STATUS_CHANGED",
          entityType: "queue",
          entityId: entry.queue_id,
          description: `Queue #${entry.queue_number} changed to ${entry.status}`,
          metadata: {
            queue_id: entry.queue_id,
            appointment_id: entry.appointment_id,
            status: entry.status,
          },
        });
      }

      res.json({
        success: true,
        unchanged,
        message: unchanged ? `Queue entry is already ${entry.status.replace("_", " ").toLowerCase()}.` : "Queue status updated.",
        data: entry,
        queue_entry: entry,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Queue updateStatus error:", err);
      res.status(500).json({ success: false, message: "Failed to update queue status." });
    }
  },

  // Explicit, authorized (Admin/Frontdesk) action: queue today's confirmed
  // appointments now instead of waiting for the background job. Today only.
  async autoEnqueue(req, res) {
    try {
      const date = req.body?.date || req.query.date || manilaToday();
      if (!isValidDateString(date)) {
        return res.status(400).json({ success: false, message: "Invalid date. Use YYYY-MM-DD." });
      }
      const result = await Queue.autoEnqueueConfirmed(date);

      await writeLog(req, {
        action: "QUEUE_AUTO_ENQUEUE",
        entityType: "queue",
        entityId: null,
        description: `Auto-enqueued confirmed appointments for ${date}.`,
        metadata: {
          date,
          added_count: result.added_count,
          failed_count: result.failed_count,
        },
      });

      res.json({
        success: true,
        message: `${result.added_count} confirmed appointment(s) added to queue.`,
        data: result,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Auto enqueue error:", err);
      res.status(500).json({ success: false, message: "Failed to auto-enqueue confirmed appointments." });
    }
  },
};

module.exports = queueController;
