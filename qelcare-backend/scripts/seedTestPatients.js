// ============================================================================
// Seed: 100 fictional Filipino patient accounts (development / demo data)
// ----------------------------------------------------------------------------
// Creates each account exactly the way patient self-registration does
// (features/auth/routes/patientRegistrationRoutes.js): Patient role, bcrypt
// (cost 12) password hash, privacy consent stamp, status = 'unverified'.
//
// Creating the accounts does NOT bypass verification. Nothing in the default
// mode marks an account verified, so:
//   - the accounts can't sign in until the normal OTP verification is passed
//     (POST /auth/patient/register/resend + /verify), and
//   - no `patients` row is created; the existing trg_auto_create_patient
//     trigger creates it when an account becomes verified.
//
// The default mode writes ONLY to `users`. No OTP rows, appointments, queue
// entries, records, bills, medications, notifications, device tokens, inquiries
// or activity logs. No email or SMS is sent. Phone numbers are left empty on
// purpose: the app sends real SMS, and any valid-looking mobile number could
// belong to someone. Emails use the reserved ".test" domain, which can never
// receive mail.
//
// --mark-verified (separate, explicit step for demo data): these accounts can
// never receive a code, so this marks the still-unverified SEED accounts as
// verified without the OTP step and makes the same database changes the app's
// own verify step makes (status, then the patient record with the date of
// birth; the existing trigger fills the rest). It only ever touches the 100
// seed accounts, skips locked / deactivated ones, and changes nothing in the
// app's verification code. The accounts then appear as patients everywhere.
//
// Safe to run again: accounts it already created or verified are left
// untouched, and it stops without writing if a seed username or email belongs
// to another account.
//
// Usage (from anywhere; every mode is a dry run unless --confirm is given):
//   node qelcare-backend/scripts/seedTestPatients.js                           what would be created
//   node qelcare-backend/scripts/seedTestPatients.js --confirm                 create missing accounts
//   node qelcare-backend/scripts/seedTestPatients.js --mark-verified           what would be verified
//   node qelcare-backend/scripts/seedTestPatients.js --mark-verified --confirm verify the seed accounts
//   node qelcare-backend/scripts/seedTestPatients.js --verify                  report on the seeded accounts
//
// Password: by default every account gets its own random password that is
// never stored or shown (the accounts exist to be listed, not signed in to).
// For local testing, set SEED_PATIENT_PASSWORD to a password that meets the
// app's password rules and all seeded accounts will share it.
// ============================================================================

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("../config/database");
const profileRules = require("../shared/utils/profileRules");
const {
  validateEmail,
  validatePasswordStrength,
  validatePersonName,
  validateUsername,
} = require("../features/auth/validators/authValidator");

const TOTAL = 100;
const EMAIL_DOMAIN = "qelcare.test"; // reserved TLD (RFC 2606): never deliverable
const PRIVACY_VERSION = "1.0"; // same default as the registration route
const BCRYPT_ROUNDS = 12; // same cost as the registration route

const MALE_NAMES = [
  "Jose", "Juan", "Antonio", "Ramon", "Ricardo", "Eduardo", "Roberto", "Fernando", "Miguel", "Rafael",
  "Carlos", "Manuel", "Francisco", "Andres", "Emilio", "Benjamin", "Daniel", "Gabriel", "Joshua", "Christian",
  "Mark Anthony", "John Paul", "Jerome", "Rodel", "Rommel", "Reynaldo", "Rogelio", "Danilo", "Ernesto", "Alfredo",
  "Arnel", "Jayson", "Marvin", "Dennis", "Ronald", "Noel", "Vicente", "Crisanto", "Leonardo", "Nestor",
  "Gilbert", "Ariel", "Edgardo", "Renato", "Wilfredo", "Angelo", "Paolo", "Kenneth", "Jericho", "Lorenzo",
];

const FEMALE_NAMES = [
  "Maria", "Ana", "Rosa", "Carmen", "Teresa", "Lourdes", "Corazon", "Imelda", "Gloria", "Josefina",
  "Cristina", "Angelica", "Jennifer", "Michelle", "Mary Grace", "Maricel", "Marilou", "Rowena", "Analyn", "Jocelyn",
  "Liza", "Leticia", "Remedios", "Erlinda", "Rosario", "Luzviminda", "Divina", "Estrella", "Felicidad", "Milagros",
  "Katherine", "Kimberly", "Princess", "Angeline", "Rhea", "Sheila", "Glenda", "Arlene", "Nenita", "Perla",
  "Aurora", "Consuelo", "Editha", "Florencia", "Herminia", "Janet", "Lorna", "Myrna", "Norma", "Violeta",
];

