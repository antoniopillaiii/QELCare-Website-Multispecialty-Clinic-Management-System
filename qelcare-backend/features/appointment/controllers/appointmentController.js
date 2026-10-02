const Appointment = require("../models/Appointment");
const Patient = require("../../patient/models/Patient");
const Notification = require("../../notification/models/Notification");
const emailNotifier = require("../../../shared/utils/emailNotifier");
const patientNotifier = require("../../../shared/utils/patientNotifier");
const logger = require("../../../shared/utils/activityLogger");
const db = require("../../../config/database");
const { isValidDateString, manilaToday } = require("../../../shared/utils/manilaTime");

// Appointment notifications go to `booked_by`, which may be the patient OR the
// staff member (Admin/Frontdesk/etc.) who booked on their behalf. Point each
// notification at an appointments page the RECIPIENT can actually open, so
// clicking it never lands on the patient-only route and triggers "Access Denied".
const APPT_ROUTE_BY_ROLE = {
  Admin: "/admin/appointments",
  Frontdesk: "/frontdesk/appointments",
  Doctor: "/doctor/appointments",
  Nurse: "/nurse/appointments",
  Cashier: "/cashier/dashboard",
  Patient: "/patient/appointments",
};

async function appointmentLinkForUser(userId) {
  try {
    const result = await db.query(
      `SELECT r.role_name AS role
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.role_id
        WHERE u.user_id = $1`,
      [userId]
    );
    const role = result.rows[0]?.role;
    return APPT_ROUTE_BY_ROLE[role] || "/patient/appointments";
  } catch (err) {
    console.error("Notification link role lookup error:", err.message);
    return "/patient/appointments";
  }
}

// Staff moves for an appointment that is not yet past. NO_SHOW is reachable only
// once the scheduled time has passed (the "settle" path below); IN_QUEUE visits
// are no-showed through the queue, and FOR_BILLING / finished visits have no
// staff moves here at all.
const TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_QUEUE", "CANCELLED", "NO_SHOW"],
  IN_QUEUE: ["CANCELLED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "CANCELLED"],
  FOR_BILLING: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const APPOINTMENT_STATUS_ROLES = {
  CONFIRMED: ["Admin", "Frontdesk"],
  IN_QUEUE: ["Admin", "Frontdesk"],
  CANCELLED: ["Admin", "Frontdesk"],
  NO_SHOW: ["Admin", "Frontdesk"],
};

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function hasRole(req, allowedRoles) {
  return allowedRoles.includes(req.user?.role);
}

// Validates list filters up front so bad input is a 400, not a database error.
function listQueryError(query) {
  for (const key of ["date", "date_from", "date_to"]) {
    if (query[key] && !isValidDateString(query[key])) return `Invalid ${key.replace("_", " ")}. Use YYYY-MM-DD.`;
  }
  for (const key of ["doctor_id", "specialty_id", "patient_id"]) {
    if (query[key] && !Appointment.isPositiveInt(query[key])) return `Invalid ${key.replace("_id", "")} filter.`;
  }
  if (query.status) {
    const statuses = String(query.status).split(",").map(normalizeStatus).filter(Boolean);
    const bad = statuses.find((s) => !Appointment.VALID_STATUSES.includes(s));
    if (bad) return `Invalid status filter "${bad}".`;
  }
  if (query.scope && !["active", "history"].includes(String(query.scope))) return "Invalid scope filter.";
  return "";
}

function cleanText(value, max = 120) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : "";
}

// Capitalize each word so a relative's "kelly celocia" is stored as "Kelly Celocia".
function toTitleCase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

function buildRelative(input = {}) {
  const relative = input || {};
  return {
    first_name: toTitleCase(cleanText(relative.first_name, 80)),
    last_name: toTitleCase(cleanText(relative.last_name, 80)),
    relationship: cleanText(relative.relationship, 80),
    date_of_birth: relative.date_of_birth || null,
    age: relative.age === "" || relative.age === undefined ? null : Number(relative.age),
    gender: cleanText(relative.gender, 20) || null,
    phone: cleanText(relative.phone, 30) || null,
    email: cleanText(relative.email, 150) || null,
  };
}

