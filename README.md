<div align="center">

# QELCare — Multispecialty Clinic Management System

**A full-stack clinic platform that runs the whole patient journey — from booking and check-in to per-specialty queues, consultations, and cashier billing — with AI-assisted document processing and role-based access for six clinic roles.**

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-Express_4-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-no_ORM-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![JWT](https://img.shields.io/badge/Auth-JWT_+_bcrypt-000000?logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
[![Google Gemini](https://img.shields.io/badge/AI-Google_Gemini_OCR-8E75B2?logo=google&logoColor=white)](https://ai.google.dev/)
[![Ollama](https://img.shields.io/badge/AI-Llama_3.2_via_Ollama-000000?logo=ollama&logoColor=white)](https://ollama.com/)

</div>

---

## Overview

**QELCare** is a production-oriented management system for a multispecialty outpatient clinic. It models the real operational flow of a clinic as an enforced state machine — a patient books an appointment, the Frontdesk confirms it, a nurse takes vitals and routes the patient into the correct specialty queue, a doctor runs the consultation and records findings, and a cashier settles billing — while layering on AI document intelligence, role-based dashboards, and an audit trail over sensitive actions.

It is built **from scratch** with no ORM and no UI framework: the data layer is hand-written PostgreSQL (schema, functions, triggers, and versioned migrations) and the interface is a hand-built React design system. The result is a codebase that demonstrates end-to-end ownership of authentication, concurrency-safe workflows, third-party AI integration, and security hardening.

## Key Features

### Clinical workflow engine
- **End-to-end appointment lifecycle** — `PENDING → CONFIRMED → IN_QUEUE → FOR_BILLING → COMPLETED`, with automatic no-show settlement and hourly sweeps that resolve stale, past-day queue entries so nothing gets stuck.
- **Per-specialty patient queues** across 8 departments — Cardiology, Gastroenterology, General Medicine, Ob-Gyne, Pediatrics, Psychiatry, Rehabilitation Medicine, and ENT — each with its own nurse queue screen and lifecycle timestamps.
- **Real-time lobby display** — an unauthenticated waiting-room screen that polls the queue every 10 seconds, rate-limited to survive public exposure.
- **Nurse vitals capture** with database-trigger-computed BMI, linked to consultation records without duplicating data.
- **Cashier & billing** with auto-generated official receipt numbers (`QEL-YYYY-NNNNN`), subtotals, and a full void/audit trail.

### AI document intelligence
- **Prescription & results OCR (Google Gemini)** — uploaded medical documents are parsed into structured data via raw HTTPS calls to the Gemini API.
- **Doctor medication-approval workflow** — parsed medications are surfaced to a doctor for review and approval before they enter a patient's record.
- **Self-hosted AI analytics (Llama 3.2 via Ollama)** — locally generated analytics reports with model warm-up on boot, keep-alive, and a built-in fallback generator so reporting still works when the model is unreachable.

### Access, security & auditability
- **Six clinic roles** — Admin, Doctor, Nurse, Frontdesk, Cashier, and Patient — each with a dedicated dashboard and route guards on **both** the frontend and the API.
- **JWT authentication with active token revocation** — logout genuinely invalidates a token server-side, backed by bcrypt password hashing (12 rounds) and password-history reuse prevention.
- **Layered abuse defense** — per-account login lockout and per-email OTP cooldown at the database layer, plus IP-based rate limits on auth, OTP, patient search, and the public display.
- **Hardened HTTP** — Helmet security headers and a strict Content-Security-Policy (`script-src 'self'`, no `unsafe-inline`) on both the Express API and the Vercel-hosted frontend.
- **Audit trail & privacy** — activity logging on sensitive mutations and recorded privacy consent.

### Communication & storage
- **Email OTP via Brevo** with a developer fallback that prints codes to the server console when email is unconfigured — local dev never gets stuck.
- **Cloudinary** for profile pictures and media.

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, React Router v7, native Fetch API, `pdfjs-dist` (in-browser PDF rendering), hand-built CSS design system (no UI framework), Jest + React Testing Library |
| **Backend** | Node.js, Express 4, feature-based REST architecture (14 modules), `multer` (uploads) |
| **Database** | PostgreSQL via the `pg` driver — **no ORM**; hand-written `schema.sql`, `functions.sql`, and versioned SQL migrations |
| **Auth & Security** | `jsonwebtoken` (with revocation), `bcrypt`, `helmet`, `express-rate-limit`, `cors` |
| **AI / Integrations** | Google Gemini (document OCR), self-hosted Llama 3.2 via Ollama (analytics), Brevo (transactional email), Cloudinary (media) |
| **Deployment** | Frontend on **Vercel**, backend + PostgreSQL on **Railway** |

## Architecture

The backend follows a **feature-based (vertical-slice) structure** — each domain owns its own controllers, models, and routes — rather than grouping by technical layer. Cross-cutting concerns (JWT verification, role checks, activity logging, email, token management, queue sweeps) live in a shared layer.

<details>
<summary><strong>Project structure</strong></summary>

```
QELCare-Website-Multispecialty-Clinic-Management-System//
├── public/                     # CRA static assets
├── src/                        # React frontend
│   ├── components/             # Role-based UI: AdminFeatures, DoctorSide, Nurse,
│   │                           #   NurseQueue, Cashier, FrontDesk, UserSide,
│   │                           #   QueueDisplay, Auth, Login, Register, LandingPage
│   ├── utils/                  # auth, roleAccess, adminTheme, exportUtils
│   └── App.js                  # Routes + role-based route guards
│
├── qelcare-backend/
│   ├── config/                 # database.js, cloudinary.js
│   ├── database/               # schema.sql, functions.sql, seed.sql + versioned patches
│   ├── features/               # 14 modules, each: controllers / models / routes
│   │   ├── auth/  patient/  appointment/  queue/  billing/  vitals/
│   │   ├── medication/  records/  patientResults/  notification/
│   │   └── inquiry/  relative/  analytics/  user/
│   ├── shared/
│   │   ├── middleware/         # tokenMiddleware (authenticate + authorize/RBAC)
│   │   └── utils/              # tokenManager, activityLogger, emailNotifier,
│   │                           #   queueSweep, passwordHistory
│   └── server.js               # Express app: headers, rate limits, routes, schedulers
│
├── vercel.json                 # Frontend security headers + SPA rewrites
└── package.json                # Root scripts: run web + API together
```
</details>

A companion **patient-only mobile app** (built with Capacitor) wraps the patient experience against this same backend and lives in a separate repository.

## Getting Started

### Prerequisites
- **Node.js** 18+ and npm
- **PostgreSQL** 14+
- *Optional (each degrades gracefully if unset):* a Brevo API key (email), a Cloudinary account (media), a Google Gemini API key (OCR), and a local [Ollama](https://ollama.com/) install running Llama 3.2 (AI analytics).

### 1. Clone and install
```bash
git clone https://github.com/acpilla/QELCare-Website-Multispecialty-Clinic-Management-System.git
cd QELCare-Website-Multispecialty-Clinic-Management-System

# Frontend deps (repo root)
npm install

# Backend deps
cd qelcare-backend && npm install && cd ..
```

### 2. Configure environment
```bash
# Frontend (repo root)
cp .env.example .env

# Backend
cp qelcare-backend/.env.example qelcare-backend/.env
```
Then fill in `qelcare-backend/.env` with your database credentials and a `JWT_SECRET` (see [Environment Variables](#environment-variables)). Optional API keys can be left blank for local development.

### 3. Set up the database
From `qelcare-backend/database`, run the SQL scripts against your PostgreSQL instance:
```bash
psql "$DATABASE_URL" -f schema.sql
psql "$DATABASE_URL" -f functions.sql
psql "$DATABASE_URL" -f seed.sql
```
This seeds the roles, the 8 specialties, and a default admin account:

> **Default admin:** `admin` / `Admin@12345` — **change this immediately on first login.**

> Applying updates to an existing database? Use the idempotent `migrate_phase1.sql` instead of `schema.sql`. See [`qelcare-backend/database/README.md`](qelcare-backend/database/README.md) for details.

### 4. Run
```bash
# From the repo root — starts the API (:5001) and the web app (:3000) together
npm run dev
```
Or run each side independently:
```bash
npm run dev:backend    # nodemon, API on :5001
npm run dev:frontend   # React dev server on :3000
```
The app is now at **http://localhost:3000**, talking to the API at **http://localhost:5001**.

## Environment Variables

**Frontend** (`.env`)

| Variable | Description | Example |
|---|---|---|
| `PORT` | React dev server port | `3000` |
| `REACT_APP_API_URL` | Base URL of the backend API (no trailing slash) | `http://localhost:5001` |

**Backend** (`qelcare-backend/.env`)

| Variable | Description |
|---|---|
| `PORT` / `NODE_ENV` / `FRONTEND_URL` | Server port, environment, and allowed frontend origin |
| `DB_USER` / `DB_PASS` / `DB_HOST` / `DB_PORT` / `DB_NAME` | PostgreSQL connection |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | JWT signing secret and token lifetime |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Transactional email (OTP delivery) |
| `EMAIL_DEV_FALLBACK` | `true` prints OTP codes to the server console when email is unconfigured |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Media storage |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google Gemini document OCR |

> The full annotated templates live in [`.env.example`](.env.example) and [`qelcare-backend/.env.example`](qelcare-backend/.env.example). Never commit real `.env` files.

## Roles & Access

| Role | Primary responsibilities |
|---|---|
| **Admin** | User management, appointments, billing oversight, analytics reports, activity logs |
| **Doctor** | Consultations, medical records, medication approvals |
| **Nurse** | Vitals capture, routing patients into specialty queues |
| **Frontdesk** | Appointment confirmation, rescheduling, patient management, inquiries |
| **Cashier** | Billing and receipt issuance |
| **Patient** | Booking, appointment history, medical records, and health documents |

Every protected route sits behind JWT authentication and an explicit role check on the API (`authenticate` + `authorize(['Admin', 'Cashier', ...])`), mirrored by route guards on the client (`ProtectedRoute`) — so authorization never depends on the frontend alone.

## Available Scripts

| Command | Runs |
|---|---|
| `npm run dev` | API **and** web app together (from repo root) |
| `npm run dev:backend` | Backend only (nodemon) |
| `npm run dev:frontend` | Frontend only |
| `npm run build` | Production build of the React app |
| `npm test` | Frontend test suite (Jest + React Testing Library) |

## Future Improvements
- Replace the lobby display's 10-second polling with WebSocket push for lower latency.
- Add automated test coverage across the backend feature modules.
- Introduce OpenAPI/Swagger documentation for the REST API.

## License

No open-source license has been declared for this repository, so all rights are reserved by the author by default. Please contact the maintainer before reusing the code.

## Contact

Built and maintained by **[@acpilla](https://github.com/acpilla)** · [Repository](https://github.com/QELCare-Website-Multispecialty-Clinic-Management-System/)