// Each surname is used twice: once with a male and once with a female name.
const SURNAMES = [
  "Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Tomas", "Andrada",
  "Castillo", "Flores", "Villanueva", "Ramos", "Castro", "Rivera", "Aquino", "Navarro", "Salazar", "Mercado",
  "Dela Cruz", "De Guzman", "Delos Santos", "Del Rosario", "Pascual", "Santiago", "Soriano", "Valdez", "Aguilar", "Domingo",
  "Dizon", "Manalo", "Panganiban", "Macaraeg", "Dimaculangan", "Pangilinan", "Magbanua", "Tolentino", "Lacson", "Gatchalian",
  "Evangelista", "Marasigan", "Villareal", "Zamora", "Belmonte", "Cabrera", "Fajardo", "Hernandez", "Ilagan", "Javier",
];

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z]/g, "");
}

// Deterministic, so every run describes the same 100 accounts.
function buildAccounts() {
  return Array.from({ length: TOTAL }, (_, index) => {
    const pair = Math.floor(index / 2);
    const female = index % 2 === 1;
    const firstName = (female ? FEMALE_NAMES : MALE_NAMES)[pair];
    const lastName = SURNAMES[(pair + (female ? 17 : 0)) % SURNAMES.length];
    const number = String(index + 1).padStart(3, "0");
    const handle = `${slug(firstName)}.${slug(lastName)}.test${number}`;
    const year = 1950 + ((index * 37) % 56); // 1950-2005
    const month = String(((index * 7) % 12) + 1).padStart(2, "0");
    const day = String(((index * 11) % 28) + 1).padStart(2, "0");
    return {
      username: handle,
      email: `${handle}@${EMAIL_DOMAIN}`,
      firstName,
      lastName,
      gender: female ? "Female" : "Male",
      dateOfBirth: `${year}-${month}-${day}`,
    };
  });
}

// The registration rules, applied to the generated data before anything is written.
function validationErrors(accounts) {
  const errors = [];
  for (const account of accounts) {
    const problems = [
      ...validateUsername(account.username),
      ...validateEmail(account.email),
      ...validatePersonName(account.firstName, "First name"),
      ...validatePersonName(account.lastName, "Last name"),
      profileRules.birthDateError(account.dateOfBirth),
    ].filter(Boolean);
    if (problems.length) errors.push(`${account.username}: ${problems.join("; ")}`);
  }
  const unique = (key) => new Set(accounts.map((account) => account[key])).size === accounts.length;
  if (!unique("username")) errors.push("Generated usernames are not unique.");
  if (!unique("email")) errors.push("Generated emails are not unique.");
  if (new Set(accounts.map((a) => `${a.firstName} ${a.lastName}`)).size !== accounts.length) {
    errors.push("Generated full names are not unique.");
  }
  return errors;
}

function randomPassword() {
  // Meets the app's password rule; never stored or printed.
  return `Qc#${crypto.randomBytes(24).toString("base64url")}9a`;
}

// Which seed accounts already exist, and whether any seed username / email is
// held by an account this script did not create.
async function inspect(db, accounts) {
  const usernames = accounts.map((account) => account.username);
  const emails = accounts.map((account) => account.email);
  const found = await db.query(
    `SELECT u.user_id, LOWER(u.username) AS username, LOWER(u.email) AS email, u.status, r.role_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE LOWER(u.username) = ANY($1::text[]) OR LOWER(u.email) = ANY($2::text[])`,
    [usernames, emails]
  );

  const byUsername = new Map(accounts.map((account) => [account.username, account]));
  const existing = [];
  const conflicts = [];
  for (const row of found.rows) {
    const account = byUsername.get(row.username);
    if (account && account.email === row.email && row.role_name === "Patient") existing.push(row);
    else conflicts.push(`user #${row.user_id} (${row.role_name}) already uses ${account ? "username" : "email"} ${account ? row.username : row.email}`);
  }
  return { existing, conflicts };
}

