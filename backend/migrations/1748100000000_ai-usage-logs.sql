CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_name         text        NOT NULL,
  model             text        NOT NULL,
  input_tokens      integer     NOT NULL DEFAULT 0,
  output_tokens     integer     NOT NULL DEFAULT 0,
  cache_read_tokens integer     NOT NULL DEFAULT 0,
  cost_usd          numeric(12, 6) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx ON public.ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_call_name_idx  ON public.ai_usage_logs (call_name);
CREATE INDEX IF NOT EXISTS ai_usage_logs_model_idx      ON public.ai_usage_logs (model);