async function makePatientForBooking({ req, ownerPatient, bookedFor, relative }) {
  if (bookedFor !== "other") return ownerPatient;

  const r = buildRelative(relative);
  if (!r.first_name || !r.last_name || !r.relationship) {
    throw {
      statusCode: 400,
      message: "Relative first name, last name, and relationship are required.",
    };
  }
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    throw { statusCode: 400, message: "Relative email is invalid." };
  }

  return Patient.create({
    first_name: r.first_name,
    last_name: r.last_name,
    date_of_birth: r.date_of_birth,
    age: Number.isFinite(r.age) ? r.age : null,
    gender: r.gender,
    phone: r.phone,
    contact: r.phone,
    email: r.email,
    address: ownerPatient.address || null,
    created_by: req.user.user_id,
    notes: `One-time relative booking by patient account #${ownerPatient.id}. Relationship: ${r.relationship}.`,
  });
}

async function notifyPatient({ userId, appointment, title, message, type = "appointment" }) {
  try {
    const link = await appointmentLinkForUser(userId);
    await Notification.create({
      user_id: userId,
      type,
      title,
      message,
      link,
      appointment_id: appointment.id,
      metadata: {
        status: appointment.status,
        date: appointment.date,
        time: appointment.time,
        booked_for: appointment.booked_for,
      },
    });

    // Also push to the recipient's registered devices (patient mobile APK).
    // Best-effort: staff bookers simply have no tokens, and any failure here is
    // swallowed inside patientNotifier so it never affects the request.
    await patientNotifier.pushToUser(userId, {
      title,
      body: message,
      data: { link: link || "/patient/appointments", appointment_id: String(appointment.id || "") },
    });
  } catch (err) {
    console.error("Notification create error:", err.message);
  }
}

// Patient-facing email goes to the patient's own address. The booker's address is
// a fallback only when the booker is a patient account (e.g. a patient who booked
// for a relative with no email) — never a staff member who booked a walk-in.
function patientEmailRecipient(appointment) {
  if (appointment.patient_email) return appointment.patient_email;
  if (appointment.booked_by_role === "Patient") return appointment.booked_by_email || null;
  return null;
}

async function emailPatient({ appointment, status }) {
  try {
    const to = patientEmailRecipient(appointment);
    if (to) await emailNotifier.sendAppointmentNotification({
      to,
      patientName: appointment.patient_name,
      doctorName: appointment.doctor_name,
      specialtyName: appointment.specialty_name,
      date: appointment.date,
      time: appointment.time,
      status,
    });
  } catch (err) {
    console.error("Appointment email notification error:", err.message);
  }
  // No appointment SMS: SMS is reserved for the Forgot Password and Register
  // Account verification codes. Patients get in-app, email and push here.
}

