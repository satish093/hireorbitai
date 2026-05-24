-- Migration: add consultants.onboarded_at
-- Tracks when a consultant first became ACTIVE; powers time-to-placement and
-- time-to-first-submission KPIs in the reports dashboard.

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

COMMENT ON COLUMN public.consultants.onboarded_at
  IS 'When the consultant was first set ACTIVE; used for time-to-placement / time-to-first-submission KPIs.';

CREATE OR REPLACE FUNCTION public.set_consultant_onboarded_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.marketing_status = 'ACTIVE'
     AND OLD.marketing_status IS DISTINCT FROM 'ACTIVE'
     AND NEW.onboarded_at IS NULL
  THEN NEW.onboarded_at := now(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultant_onboarded_at ON public.consultants;
CREATE TRIGGER trg_consultant_onboarded_at
  BEFORE UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.set_consultant_onboarded_at();

-- Back-fill: already-ACTIVE consultants get created_at as a proxy
UPDATE public.consultants
   SET onboarded_at = created_at
 WHERE marketing_status = 'ACTIVE' AND onboarded_at IS NULL;
