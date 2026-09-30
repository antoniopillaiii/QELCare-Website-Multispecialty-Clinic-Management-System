const db = require("../../../config/database");
const { isPositiveInt, escapeLike } = require("../../../shared/utils/requestValidation");

const VALID_PAYMENT_METHODS = ["cash", "gcash", "maya", "card", "bank_transfer", "philhealth", "hmo", "other"];
const VALID_DISCOUNT_TYPES = ["none", "manual", "senior", "pwd", "philhealth", "hmo", "other"];
const VALID_STATUSES = ["PAID", "VOIDED"];
// numeric(10,2) columns: anything larger can't be stored.
const MAX_MONEY = 99999999.99;

function appError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// A JSON number, or text written as a plain decimal ("800", "800.50", "-5").
// Anything else — hex ("0x320"), exponent ("8e2"), "Infinity", arrays — is NaN,
// so it's rejected instead of being read as some other amount.
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
function toStrictNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && DECIMAL_TEXT.test(value.trim())) return Number(value.trim());
  return NaN;
}

// Strict money parsing: a malformed, negative or oversized amount is a 400,
// never silently turned into 0 or clamped.
function parseMoney(value, label) {
  if (typeof value === "string" && value.trim() === "") throw appError(400, `${label} is required.`);
  const number = toStrictNumber(value);
  if (!Number.isFinite(number)) {
    throw appError(400, `${label} must be a number.`);
  }
  if (number < 0) throw appError(400, `${label} can't be negative.`);
  if (number > MAX_MONEY) throw appError(400, `${label} is too large.`);
  return round2(number);
}

// The server is authoritative for every line: amount = quantity x unit price.
// A line may send the amount, the unit price, or both (they must agree).
// Zero-amount lines (e.g. an unused optional fee) are left out; the bill still
// needs at least one line above zero. Credits/adjustments aren't a line item
// (discounts are), so negative lines are rejected rather than dropped.
function normalizeLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw appError(400, "At least one billable line item is required.");
  }
  const items = lineItems.map((item, index) => {
    const label = `Line ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw appError(400, `${label} is invalid.`);

    let quantity = 1;
    if (item.quantity !== undefined && item.quantity !== null && item.quantity !== "") {
      quantity = toStrictNumber(item.quantity);
      if (!Number.isFinite(quantity)) throw appError(400, `${label}: quantity must be a number.`);
      if (quantity <= 0) throw appError(400, `${label}: quantity must be greater than zero.`);
    }

    const hasUnit = item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== "";
    const hasAmount = item.amount !== undefined && item.amount !== null && item.amount !== "";
    if (!hasUnit && !hasAmount) throw appError(400, `${label}: enter an amount.`);

    const unitPrice = hasUnit ? parseMoney(item.unit_price, `${label} unit price`) : null;
    const givenAmount = hasAmount ? parseMoney(item.amount, `${label} amount`) : null;
    const computed = unitPrice !== null ? round2(quantity * unitPrice) : givenAmount;
    if (givenAmount !== null && Math.abs(givenAmount - computed) > 0.004) {
      throw appError(400, `${label}: amount doesn't match quantity x unit price.`);
    }
    if (computed > MAX_MONEY) throw appError(400, `${label} amount is too large.`);
    const resolvedUnit = unitPrice !== null ? unitPrice : round2(computed / quantity);
    if (Math.abs(round2(resolvedUnit * quantity) - computed) > 0.004) {
      throw appError(400, `${label}: enter a unit price that works out to the amount.`);
    }

    const description = item.description === undefined || item.description === null ? "" : String(item.description).trim();
    return {
      description: description || "Clinic service",
      quantity,
      unit_price: resolvedUnit,
      amount: computed,
    };
  });

  const billable = items.filter((item) => item.amount > 0);
  if (!billable.length) throw appError(400, "At least one billable item with amount greater than zero is required.");
  return billable;
}