const appointmentController = {
  async create(req, res) {
    try {
      const { patient_id, doctor_id, date, time } = req.body;
      if (!patient_id || !doctor_id || !date || !time) {
        return res.status(400).json({
          success: false,
          message: "patient_id, doctor_id, date, and time are required.",
        });
      }

      const appointment = await Appointment.create({
        ...req.body,
        booked_by: req.user.user_id,
        booked_for: req.body.booked_for || "self",
      });

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_CREATED",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Appointment created for patient #${patient_id} on ${date} ${time}`,
        ip: logger.getIP(req),
      });

      res.status(201).json({
        success: true,
        message: "Appointment created.",
        data: appointment,
        appointment,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Create appointment error:", err);
      res.status(500).json({ success: false, message: "Failed to create appointment." });
    }
  },

  async getAll(req, res) {
    try {
      const { role, user_id } = req.user;
      const {
        status,
        date,
        date_from,
        date_to,
        specialty_id,
        doctor_id,
        patient_id,
        search,
        scope,
        page = 1,
        limit = 20,
      } = req.query;

      const queryError = listQueryError(req.query);
      if (queryError) return res.status(400).json({ success: false, message: queryError });

      // Read-only: stale past appointments and queue entries are settled by the
      // background lifecycle job (server.js), not as a side effect of viewing.
      const result = await Appointment.findAll({
        role,
        userId: user_id,
        status,
        date,
        date_from,
        date_to,
        specialty_id,
        doctor_id,
        patient_id,
        search,
        scope,
        page,
        limit,
      });

      // Data minimization: billing/front-desk staff get billable services
      // (requested_services) but not the clinical diagnosis.
      if (role === "Cashier" || role === "Frontdesk") {
        for (const row of result.data || []) row.latest_diagnosis = null;
      }

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Get appointments error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch appointments." });
    }
  },

  // Whole-dataset counts for the Appointment Management cards. The per-doctor
  // breakdown (it names accounts with their status and role) is for the Admin
  // screen's doctor filter only.
  async getStats(req, res) {
    try {
      const stats = await Appointment.stats({ withDoctors: req.user?.role === "Admin" });
      res.json({ success: true, data: stats });
    } catch (err) {
      console.error("Appointment stats error:", err);
      res.status(500).json({ success: false, message: "Failed to load appointment statistics." });
    }
  },

  async getById(req, res) {
    try {
      const appointment = await Appointment.findById(req.params.id);
      if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found." });
      // Doctors work only with their own patients' appointments (the list is
      // already scoped this way); never expose another doctor's visit/diagnosis.
      if (req.user?.role === "Doctor" && Number(appointment.doctor_id) !== Number(req.user.user_id)) {
        return res.status(403).json({ success: false, message: "Doctors can only view their own appointments." });
      }
      if (["Cashier", "Frontdesk"].includes(req.user?.role)) {
        appointment.latest_diagnosis = null;
      }
      res.json({ success: true, data: appointment, appointment });
    } catch (err) {
      console.error("Get appointment error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch appointment." });
    }
  },

  async updateStatus(req, res) {
    try {
      const nextStatus = normalizeStatus(req.body.status);
      const { cancel_reason } = req.body;
      if (!nextStatus) return res.status(400).json({ success: false, message: "Status is required." });
      if (!Appointment.VALID_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ success: false, message: `Invalid status "${nextStatus}".` });
      }

      const allowedRoles = APPOINTMENT_STATUS_ROLES[nextStatus] || [];
      if (allowedRoles.length && !hasRole(req, allowedRoles)) {
        return res.status(403).json({
          success: false,
          message: `${req.user?.role || "This role"} cannot change appointments to ${nextStatus}.`,
        });
      }

      if (nextStatus === "COMPLETED") {
        return res.status(400).json({
          success: false,
          message: "Doctors complete visits through the queue/consultation workflow, not direct appointment status editing.",
        });
      }
      if (nextStatus === "FOR_BILLING") {
        return res.status(400).json({
          success: false,
          message: "A visit moves to For Billing only when the doctor completes it in the queue.",
        });
      }

      const current = await Appointment.getRawById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: "Appointment not found." });

      const isPast = Appointment.isPastManila(current.date, current.time);

      // --- PAST appointments ---------------------------------------------
      // A past appointment that was never completed/cancelled must not be left
      // hanging as PENDING/CONFIRMED forever. Admin/Frontdesk may SETTLE it as
      // NO_SHOW or CANCELLED. Forward transitions (CONFIRMED/IN_QUEUE) make no
      // sense for a past date and stay blocked; IN_QUEUE and FOR_BILLING visits
      // belong to the queue and billing workflows.
      if (isPast) {
        if (!["NO_SHOW", "CANCELLED"].includes(nextStatus)) {
          return res.status(400).json({
            success: false,
            message: "This appointment is in the past. It can only be settled as No Show or Cancelled.",
          });
        }

        const settled = await Appointment.settlePastById(req.params.id, nextStatus, {
          cancelled_by: req.user.user_id,
          cancel_reason,
        });

        if (settled?.booked_by) {
          await notifyPatient({
            userId: settled.booked_by,
            appointment: settled,
            title: `Appointment ${nextStatus.replace("_", " ").toLowerCase()}`,
            message: `Appointment #${settled.id} for ${settled.patient_name} was marked ${nextStatus.replace("_", " ").toLowerCase()}.`,
            type: "appointment_status",
          });
          await emailPatient({ appointment: settled, status: nextStatus });
        }

        await logger.log({
          userId: req.user.user_id,
          action: "APPT_SETTLED",
          entityType: "appointment",
          entityId: settled.id,
          description: `Past appointment #${settled.id} settled from ${current.status} to ${nextStatus}`,
          ip: logger.getIP(req),
          metadata: { from: current.status, to: nextStatus, cancel_reason: cancel_reason || null, past: true },
        });

        return res.json({
          success: true,
          message: `Past appointment settled as ${nextStatus.replace("_", " ").toLowerCase()}.`,
          data: settled,
          appointment: settled,
        });
      }

      // --- FUTURE / TODAY appointments (normal workflow) -----------------
      if (!canTransition(current.status, nextStatus)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change appointment from ${current.status} to ${nextStatus}.`,
        });
      }

      // A patient can only fail to show once their scheduled time has come.
      if (nextStatus === "NO_SHOW") {
        return res.status(400).json({
          success: false,
          message: `This appointment is scheduled for ${current.date} at ${String(current.time).slice(0, 5)}. It can only be marked No Show after that time.`,
        });
      }

      let appointment;
      let declinedConflicts = [];
      let queueEntry = null;
      let message = "Status updated.";

      if (nextStatus === "CANCELLED") {
        if (!String(cancel_reason || "").trim()) {
          return res.status(400).json({ success: false, message: "Cancellation reason is required." });
        }
        // Cancels the appointment and, in the same transaction, closes its queue
        // entry so the patient leaves the live queue and the waiting-room display.
        ({ appointment } = await Appointment.closeAppointment(req.params.id, "CANCELLED", {
          actorId: req.user.user_id,
          reason: cancel_reason,
          allowedFrom: ["PENDING", "CONFIRMED", "IN_QUEUE", "RESCHEDULED"],
        }));
        message = current.status === "IN_QUEUE"
          ? "Appointment cancelled and removed from today's queue."
          : "Appointment cancelled.";
      } else if (nextStatus === "CONFIRMED") {
        // Confirming claims the slot: atomically set CONFIRMED (a lost race with
        // another confirm for the same slot returns 409), queue a same-day visit
        // in the same transaction, and auto-decline other pending requests.
        const confirmResult = await Appointment.confirmAndDeclineConflicts(req.params.id, req.user.user_id);
        appointment = confirmResult.appointment;
        declinedConflicts = confirmResult.declined;
        queueEntry = confirmResult.queueEntry;
        message = queueEntry
          ? "Appointment approved and added to today's queue."
          : "Appointment approved. It will stay confirmed until the appointment date.";
      } else if (nextStatus === "IN_QUEUE") {
        if (current.date !== manilaToday()) {
          return res.status(400).json({
            success: false,
            message: "Only today's confirmed appointments can enter the live queue.",
          });
        }
        ({ appointment, queueEntry } = await Appointment.checkIn(req.params.id));
        message = "Appointment added to today's queue.";
      }

      const finalStatus = appointment.status;

      if (appointment.booked_by) {
        await notifyPatient({
          userId: appointment.booked_by,
          appointment,
          title: `Appointment ${finalStatus.replace("_", " ").toLowerCase()}`,
          message: `Appointment #${appointment.id} for ${appointment.patient_name} is ${finalStatus.replace("_", " ").toLowerCase()}.`,
          type: "appointment_status",
        });
        await emailPatient({ appointment, status: finalStatus });
      }

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_STATUS_CHANGED",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Appointment #${appointment.id} status changed from ${current.status} to ${finalStatus}`,
        ip: logger.getIP(req),
        metadata: {
          from: current.status,
          requested_status: nextStatus,
          final_status: finalStatus,
          cancel_reason,
          queue_id: queueEntry?.queue_id || null,
          queue_number: queueEntry?.queue_number || null,
        },
      });

      // Notify the patients whose competing pending requests were auto-declined
      // because this slot was confirmed for someone else.
      for (const conflict of declinedConflicts) {
        if (!conflict.booked_by) continue;
        await notifyPatient({
          userId: conflict.booked_by,
          appointment: { id: conflict.id, status: "CANCELLED", date: appointment.date, time: appointment.time, booked_for: "self" },
          title: "Appointment request declined",
          message: `The ${appointment.date} ${appointment.time} slot was confirmed for another patient, so your request #${conflict.id} was declined. Please book a different time.`,
          type: "appointment_status",
        });
      }

      res.json({
        success: true,
        message: declinedConflicts.length
          ? `${message} ${declinedConflicts.length} other pending request(s) for this slot were declined.`
          : message,
        data: appointment,
        appointment,
        queue_entry: queueEntry,
        declined_conflicts: declinedConflicts.map((c) => c.id),
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Update status error:", err);
      res.status(500).json({ success: false, message: "Failed to update status." });
    }
  },

  async reschedule(req, res) {
    try {
      if (!hasRole(req, ["Admin", "Frontdesk"])) {
        return res.status(403).json({
          success: false,
          message: `${req.user?.role || "This role"} cannot reschedule appointments.`,
        });
      }

      const { date, time } = req.body;
      const appointment = await Appointment.reschedule(req.params.id, { date, time });

      if (appointment.booked_by) {
        await notifyPatient({
          userId: appointment.booked_by,
          appointment,
          title: "Appointment rescheduled",
          message: `Appointment #${appointment.id} for ${appointment.patient_name} was rescheduled to ${appointment.date} ${appointment.time}.`,
          type: "appointment_rescheduled",
        });
        await emailPatient({ appointment, status: "RESCHEDULED" });
      }

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_RESCHEDULED",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Appointment #${appointment.id} rescheduled to ${date} ${time}`,
        ip: logger.getIP(req),
      });

      res.json({
        success: true,
        message: "Appointment rescheduled and returned to pending confirmation.",
        data: appointment,
        appointment,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Reschedule error:", err);
      res.status(500).json({ success: false, message: "Failed to reschedule." });
    }
  },

  async getTodayByDoctor(req, res) {
    try {
      const doctorId = req.params.doctorId || req.user.user_id;
      if (!Appointment.isPositiveInt(doctorId)) {
        return res.status(400).json({ success: false, message: "Invalid doctor id." });
      }
      if (req.user?.role === "Doctor" && Number(doctorId) !== Number(req.user.user_id)) {
        return res.status(403).json({ success: false, message: "Doctors can only view their own schedule." });
      }
      const appointments = await Appointment.getTodayByDoctor(doctorId);
      if (req.user?.role === "Frontdesk") {
        for (const row of appointments) row.latest_diagnosis = null;
      }
      res.json({ success: true, data: appointments, appointments });
    } catch (err) {
      console.error("Get today appointments error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch today's appointments." });
    }
  },

  async bookMyAppointment(req, res) {
    try {
      const ownerPatient = await Patient.findByUserId(req.user.user_id);
      if (!ownerPatient) {
        return res.status(404).json({ success: false, message: "Patient profile not found. Contact the clinic." });
      }

      const { doctor_id, date, time } = req.body;
      if (!doctor_id || !date || !time) {
        return res.status(400).json({ success: false, message: "doctor_id, date, and time are required." });
      }

      // Anti-spam: a patient who just cancelled must wait before booking again
      // (blocks rapid book<->cancel churn). Checked before any patient record is
      // created for a relative booking.
      await Appointment.assertAppointmentCooldown(req.user.user_id);

      Appointment.assertNotPastManila(date, time);
      Appointment.assertWithinClinicHours(time);

      const bookedFor = String(req.body.booked_for || "self").toLowerCase() === "other" ? "other" : "self";
      const targetPatient = await makePatientForBooking({
        req,
        ownerPatient,
        bookedFor,
        relative: req.body.relative,
      });

      const relative = bookedFor === "other" ? buildRelative(req.body.relative) : null;
      const appointment = await Appointment.create({
        ...req.body,
        patient_id: targetPatient.id,
        booked_by: req.user.user_id,
        booked_for: bookedFor,
        booked_for_relationship: bookedFor === "other" ? relative.relationship : null,
        type: req.body.type || "consultation",
      });

      await notifyPatient({
        userId: req.user.user_id,
        appointment,
        title: "Appointment request submitted",
        message: `Appointment #${appointment.id} for ${appointment.patient_name} is pending clinic confirmation.`,
        type: "appointment_booked",
      });
      await emailPatient({ appointment, status: "PENDING" });

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_CREATED",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Patient booked appointment for ${bookedFor === "other" ? "relative" : "self"} on ${date} ${time}`,
        ip: logger.getIP(req),
        metadata: {
          booked_for: bookedFor,
          target_patient_id: targetPatient.id,
          owner_patient_id: ownerPatient.id,
        },
      });

      res.status(201).json({
        success: true,
        message: "Appointment booked. Please wait for Frontdesk/Admin approval. Once approved, it will enter the clinic queue.",
        data: appointment,
        appointment,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Book appointment error:", err);
      res.status(500).json({ success: false, message: "Failed to book appointment." });
    }
  },

  async getMyAppointments(req, res) {
    try {
      const patient = await Patient.findByUserId(req.user.user_id);
      if (!patient) return res.status(404).json({ success: false, message: "Patient profile not found." });

      const result = await Appointment.findAll({
        role: "Patient",
        userId: req.user.user_id,
        scope: req.query.scope,
        page: req.query.page || 1,
        limit: req.query.limit || 100,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      console.error("Get my appointments error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch appointments." });
    }
  },

  // Patient cancels their OWN appointment (PENDING/CONFIRMED/RESCHEDULED, not past,
  // not already in the live queue). Ownership is enforced via booked_by.
  async cancelMine(req, res) {
    try {
      // Anti-spam: block rapid book<->cancel churn (throws 429 if too soon).
      await Appointment.assertAppointmentCooldown(req.user.user_id);

      const reason = String(req.body.cancel_reason || "").trim() || "Cancelled by patient.";
      // Atomic, row-locked cancel: ownership + allowed-state rules are re-checked
      // on the locked row, so two simultaneous cancels can't both go through.
      const { appointment, fromStatus } = await Appointment.cancelByPatient(
        req.params.id,
        req.user.user_id,
        reason
      );

      await notifyPatient({
        userId: req.user.user_id,
        appointment,
        title: "Appointment cancelled",
        message: `You cancelled appointment #${appointment.id} for ${appointment.patient_name}.`,
        type: "appointment_status",
      });

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_CANCELLED_BY_PATIENT",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Patient cancelled appointment #${appointment.id}`,
        ip: logger.getIP(req),
        metadata: { reason, from: fromStatus },
      });

      res.json({ success: true, message: "Appointment cancelled.", data: appointment, appointment });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Patient cancel error:", err);
      res.status(500).json({ success: false, message: "Failed to cancel appointment." });
    }
  },

  // Patient edits (reschedules) their OWN appointment. Only allowed before the
  // clinic confirms it (PENDING/RESCHEDULED). Re-validates future + clinic hours,
  // and the reschedule() model call keeps it PENDING for re-confirmation.
  async editMine(req, res) {
    try {
      const current = await Appointment.getRawById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: "Appointment not found." });
      if (Number(current.booked_by) !== Number(req.user.user_id)) {
        return res.status(403).json({ success: false, message: "You can only edit your own appointments." });
      }
      if (!["PENDING", "RESCHEDULED"].includes(current.status)) {
        return res.status(400).json({
          success: false,
          message: "Only pending appointments can be edited. Please contact the clinic to change a confirmed appointment.",
        });
      }

      const { date, time } = req.body;
      if (!date || !time) {
        return res.status(400).json({ success: false, message: "New date and time are required." });
      }
      Appointment.assertNotPastManila(date, time, "New appointment schedule");
      Appointment.assertWithinClinicHours(time);

      const appointment = await Appointment.reschedule(req.params.id, { date, time });

      await notifyPatient({
        userId: req.user.user_id,
        appointment,
        title: "Appointment updated",
        message: `You updated appointment #${appointment.id} to ${appointment.date} ${appointment.time}. It is pending clinic confirmation.`,
        type: "appointment_rescheduled",
      });

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_EDITED_BY_PATIENT",
        entityType: "appointment",
        entityId: appointment.id,
        description: `Patient edited appointment #${appointment.id} to ${date} ${time}`,
        ip: logger.getIP(req),
      });

      res.json({
        success: true,
        message: "Appointment updated. It will stay pending until the clinic confirms it.",
        data: appointment,
        appointment,
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Patient edit error:", err);
      res.status(500).json({ success: false, message: "Failed to update appointment." });
    }
  },

  // Explicit settle endpoint (POST /appointments/:id/settle). Equivalent to
  // updateStatus on a past appointment but with a purpose-built route so the
  // frontend can call it unambiguously.
  async settlePast(req, res) {
    try {
      if (!hasRole(req, ["Admin", "Frontdesk"])) {
        return res.status(403).json({ success: false, message: `${req.user?.role || "This role"} cannot settle appointments.` });
      }
      const nextStatus = normalizeStatus(req.body.status);
      const { cancel_reason } = req.body;

      const settled = await Appointment.settlePastById(req.params.id, nextStatus, {
        cancelled_by: req.user.user_id,
        cancel_reason,
      });
      if (!settled) return res.status(404).json({ success: false, message: "Appointment not found." });

      if (settled.booked_by) {
        await notifyPatient({
          userId: settled.booked_by,
          appointment: settled,
          title: `Appointment ${nextStatus.replace("_", " ").toLowerCase()}`,
          message: `Appointment #${settled.id} for ${settled.patient_name} was marked ${nextStatus.replace("_", " ").toLowerCase()}.`,
          type: "appointment_status",
        });
        await emailPatient({ appointment: settled, status: nextStatus });
      }

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_SETTLED",
        entityType: "appointment",
        entityId: settled.id,
        description: `Past appointment #${settled.id} settled to ${nextStatus}`,
        ip: logger.getIP(req),
        metadata: { to: nextStatus, cancel_reason: cancel_reason || null, past: true },
      });

      res.json({ success: true, message: `Appointment settled as ${nextStatus.replace("_", " ").toLowerCase()}.`, data: settled, appointment: settled });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      console.error("Settle appointment error:", err);
      res.status(500).json({ success: false, message: "Failed to settle appointment." });
    }
  },

  // Manual bulk sweep (POST /appointments/sweep-past). Admin only.
  async sweepPast(req, res) {
    try {
      if (!hasRole(req, ["Admin"])) {
        return res.status(403).json({ success: false, message: "Only Admin can run the sweep." });
      }
      const graceMinutes = Number(req.body.grace_minutes);
      const result = await Appointment.autoSettlePastAppointments({
        graceMinutes: Number.isFinite(graceMinutes) ? graceMinutes : 120,
      });

      await logger.log({
        userId: req.user.user_id,
        action: "APPT_SWEEP",
        entityType: "appointment",
        entityId: null,
        description: `Manual sweep settled ${result.settled} past appointment(s) to NO_SHOW.`,
        ip: logger.getIP(req),
        metadata: result,
      });

      res.json({ success: true, message: `${result.settled} past appointment(s) settled.`, ...result });
    } catch (err) {
      console.error("Sweep past error:", err);
      res.status(500).json({ success: false, message: "Failed to sweep past appointments." });
    }
  },
};

module.exports = appointmentController;