// Read-only report on the seed accounts and everything linked to them.
async function report(db, accounts) {
  const { existing, conflicts } = await inspect(db, accounts);
  const ids = existing.map((row) => row.user_id);
  const emails = accounts.map((account) => account.email);
  const count = async (sql) => (await db.query(sql, [ids])).rows[0].n;

  const hashes = await db.query(
    "SELECT COUNT(*) FILTER (WHERE password ~ '^\\$2[aby]\\$12\\$.{53}$')::int AS n FROM users WHERE user_id = ANY($1::int[])",
    [ids]
  );
  const statuses = await db.query(
    "SELECT status, COUNT(*)::int AS n FROM users WHERE user_id = ANY($1::int[]) GROUP BY status ORDER BY status",
    [ids]
  );
  const linked = "(SELECT id FROM patients WHERE user_id = ANY($1::int[]))";

  return {
    conflicts,
    accounts: ids.length,
    bcrypt_cost_12_hashes: hashes.rows[0].n,
    statuses: Object.fromEntries(statuses.rows.map((row) => [row.status, row.n])),
    patient_records: await count("SELECT COUNT(*)::int AS n FROM patients WHERE user_id = ANY($1::int[])"),
    patient_records_matching_account: await count(
      `SELECT COUNT(*)::int AS n FROM patients p JOIN users u ON u.user_id = p.user_id
        WHERE u.user_id = ANY($1::int[]) AND p.date_of_birth = u.date_of_birth AND p.gender = u.gender AND p.is_active`
    ),
    appointments: await count(`SELECT COUNT(*)::int AS n FROM appointments WHERE booked_by = ANY($1::int[]) OR patient_id IN ${linked}`),
    queue_entries: await count(`SELECT COUNT(*)::int AS n FROM queue_entries q JOIN appointments a ON a.id = q.appointment_id WHERE a.booked_by = ANY($1::int[]) OR a.patient_id IN ${linked}`),
    medical_records: await count(`SELECT COUNT(*)::int AS n FROM medical_records WHERE patient_id IN ${linked}`),
    billing: await count(`SELECT COUNT(*)::int AS n FROM billing WHERE patient_id IN ${linked}`),
    vitals: await count(`SELECT COUNT(*)::int AS n FROM vitals WHERE patient_id IN ${linked}`),
    medications: await count(`SELECT COUNT(*)::int AS n FROM patient_medications WHERE created_by = ANY($1::int[]) OR patient_id IN ${linked}`),
    medication_logs: await count(`SELECT COUNT(*)::int AS n FROM medication_logs WHERE patient_id IN ${linked}`),
    medical_results: await count(`SELECT COUNT(*)::int AS n FROM patient_medical_results WHERE uploaded_by = ANY($1::int[]) OR patient_id IN ${linked}`),
    relatives: await count("SELECT COUNT(*)::int AS n FROM patient_relatives WHERE owner_user_id = ANY($1::int[])"),
    notifications: await count("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ANY($1::int[])"),
    device_tokens: await count("SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = ANY($1::int[])"),
    inquiries: (await db.query("SELECT COUNT(*)::int AS n FROM inquiries WHERE LOWER(email) = ANY($1::text[])", [emails])).rows[0].n,
    otp_requests: (await db.query("SELECT COUNT(*)::int AS n FROM otp_requests WHERE LOWER(email) = ANY($1::text[])", [emails])).rows[0].n,
    activity_logs: await count("SELECT COUNT(*)::int AS n FROM activity_logs WHERE user_id = ANY($1::int[])"),
    active_sessions: await count("SELECT COUNT(*)::int AS n FROM active_tokens WHERE user_id = ANY($1::int[])"),
  };
}

