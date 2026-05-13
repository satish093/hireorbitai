# TalentBridge AI

Role-based consultant marketing & recruiting portal. Four roles: **SUPER_ADMIN**, **MANAGER**, **RECRUITER**, **CONSULTANT**.

## Stack

- **Frontend** — React + TypeScript + Vite + Tailwind CSS + React Router + Axios + React Hook Form
- **Backend** — Node.js + Express + TypeScript
- **DB** — Supabase PostgreSQL
- **Auth** — Supabase Auth (Bearer JWT verified server-side)
- **Storage** — Supabase Storage (resume files)
- **AI** — OpenAI API (resume score, ATS score, job match, vendor email)
- **Email** — Resend (default) or SendGrid

## Repo layout

```
TalentBridge-AI/
├── backend/        Express API
├── frontend/       React app
├── database/
│   └── schema.sql  Postgres / Supabase schema
└── README.md
```

## Features

1. Supabase Auth + role-based protected routes
2. Email invitations (token, expiry, revoke)
3. Consultant onboarding flow
4. Recruiter onboarding flow
5. Manager / Recruiter / Consultant dashboards
6. Assign consultants to recruiters
7. Resume upload to Supabase Storage
8. Resume version history (one current per consultant)
9. AI resume score (OpenAI)
10. ATS score (resume ↔ JD) (OpenAI)
11. Job search + AI job matching
12. Application history
13. Vendor and client databases
14. Duplicate submission warning (consultant + job + vendor)
15. Interview scheduling
16. Interview feedback form
17. Mock interview scheduling
18. Reminder / follow-up system
19. Recruiter daily activity report
20. Marketing status (ACTIVE / PAUSED / PLACED)
21. Internal calendar (interviews + reminders)
22. AI email generator for vendor submission

## Prerequisites

- Node.js 22+ (LTS) — both `backend` and `frontend` pin `engines.node >= 22.0.0`. The repo includes an `.nvmrc` so `nvm use` selects it for you.
- A Supabase project (URL, anon key, service-role key)
- An OpenAI API key
- A Resend or SendGrid account

## 1. Database setup

In the Supabase dashboard, open the SQL editor and run [`database/schema.sql`](database/schema.sql).

Then in **Storage**, create a private bucket named **`resumes`** (or whatever you set `SUPABASE_STORAGE_BUCKET` to).

## 2. Backend setup

```powershell
cd backend
cp .env.example .env   # then fill in values
npm install
npm run dev
```

The API listens on `http://localhost:4000` and exposes:

- `GET  /health`
- `GET  /api/auth/me`              (auth)
- `POST /api/auth/sync`            (auth)
- `POST /api/invitations`          (manager/admin)
- `POST /api/invitations/accept`
- `GET  /api/consultants`
- `POST /api/consultants/onboard`
- `POST /api/consultants/:id/assign-recruiter`
- `POST /api/consultants/:id/marketing-status`
- `GET  /api/recruiters`
- `POST /api/recruiters/onboard`
- `POST /api/resumes/upload`       (multipart)
- `GET  /api/resumes/:id/download-url`
- `POST /api/resumes/:id/score`
- `POST /api/resumes/:id/set-current`
- `GET  /api/jobs`
- `GET  /api/jobs/match/consultant/:consultantId`
- `GET  /api/vendors`  /  `POST /api/vendors`
- `GET  /api/clients`  /  `POST /api/clients`
- `GET  /api/applications` + `POST /:id/ats-score`
- `GET  /api/applications/check-duplicate`
- `GET  /api/interviews`  /  `POST /api/interviews`  /  `POST /api/interviews/mock`
- `POST /api/interviews/:id/feedback`
- `GET  /api/reminders`  /  `POST /api/reminders`
- `GET  /api/reports/daily`  /  `POST /api/reports/daily`
- `GET  /api/reports/manager-summary`
- `POST /api/ai/resume-score`
- `POST /api/ai/ats-score`
- `POST /api/ai/vendor-email`

## 3. Frontend setup

```powershell
cd frontend
cp .env.example .env   # then fill in values
npm install
npm run dev
```

The app runs on `http://localhost:5173`.

## 4. Bootstrap the first admin

1. Sign up via the login page (the first user is created in Supabase Auth).
2. In Supabase SQL editor, promote yourself:

   ```sql
   update public.users set role = 'SUPER_ADMIN' where email = 'you@example.com';
   ```

3. Refresh the app — you can now invite recruiters/managers/consultants.

## Environment variables

### Backend (`backend/.env`)

| Var | Notes |
|---|---|
| `PORT` | API port, default 4000 |
| `CORS_ORIGIN` | Frontend origin, e.g. `http://localhost:5173` |
| `APP_URL` | Used in invitation links |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | From Supabase project settings |
| `SUPABASE_STORAGE_BUCKET` | e.g. `resumes` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | `gpt-4o-mini` is a good default |
| `EMAIL_PROVIDER` | `resend` or `sendgrid` |
| `EMAIL_FROM` | Verified sender, e.g. `TalentBridge <no-reply@example.com>` |
| `RESEND_API_KEY` *or* `SENDGRID_API_KEY` | Whichever provider you picked |
| `INVITATION_EXPIRY_HOURS` | Default 72 |

### Frontend (`frontend/.env`)

| Var | Notes |
|---|---|
| `VITE_API_URL` | Backend URL + `/api` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Public Supabase keys |

## Notes & caveats

- Backend uses the Supabase **service-role key** and bypasses RLS for app logic. The schema enables RLS so direct anon-key access from the browser stays restricted; tighten policies per your needs.
- AI endpoints expect resume **text**. Wire in a PDF/DOCX text extractor before passing files to `/api/ai/*`.
- Reminders are stored but no scheduler is included — wire in a cron / Supabase Edge Function to send the `due_at` notifications via `sendEmail`.
- Duplicate-submission guard is enforced at both API layer and via a unique index on `(consultant_id, job_id, vendor_id)`.

## Scripts

Backend: `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`
Frontend: `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`
