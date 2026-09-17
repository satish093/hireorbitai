import { useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { SelectInput } from '../SelectInput';
import { api } from '../../services/api';
import type { JobRow } from './types';

interface CopilotQuestion {
  key: string;
  text: string;
  inputType: 'boolean' | 'text' | 'number' | 'select';
  required: boolean;
  answer: string | null;
  source: string | null;
}

interface CopilotState {
  application: {
    id: string;
    status: string;
    applicationType: string | null;
    submittedAt: string | null;
  };
  job: { id: string; title: string; companyName: string | null; linkedinJobUrl: string | null };
  resume: { id: string; fileName: string | null } | null;
  coverLetter: { text: string | null; source: string | null };
  questions: CopilotQuestion[];
  missingRequiredKeys: string[];
  linkedin: { status: 'not_connected' | 'connected' | 'reauthorization_required' };
  alreadyApplied: boolean;
}

/**
 * LinkedIn has no API for job-application submission, so this wizard never
 * submits anything itself — it assembles the resume/cover-letter/answers,
 * sends the consultant to LinkedIn's own Easy Apply / apply page, and records
 * SUBMITTED only after they click "I submitted — confirm" here themselves.
 * "Common questions" is a fixed catalog (shared/src/applicationQuestions.ts),
 * not live-DOM detection of LinkedIn's actual form fields — that limitation
 * is called out in the copy below rather than implied away.
 */
export function ApplyCopilotWizard({
  job,
  onClose,
  onSubmitted,
}: {
  job: JobRow;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [state, setState] = useState<CopilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [coverLetterDraft, setCoverLetterDraft] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.post('/application-copilot/start', { job_id: job.id });
        if (!cancelled) applyState(r.data);
      } catch (e: any) {
        toast.error(e?.response?.data?.error ?? 'Failed to start application');
        if (!cancelled) onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  function applyState(s: CopilotState) {
    setState(s);
    setCoverLetterDraft(s.coverLetter.text ?? '');
    const drafts: Record<string, string> = {};
    for (const q of s.questions) drafts[q.key] = q.answer ?? '';
    setAnswerDrafts(drafts);
  }

  async function saveAnswers() {
    if (!state) return;
    const answers = state.questions
      .map((q) => ({ key: q.key, value: (answerDrafts[q.key] ?? '').trim() }))
      .filter((a) => a.value.length > 0);
    if (answers.length === 0) return;
    setBusy(true);
    try {
      const r = await api.patch(`/application-copilot/${state.application.id}/answers`, {
        answers,
      });
      applyState(r.data);
      toast.success('Answers saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save answers');
    } finally {
      setBusy(false);
    }
  }

  async function saveCoverLetter() {
    if (!state || !coverLetterDraft.trim()) return;
    setBusy(true);
    try {
      const r = await api.patch(`/application-copilot/${state.application.id}/cover-letter`, {
        text: coverLetterDraft.trim(),
      });
      applyState(r.data);
      toast.success('Cover letter saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save cover letter');
    } finally {
      setBusy(false);
    }
  }

  function openOnLinkedIn() {
    const url = state?.job.linkedinJobUrl || job.linkedin_job_url || job.apply_url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else toast.error('No LinkedIn job link on file for this posting');
  }

  async function connectLinkedIn() {
    try {
      const r = await api.get('/linkedin/authorize');
      window.location.href = r.data.url;
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to start LinkedIn connect');
    }
  }

  async function confirmSubmitted() {
    if (!state) return;
    setBusy(true);
    try {
      await api.post(`/application-copilot/${state.application.id}/confirm`);
      toast.success('Application recorded');
      onSubmitted();
    } catch (e: any) {
      const missing = e?.response?.data?.details?.missing;
      toast.error(
        Array.isArray(missing) && missing.length > 0
          ? 'Answer the required questions before confirming'
          : (e?.response?.data?.error ?? 'Failed to confirm submission'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function logExternal() {
    setBusy(true);
    try {
      await api.post('/application-copilot/log-external', { job_id: job.id });
      toast.success('Logged as applied');
      onSubmitted();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to log application');
    } finally {
      setBusy(false);
    }
  }

  const answersDirty =
    !!state && state.questions.some((q) => (answerDrafts[q.key] ?? '') !== (q.answer ?? ''));
  const coverLetterDirty = !!state && coverLetterDraft !== (state.coverLetter.text ?? '');
  const canConfirm =
    !!state && state.missingRequiredKeys.length === 0 && state.linkedin.status === 'connected';

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply on LinkedIn"
      description={job.company_name ? `${job.title} · ${job.company_name}` : job.title}
      size="lg"
      footer={
        loading || !state ? undefined : state.alreadyApplied ? (
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="md" onClick={logExternal} disabled={busy}>
              I already applied
            </Button>
            <Button variant="outline" size="md" onClick={openOnLinkedIn}>
              Open on LinkedIn
            </Button>
            <Button
              variant="accent"
              size="md"
              onClick={confirmSubmitted}
              loading={busy}
              disabled={!canConfirm}
            >
              I submitted — confirm
            </Button>
          </>
        )
      }
    >
      {loading || !state ? (
        <div className="py-10 text-center text-sm text-muted">Preparing your application…</div>
      ) : state.alreadyApplied ? (
        <div className="py-6 text-center text-sm text-ink">
          This application is already recorded as{' '}
          <strong>{state.application.status === 'SUBMITTED' ? 'submitted' : 'applied'}</strong>.
        </div>
      ) : (
        <div className="space-y-5">
          {state.linkedin.status !== 'connected' && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
                {state.linkedin.status === 'reauthorization_required'
                  ? 'Reconnect LinkedIn to confirm'
                  : 'Connect LinkedIn to confirm'}
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 mb-3">
                We never submit on LinkedIn's site for you — you apply there yourself and confirm it
                here. Confirming needs a live LinkedIn connection so we know it's really you.
              </p>
              <Button variant="outline" size="sm" onClick={connectLinkedIn}>
                {state.linkedin.status === 'reauthorization_required'
                  ? 'Reconnect LinkedIn'
                  : 'Connect LinkedIn'}
              </Button>
            </div>
          )}

          <Section title="Resume">
            <p className="text-sm text-ink">
              {state.resume ? (state.resume.fileName ?? 'Current resume') : 'No resume on file'}
            </p>
          </Section>

          <Section
            title="Cover letter"
            action={
              coverLetterDirty && (
                <Button variant="outline" size="sm" onClick={saveCoverLetter} disabled={busy}>
                  Save
                </Button>
              )
            }
          >
            <textarea
              rows={6}
              value={coverLetterDraft}
              onChange={(e) => setCoverLetterDraft(e.target.value)}
              placeholder="Write or edit your cover letter…"
              className="w-full text-sm border border-border-strong rounded-lg p-2.5 bg-surface text-ink focus:outline-none focus-visible:ring-2 focus-visible:border-accent"
            />
            {state.coverLetter.source === 'ai_generated' && (
              <p className="text-[11px] text-muted mt-1 italic">
                AI-drafted — review before using.
              </p>
            )}
          </Section>

          <Section
            title="Common questions"
            sub="Answered from your saved profile where we can — LinkedIn exposes no API for us to read its own form, so review these before confirming."
            action={
              answersDirty && (
                <Button variant="outline" size="sm" onClick={saveAnswers} disabled={busy}>
                  Save
                </Button>
              )
            }
          >
            <div className="space-y-3">
              {state.questions.map((q) =>
                q.inputType === 'boolean' ? (
                  <SelectInput
                    key={q.key}
                    label={q.required ? `${q.text} *` : q.text}
                    placeholder="Select…"
                    options={[
                      { value: 'Yes', label: 'Yes' },
                      { value: 'No', label: 'No' },
                    ]}
                    value={answerDrafts[q.key] ?? ''}
                    onChange={(e) => setAnswerDrafts((d) => ({ ...d, [q.key]: e.target.value }))}
                  />
                ) : (
                  <FormInput
                    key={q.key}
                    label={q.required ? `${q.text} *` : q.text}
                    type={q.inputType === 'number' ? 'number' : 'text'}
                    value={answerDrafts[q.key] ?? ''}
                    onChange={(e) => setAnswerDrafts((d) => ({ ...d, [q.key]: e.target.value }))}
                  />
                ),
              )}
            </div>
          </Section>

          {state.missingRequiredKeys.length > 0 && (
            <p className="text-xs text-danger">
              Answer the required questions above and click Save before confirming.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Section({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
        {action}
      </div>
      {sub && <p className="text-[11px] text-muted mb-2">{sub}</p>}
      {children}
    </div>
  );
}