// --mark-verified: the database changes of POST /auth/patient/register/verify,
// minus the code check, for the seed accounts that are still unverified.
async function markVerified(accounts, confirm) {
  const { existing, conflicts } = await inspect(pool, accounts);
  if (conflicts.length) {
    throw new Error(`Stopped without changes. A seed username or email belongs to another account:\n  ${conflicts.join("\n  ")}`);
  }
  const pending = existing.filter((row) => row.status === "unverified");
  const verified = existing.filter((row) => row.status === "verified").length;
  const skipped = existing.length - pending.length - verified;
  console.log(
    `Seed accounts found: ${existing.length}. Already verified: ${verified}. To verify: ${pending.length}.` +
      (skipped ? ` Left alone (locked or deactivated): ${skipped}.` : "")
  );

  if (!confirm) {
    console.log("Dry run: nothing was written. Add --confirm to verify them.");
    return;
  }
  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const ids = pending.map((row) => row.user_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Fires trg_auto_create_patient, which creates each patient record.
    const updated = await client.query(
      `UPDATE users
          SET status = 'verified',
              failed_login_attempts = 0,
              lockout_until = NULL,
              updated_at = NOW()
        WHERE user_id = ANY($1::int[]) AND status = 'unverified'`,
      [ids]
    );
    // Same patient-record write as the verify route (this is what carries the
    // date of birth); the date is copied inside the database.
    await client.query(
      `INSERT INTO patients
         (user_id, first_name, last_name, name, email, phone, contact, date_of_birth, is_active, created_by, created_at, updated_at)
       SELECT u.user_id, u.first_name, u.last_name, TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), u.email, u.phone, u.phone,
              u.date_of_birth, TRUE, u.user_id, NOW(), NOW()
         FROM users u
        WHERE u.user_id = ANY($1::int[])
       ON CONFLICT (user_id) DO UPDATE SET
         first_name    = EXCLUDED.first_name,
         last_name     = EXCLUDED.last_name,
         name          = EXCLUDED.name,
         email         = EXCLUDED.email,
         phone         = EXCLUDED.phone,
         contact       = EXCLUDED.contact,
         date_of_birth = EXCLUDED.date_of_birth,
         is_active     = TRUE,
         updated_at    = NOW()`,
      [ids]
    );
    const records = await client.query("SELECT COUNT(*)::int AS n FROM patients WHERE user_id = ANY($1::int[])", [ids]);
    if (updated.rowCount !== ids.length || records.rows[0].n !== ids.length) {
      throw new Error(`Expected ${ids.length} verified accounts with one patient record each; got ${updated.rowCount} / ${records.rows[0].n}.`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`Verified ${ids.length} seed account(s) without the OTP step. Each now has one patient record with its date of birth.`);
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const verifyOnly = args.includes("--verify");
  const markVerifiedMode = args.includes("--mark-verified");
  const accounts = buildAccounts();

  const errors = validationErrors(accounts);
  if (errors.length) throw new Error(`Seed data failed the registration rules:\n  ${errors.join("\n  ")}`);

  const sharedPassword = process.env.SEED_PATIENT_PASSWORD || "";
  if (sharedPassword) {
    const passwordErrors = validatePasswordStrength(sharedPassword);
    if (passwordErrors.length) throw new Error(`SEED_PATIENT_PASSWORD: ${passwordErrors.join("; ")}`);
  }

  console.log(`Target database: ${process.env.DB_NAME} on ${process.env.DB_HOST}`);

  if (verifyOnly) {
    console.log(JSON.stringify(await report(pool, accounts), null, 2));
    return;
  }

  if (markVerifiedMode) {
    await markVerified(accounts, confirm);
    return;
  }

  const role = await pool.query("SELECT role_id FROM roles WHERE role_name = 'Patient'");
  const patientRoleId = role.rows[0]?.role_id;
  if (!patientRoleId) throw new Error("The Patient role does not exist in this database.");

  const before = await inspect(pool, accounts);
  if (before.conflicts.length) {
    throw new Error(`Stopped without changes. A seed username or email belongs to another account:\n  ${before.conflicts.join("\n  ")}`);
  }
  const present = new Set(before.existing.map((row) => row.username));
  const missing = accounts.filter((account) => !present.has(account.username));
  console.log(`Seed accounts already present: ${present.size}. To create: ${missing.length}.`);

  if (!confirm) {
    console.log("Dry run: nothing was written. Add --confirm to create the missing accounts.");
    return;
  }
  if (missing.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Hash first (slow), then write everything in one short transaction.
  const rows = [];
  for (const account of missing) {
    rows.push({ ...account, hash: await bcrypt.hash(sharedPassword || randomPassword(), BCRYPT_ROUNDS) });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      // Same columns and initial state as POST /auth/patient/register, plus gender.
      await client.query(
        `INSERT INTO users
           (role_id, username, email, password, first_name, last_name, gender, date_of_birth, status, privacy_agreed_at, privacy_version, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, 'unverified', NOW(), $9, NOW(), NOW())`,
        [patientRoleId, row.username, row.email, row.hash, row.firstName, row.lastName, row.gender, row.dateOfBirth, PRIVACY_VERSION]
      );
    }
    const after = await inspect(client, accounts);
    if (after.conflicts.length || after.existing.length !== TOTAL) {
      throw new Error(`Expected ${TOTAL} seed accounts after the insert, found ${after.existing.length}.`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`Created ${rows.length} account(s). Seed accounts now present: ${TOTAL}.`);
  console.log(
    sharedPassword
      ? "Password: the value of SEED_PATIENT_PASSWORD (shared by the accounts created in this run)."
      : "Password: a random value per account, not stored or shown."
  );
  console.log("Status: unverified. Each account must pass the normal OTP verification before it can sign in.");
}

main()
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
