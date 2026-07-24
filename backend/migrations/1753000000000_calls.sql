-- Calls table for WebRTC signaling history and call log.
-- Signaling (offer/answer/ICE) flows through the existing SSE realtime channel;
-- this table is the persistent audit trail + call history surface.

CREATE TABLE IF NOT EXISTS public.calls (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  callee_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  call_type   text        NOT NULL CHECK (call_type IN ('audio', 'video')),
  status      text        NOT NULL DEFAULT 'initiated'
                          CHECK (status IN ('initiated','ringing','accepted','ended','rejected','missed','failed')),
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_no_self_call CHECK (caller_id <> callee_id)
);

CREATE INDEX IF NOT EXISTS calls_caller_idx ON public.calls (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_callee_idx ON public.calls (callee_id, created_at DESC);