// Unknown methods are rejected (never recorded as cash).
function parsePaymentMethod(method) {
  const value = String(method ?? "").trim().toLowerCase();
  if (!value) throw appError(400, "payment_method is required.");
  if (!VALID_PAYMENT_METHODS.includes(value)) {
    throw appError(400, `Unsupported payment method. Use one of: ${VALID_PAYMENT_METHODS.join(", ")}.`);
  }
  return value;
}

// A discount needs a known type and a 0-100% value, and the two must agree:
// no percentage without a type, no type without a percentage.
function parseDiscount(type, pct) {
  const discountType = type === undefined || type === null || String(type).trim() === ""
    ? "none"
    : String(type).trim().toLowerCase();
  if (!VALID_DISCOUNT_TYPES.includes(discountType)) {
    throw appError(400, `Unsupported discount type. Use one of: ${VALID_DISCOUNT_TYPES.join(", ")}.`);
  }
  let discountPct = 0;
  if (pct !== undefined && pct !== null && pct !== "") {
    discountPct = toStrictNumber(pct);
    if (!Number.isFinite(discountPct)) {
      throw appError(400, "Discount percentage must be a number.");
    }
    if (discountPct < 0 || discountPct > 100) throw appError(400, "Discount percentage must be between 0 and 100.");
    discountPct = round2(discountPct);
  }
  if (discountType === "none" && discountPct > 0) {
    throw appError(400, "Choose a discount type for a discount percentage.");
  }
  if (discountType !== "none" && discountPct === 0) {
    throw appError(400, "Enter the discount percentage for the selected discount type.");
  }
  return { discountType, discountPct };
}

