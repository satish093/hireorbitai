-- Work authorization documents (H-1B, EAD, I-20, passport, etc.)
-- Consultants upload; visible to their recruiter and manager only.
-- Run with: npm --prefix backend run migrate:up

CREATE TABLE IF NOT EXISTS public.work_auth_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,          -- H1B | EAD | I20 | PASSPORT | OFFER_LETTER | I797 | OTHER
  label               TEXT,
  issue_date          DATE,
  expiry_date         DATE,
  file_name           TEXT NOT NULL,
  storage_path        TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  uploaded_by         UUID NOT NULL REFERENCES public.users(id),
  last_expiry_alert_at TIMESTAMPTZ,           -- tracks most recent expiry-alert email
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_auth_documents_consultant_idx
  ON public.work_auth_documents (consultant_id);

CREATE INDEX IF NOT EXISTS work_auth_documents_expiry_idx
  ON public.work_auth_documents (expiry_date)
  WHERE expiry_date IS NOT NULL;