const Billing = {
  // Atomic payment. In ONE transaction:
  //   1. lock the appointment row (FOR UPDATE) so concurrent cashiers serialize,
  //   2. validate it is FOR_BILLING for this patient and not already billed,
  //   3. generate the OR number (inside the txn -> rolls back with it, so
  //      official receipt numbers stay gapless on failure),
  //   4. insert the PAID bill,
  //   5. flip the appointment FOR_BILLING -> COMPLETED.
  // The partial unique index uq_billing_appt_paid backstops double-billing at
  // the DB level even if this code path is bypassed.
  async create({
    appointment_id,
    patient_id,
    cashier_id,
    line_items,
    discount_type,
    discount_pct,
    payment_method,
    amount_tendered,
    notes,
  }) {
    if (!isPositiveInt(appointment_id)) throw appError(400, "Invalid appointment id.");
    if (!isPositiveInt(patient_id)) throw appError(400, "Invalid patient id.");
    const paymentMethod = parsePaymentMethod(payment_method);
    const { discountType, discountPct: discPct } = parseDiscount(discount_type, discount_pct);
    const items = normalizeLineItems(line_items);

    const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
    if (subtotal > MAX_MONEY) throw appError(400, "The bill total is too large.");
    const discAmount = round2(subtotal * (discPct / 100));
    const total = round2(subtotal - discAmount);
    const tendered = amount_tendered === undefined || amount_tendered === null || amount_tendered === ""
      ? total
      : parseMoney(amount_tendered, "Amount tendered");

    if (tendered < total) {
      throw appError(400, "Amount tendered must be equal to or greater than the total.");
    }

    const change = round2(tendered - total);
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const apptResult = await client.query(
        `SELECT id, patient_id, status
         FROM appointments
         WHERE id = $1::integer
         FOR UPDATE`,
        [appointment_id]
      );

      const appointment = apptResult.rows[0];
      if (!appointment) throw appError(404, "Appointment not found.");
      if (Number(appointment.patient_id) !== Number(patient_id)) {
        throw appError(400, "Patient does not match this appointment.");
      }
      if (appointment.status === "COMPLETED") {
        throw appError(409, "This appointment has already been billed.");
      }
      if (appointment.status !== "FOR_BILLING") {
        throw appError(400, "This visit is not ready for billing. The doctor must finish the consultation first (it should be marked For Billing).");
      }

      const orResult = await client.query("SELECT generate_or_number() AS or_num");
      const orNumber = orResult.rows[0].or_num;

      const insertResult = await client.query(
        `INSERT INTO billing
         (appointment_id, patient_id, cashier_id, line_items,
          discount_type, discount_pct, discount_amount,
          subtotal, total_amount, payment_method, amount_tendered, change_amount,
          or_number, status, paid_at, notes)
         VALUES ($1::integer,$2::integer,$3::integer,$4::jsonb,
          $5::varchar,$6::numeric,$7::numeric,
          $8::numeric,$9::numeric,$10::varchar,$11::numeric,$12::numeric,
          $13::varchar,'PAID',NOW(),$14::text)
         RETURNING *`,
        [
          appointment_id,
          patient_id,
          cashier_id || null,
          JSON.stringify(items),
          discountType,
          discPct,
          discAmount,
          subtotal,
          total,
          paymentMethod,
          tendered,
          change,
          orNumber,
          notes || null,
        ]
      );

      await client.query(
        `UPDATE appointments
         SET status = 'COMPLETED', updated_at = NOW()
         WHERE id = $1::integer AND status = 'FOR_BILLING'`,
        [appointment_id]
      );

      await client.query("COMMIT");
      return insertResult.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505" && err.constraint === "uq_billing_appt_paid") {
        throw appError(409, "This appointment has already been billed.");
      }
      throw err;
    } finally {
      client.release();
    }
  },

  // Server-side list: every filter runs in SQL so pages, counts and exports
  // cover the whole billing table. Dates are the clinic's (Asia/Manila) paid
  // day, inclusive of the entire day, whatever the viewer's device zone is.
  async findAll({ search = "", status, payment_methods = [], date_from = null, date_to = null, page = 1, limit = 20 } = {}) {
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    const params = [];
    const conditions = [];

    const searchText = String(search || "").trim();
    if (searchText) {
      params.push(`%${escapeLike(searchText)}%`);
      const like = `$${params.length}`;
      let idMatch = "";
      if (isPositiveInt(searchText.replace(/^#/, ""))) {
        params.push(Number(searchText.replace(/^#/, "")));
        idMatch = `b.id = $${params.length} OR`;
      }
      conditions.push(`(
        ${idMatch}
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) ILIKE ${like}
        OR b.or_number ILIKE ${like}
      )`);
    }

    if (status) {
      params.push(String(status).toUpperCase());
      conditions.push(`b.status = $${params.length}`);
    }

    if (payment_methods.length) {
      params.push(payment_methods);
      conditions.push(`b.payment_method = ANY($${params.length}::varchar[])`);
    }

    const paidDay = "(COALESCE(b.paid_at, b.created_at) AT TIME ZONE 'Asia/Manila')::date";
    if (date_from) {
      params.push(date_from);
      conditions.push(`${paidDay} >= $${params.length}::date`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`${paidDay} <= $${params.length}::date`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const dataParams = [...params, safeLimit, offset];

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT
           b.*,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
           p.philhealth_no,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) AS cashier_name,
           TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
           a.time::text AS appointment_time,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''), d.username) AS doctor_name,
           s.specialty_name
         FROM billing b
         JOIN patients p ON b.patient_id = p.id
         LEFT JOIN users u ON b.cashier_id = u.user_id
         LEFT JOIN appointments a ON b.appointment_id = a.id
         LEFT JOIN users d ON a.doctor_id = d.user_id
         LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
         ${where}
         ORDER BY COALESCE(b.paid_at, b.created_at) DESC, b.id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM billing b
         JOIN patients p ON b.patient_id = p.id
         ${where}`,
        params
      ),
    ]);

    const total = countResult.rows[0]?.count || 0;
    return {
      data: dataResult.rows,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  },

  async findById(id) {
    const result = await db.query(
      `SELECT
         b.*,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name,
         p.philhealth_no,
         p.senior_pwd_id,
         p.date_of_birth,
         p.gender AS patient_gender,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username) AS cashier_name,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', vb.first_name, vb.last_name)), ''), vb.username) AS voided_by_name,
         TO_CHAR(a.date, 'YYYY-MM-DD') AS appointment_date,
         a.time::text AS appointment_time,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''), d.username) AS doctor_name,
         s.specialty_name
       FROM billing b
       JOIN patients p ON b.patient_id = p.id
       LEFT JOIN users u ON b.cashier_id = u.user_id
       LEFT JOIN users vb ON b.voided_by = vb.user_id
       LEFT JOIN appointments a ON b.appointment_id = a.id
       LEFT JOIN users d ON a.doctor_id = d.user_id
       LEFT JOIN specialties s ON a.specialty_id = s.specialty_id
       WHERE b.id = $1::integer`,
      [id]
    );

    return result.rows[0] || null;
  },

  async findByAppointment(appointmentId) {
    const result = await db.query(
      `SELECT *
       FROM billing
       WHERE appointment_id = $1::integer
       ORDER BY created_at DESC
       LIMIT 1`,
      [appointmentId]
    );

    return result.rows[0] || null;
  },

  // Void a PAID bill. `cashier_id` stays the person who collected the payment;
  // who voided it, when and why go in voided_by / voided_at / notes. The
  // trg_billing_voided trigger returns the appointment to FOR_BILLING so the
  // cashier can re-bill the visit correctly.
  async void(id, voided_by, reason) {
    const cleanReason = String(reason || "").trim();
    if (!cleanReason) throw appError(400, "A void reason is required.");
    const result = await db.query(
      `UPDATE billing
       SET status = 'VOIDED',
           voided_by = $1::integer,
           voided_at = NOW(),
           notes = COALESCE(notes || E'\n', '') || 'VOID reason: ' || $3::text,
           updated_at = NOW()
       WHERE id = $2::integer
         AND status = 'PAID'
       RETURNING *`,
      [voided_by, id, cleanReason]
    );

    return result.rows[0] || null;
  },

  async getDashboardStats() {
    const [result, byMethod] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*)::int AS total_transactions,
           COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid_count,
           COUNT(*) FILTER (WHERE status = 'VOIDED')::int AS voided_count,
           COALESCE(SUM(total_amount) FILTER (WHERE status = 'PAID'), 0) AS total_revenue,
           COALESCE(SUM(total_amount) FILTER (
             WHERE status = 'PAID'
               AND (paid_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
           ), 0) AS today_revenue,
           COALESCE(SUM(total_amount) FILTER (
             WHERE status = 'PAID'
               AND DATE_TRUNC('month', paid_at AT TIME ZONE 'Asia/Manila') = DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Manila')
           ), 0) AS month_revenue
         FROM billing`
      ),
      // Paid totals per payment method over ALL bills, so screens can group
      // them (e.g. "HMO Paid") without loading every transaction.
      db.query(
        `SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS total
         FROM billing
         WHERE status = 'PAID'
         GROUP BY payment_method
         ORDER BY payment_method`
      ),
    ]);

    return { ...result.rows[0], by_method: byMethod.rows };
  },

  async getRecentTransactions(limit = 10) {
    const result = await db.query(
      `SELECT
         b.id,
         b.or_number,
         b.subtotal,
         b.discount_amount,
         b.total_amount,
         b.payment_method,
         b.status,
         b.paid_at,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.name) AS patient_name
       FROM billing b
       JOIN patients p ON b.patient_id = p.id
       WHERE b.status = 'PAID'
       ORDER BY b.paid_at DESC
       LIMIT $1::integer`,
      [limit]
    );

    return result.rows;
  },
};

Billing.VALID_PAYMENT_METHODS = VALID_PAYMENT_METHODS;
Billing.VALID_STATUSES = VALID_STATUSES;

module.exports = Billing;
