import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Modal } from './Modal';

/**
 * UI for the STEM-OPT completion workflow that sits on top of an assignment:
 *
 *   - <CompletionGatesPanel>   shows every gate (lessons, time, quiz, uploads,
 *                              acknowledgement, final assessment, manager
 *                              approval) with pass/fail chips. Server-derived,
 *                              never trust client state.
 *   - <AcknowledgementCard>    consultant-only attestation. Once signed,
 *                              renders the recorded text + timestamp.
 *   - <FinalAssessmentCard>    three modes — manager-author, consultant-
 *                              submit, manager-grade — gated by role + state.
 *   - <SupervisionNotesPanel>  trainer/manager journal; consultant read-only.
 *   - <ComplianceReportButton> downloads the consolidated CSV report.
 *
 * Every mutation calls onRefresh() so the parent re-fetches gates and
 * progress. Keeps the UI honest about server truth.
 */

// ============================================================================
// Types — kept loose because backend rows have many optional fields.
// ============================================================================
export interface GateState {
  lessons: { completed: number; total: number; ok: boolean };
  time: { minutes: number; required: number | null; ok: boolean };
  quiz: { score: number | null; passing: number | null; attempts_exceeded: boolean; ok: boolean };
  uploads: { submitted: number; required: number; ok: boolean };
  acknowledgement: { acknowledged: boolean; ok: boolean };
  final_assessment: { exists: boolean; passed: boolean; ok: boolean };
  manager_approval: { required: boolean; approved: boolean; ok: boolean };
}
export interface CompletionEvaluation {
  status: string;
  progress_percentage: number;
  blockers: string[];
  gates: GateState;
}

// ============================================================================
// Hook — loads /gates and re-fetches on demand
// ============================================================================
export function useCompletionGates(assignmentId: string | undefined) {
  const [data, setData] = useState<CompletionEvaluation | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!assignmentId) return;
    setLoading(true);
    try {
      const r = await api.get(`/training/assignments/${assignmentId}/gates`);
      setData(r.data);
    } catch (e: any) {
      // 403 / 404 are expected for the "still hydrating" race — stay quiet.
      const status = e?.response?.status;
      if (status !== 403 && status !== 404) {
        toast.error(e?.response?.data?.error ?? 'Failed to load completion gates');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [assignmentId]);

  return { data, loading, refresh: load };
}

// Plain-language labels for the derived assignment status.
const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  QUIZ_PENDING: 'Quiz to take',
  ASSIGNMENT_PENDING: 'Work to submit',
  FINAL_ASSESSMENT_PENDING: 'Final assessment due',
  MANAGER_REVIEW_PENDING: 'Awaiting manager review',
  COMPLETED: 'Completed',
  FAILED: 'Not passed',
  OVERDUE: 'Overdue',
};

// ============================================================================
// CompletionGatesPanel
// ============================================================================
export function CompletionGatesPanel({ evaluation }: { evaluation: CompletionEvaluation | null }) {
  if (!evaluation) return null;
  const g = evaluation.gates;

  const rows: { label: string; ok: boolean; detail: string }[] = [
    {
      label: 'Lessons complete',
      ok: g.lessons.ok,
      detail: `${g.lessons.completed} / ${g.lessons.total}`,
    },
    {
      label: 'Minimum study time',
      ok: g.time.ok,
      detail:
        g.time.required == null ? 'no minimum' : `${g.time.minutes} / ${g.time.required} minutes`,
    },
    {
      label: 'Quiz',
      ok: g.quiz.ok,
      detail: g.quiz.attempts_exceeded
        ? 'attempts exceeded — course failed'
        : g.quiz.passing == null
          ? g.quiz.score == null
            ? 'not started'
            : `${g.quiz.score}% (every question must pass)`
          : `${g.quiz.score ?? 0}% / ${g.quiz.passing}% required`,
    },
    {
      label: 'Assignment uploads',
      ok: g.uploads.ok,
      detail:
        g.uploads.required === 0
          ? 'no required submissions'
          : `${g.uploads.submitted} / ${g.uploads.required}`,
    },
    {
      label: 'Acknowledgement',
      ok: g.acknowledgement.ok,
      detail: g.acknowledgement.acknowledged ? 'signed' : 'awaiting consultant',
    },
    {
      label: 'Final assessment',
      ok: g.final_assessment.ok,
      detail: !g.final_assessment.exists
        ? 'not required'
        : g.final_assessment.passed
          ? 'passed'
          : 'pending',
    },
    {
      label: 'Manager approval',
      ok: g.manager_approval.ok,
      detail: !g.manager_approval.required
        ? 'not required'
        : g.manager_approval.approved
          ? 'approved'
          : 'awaiting manager',
    },
  ];

  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            What's left to finish
          </div>
          <h3 className="text-base font-semibold tracking-tight">
            Status:{' '}
            <span
              className={
                evaluation.status === 'COMPLETED'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : evaluation.status === 'FAILED'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-ink'
              }
            >
              {STATUS_LABEL[evaluation.status] ?? evaluation.status.replace(/_/g, ' ')}
            </span>
          </h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Progress
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {Math.round(evaluation.progress_percentage)}%
          </div>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Pip ok={r.ok} />
              <span className="text-sm text-ink">{r.label}</span>
            </div>
            <span className="text-xs text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>

      {evaluation.blockers.length > 0 && evaluation.status !== 'COMPLETED' && (
        <div className="mt-3 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
          <span className="font-semibold">Still needed to finish:</span>{' '}
          {evaluation.blockers.join(' · ')}
        </div>
      )}
    </div>
  );
}

function Pip({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold ${
        ok ? 'bg-emerald-500 text-white' : 'bg-hover text-muted'
      }`}
    >
      {ok ? '✓' : '·'}
    </span>
  );
}

// ============================================================================
// Acknowledgement
// ============================================================================
const REQUIRED_ACK_TEXT =
  'I confirm that I completed this training, understand the course material, and can apply the skills covered in this course.';

export function AcknowledgementCard({
  assignmentId,
  isConsultant,
  onChanged,
}: {
  assignmentId: string;
  isConsultant: boolean;
  onChanged: () => void;
}) {
  const [ack, setAck] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/training/assignments/${assignmentId}/acknowledgement`);
      setAck(r.data ?? null);
    } catch {
      setAck(null);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [assignmentId]);

  async function submit() {
    setSubmitting(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/acknowledgement`, {
        acknowledgement_text: REQUIRED_ACK_TEXT,
      });
      toast.success('Acknowledgement recorded');
      setOpen(false);
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to record acknowledgement');
    } finally {
      setSubmitting(false);
    }
  }

  if (ack) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-4 text-sm text-emerald-900">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-1">
          Acknowledgement signed
        </div>
        <p className="italic">"{ack.acknowledgement_text}"</p>
        <div className="text-xs text-emerald-800 dark:text-emerald-300 mt-2">
          Signed {new Date(ack.acknowledged_at).toLocaleString()}
        </div>
      </div>
    );
  }

  if (!isConsultant) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-4 text-sm text-muted">
        Acknowledgement not yet submitted by the consultant.
      </div>
    );
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-2xl p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Acknowledgement required
          </div>
          <p className="text-sm text-ink mt-0.5">
            Confirm you've completed the training and understand the material.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="bg-ink text-bg text-sm px-4 py-1.5 rounded-lg hover:opacity-90"
        >
          Sign acknowledgement
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Training acknowledgement"
        footer={
          <button
            onClick={submit}
            disabled={submitting}
            className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Recording…' : 'I confirm'}
          </button>
        }
      >
        <p className="text-sm text-ink">
          By clicking <span className="font-semibold">I confirm</span> you are signing the following
          statement, which becomes part of your training record:
        </p>
        <blockquote className="mt-3 border-l-4 border-border pl-4 italic text-sm text-ink">
          {REQUIRED_ACK_TEXT}
        </blockquote>
        <p className="text-xs text-muted mt-3">
          Your IP address and user agent are recorded alongside the timestamp for audit purposes.
        </p>
      </Modal>
    </>
  );
}

// ============================================================================
// Final Assessment
// ============================================================================
type AssessmentKind =
  | 'MULTIPLE_CHOICE'
  | 'SHORT_ANSWER'
  | 'PRACTICAL_ASSIGNMENT'
  | 'MANAGER_REVIEW';
type AssessmentStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
interface FinalAssessment {
  id: string;
  assignment_id: string;
  assessment_type: AssessmentKind;
  questions: unknown;
  answers: unknown;
  score: number | null;
  passed: boolean | null;
  manager_feedback: string | null;
  approval_status: AssessmentStatus;
  approved_by: string | null;
  approved_at: string | null;
  submitted_at: string | null;
}

export function FinalAssessmentCard({
  assignmentId,
  isManager,
  isConsultant,
  onChanged,
}: {
  assignmentId: string;
  isManager: boolean;
  isConsultant: boolean;
  onChanged: () => void;
}) {
  const [fa, setFa] = useState<FinalAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/training/assignments/${assignmentId}/final-assessment`);
      setFa(r.data ?? null);
    } catch {
      setFa(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [assignmentId]);

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-4 text-xs text-muted">
        Loading final assessment…
      </div>
    );
  }

  // ----- No assessment authored yet -----
  if (!fa) {
    if (isManager) {
      return (
        <>
          <div className="bg-surface border border-dashed border-border rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Final assessment
              </div>
              <p className="text-sm text-ink mt-0.5">
                Set the final task this consultant must complete to finish the course.
              </p>
            </div>
            <button
              onClick={() => setAuthorOpen(true)}
              className="bg-ink text-bg text-sm px-4 py-1.5 rounded-lg hover:opacity-90"
            >
              + Create assessment
            </button>
          </div>
          <FinalAssessmentAuthorModal
            open={authorOpen}
            onClose={() => setAuthorOpen(false)}
            assignmentId={assignmentId}
            onSaved={() => {
              load();
              onChanged();
            }}
          />
        </>
      );
    }
    return (
      <div className="bg-surface border border-border rounded-2xl p-4 text-sm text-muted">
        No final assessment has been set for this course yet.
      </div>
    );
  }

  // ----- Assessment exists -----
  return (
    <>
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Final assessment ({fa.assessment_type.replace(/_/g, ' ').toLowerCase()})
            </div>
            <h3 className="text-base font-semibold tracking-tight">
              Status: <ApprovalBadge status={fa.approval_status} />
            </h3>
            {fa.score != null && (
              <div className="text-xs text-muted mt-1">
                Score: <span className="font-semibold tabular-nums">{fa.score}%</span>
                {fa.passed === true && (
                  <span className="ml-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                    ✓ Passed
                  </span>
                )}
                {fa.passed === false && (
                  <span className="ml-2 text-red-700 dark:text-red-300 font-semibold">
                    ✗ Did not pass
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            {isConsultant && fa.approval_status === 'PENDING' && (
              <button
                onClick={() => setSubmitOpen(true)}
                className="bg-ink text-bg text-sm px-3 py-1.5 rounded-lg hover:opacity-90"
              >
                Submit answers
              </button>
            )}
            {isConsultant && fa.approval_status === 'REJECTED' && (
              <button
                onClick={() => setSubmitOpen(true)}
                className="border border-border text-ink text-sm px-3 py-1.5 rounded-lg hover:bg-hover"
              >
                Resubmit
              </button>
            )}
            {isManager &&
              (fa.approval_status === 'SUBMITTED' || fa.approval_status === 'PENDING') && (
                <button
                  onClick={() => setGradeOpen(true)}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-700"
                >
                  Grade
                </button>
              )}
            {isManager && (
              <button
                onClick={() => setAuthorOpen(true)}
                className="border border-border text-ink text-sm px-3 py-1.5 rounded-lg hover:bg-hover"
              >
                Edit questions
              </button>
            )}
          </div>
        </div>

        {fa.questions ? (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer text-ink font-medium">View questions</summary>
            <pre className="mt-2 bg-hover border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(fa.questions, null, 2)}
            </pre>
          </details>
        ) : null}

        {fa.manager_feedback && (
          <div className="mt-3 text-sm bg-hover border border-border rounded-lg p-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
              Manager feedback
            </div>
            <p className="text-ink whitespace-pre-wrap">{fa.manager_feedback}</p>
          </div>
        )}
      </div>

      <FinalAssessmentAuthorModal
        open={authorOpen}
        onClose={() => setAuthorOpen(false)}
        assignmentId={assignmentId}
        existing={fa}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
      <FinalAssessmentSubmitModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        assignmentId={assignmentId}
        existing={fa}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
      <FinalAssessmentGradeModal
        open={gradeOpen}
        onClose={() => setGradeOpen(false)}
        assignmentId={assignmentId}
        existing={fa}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
    </>
  );
}

function ApprovalBadge({ status }: { status: AssessmentStatus }) {
  const cls =
    status === 'APPROVED'
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
      : status === 'REJECTED'
        ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
        : status === 'SUBMITTED'
          ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30'
          : 'bg-hover text-ink border-border';
  return (
    <span
      className={`inline-block text-[11px] font-semibold border rounded-full px-2 py-0.5 ${cls}`}
    >
      {status}
    </span>
  );
}

// ----- Author modal: manager authors the prompt (free-form JSON for v1) -----
function FinalAssessmentAuthorModal({
  open,
  onClose,
  assignmentId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  existing?: FinalAssessment | null;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<AssessmentKind>(existing?.assessment_type ?? 'SHORT_ANSWER');
  const [questionsText, setQuestionsText] = useState(
    existing?.questions ? JSON.stringify(existing.questions, null, 2) : '',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setKind(existing?.assessment_type ?? 'SHORT_ANSWER');
      setQuestionsText(existing?.questions ? JSON.stringify(existing.questions, null, 2) : '');
    }
  }, [open, existing]);

  async function save() {
    let parsedQuestions: unknown = null;
    if (questionsText.trim()) {
      try {
        parsedQuestions = JSON.parse(questionsText);
      } catch {
        toast.error('Questions must be valid JSON');
        return;
      }
    }
    setSaving(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/final-assessment`, {
        assessment_type: kind,
        questions: parsedQuestions,
      });
      toast.success('Assessment saved');
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit final assessment' : 'Create final assessment'}
      footer={
        <button
          onClick={save}
          disabled={saving}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Assessment type
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AssessmentKind)}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
        >
          <option value="MULTIPLE_CHOICE">Multiple choice</option>
          <option value="SHORT_ANSWER">Short answer</option>
          <option value="PRACTICAL_ASSIGNMENT">Practical assignment</option>
          <option value="MANAGER_REVIEW">Manager review only</option>
        </select>
      </label>
      <label className="block mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Questions (JSON — optional)
        </span>
        <textarea
          rows={10}
          value={questionsText}
          onChange={(e) => setQuestionsText(e.target.value)}
          placeholder='[\n  { "q": "Describe the bean lifecycle.", "max_words": 200 }\n]'
          className="mt-1 w-full text-sm font-mono border border-border rounded-md px-2 py-1.5"
        />
      </label>
      <p className="text-xs text-muted mt-2">
        For MANAGER_REVIEW you can leave questions empty — you'll grade based on the consultant's
        overall work.
      </p>
    </Modal>
  );
}

// ----- Submit modal: consultant fills answers -----
function FinalAssessmentSubmitModal({
  open,
  onClose,
  assignmentId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  existing: FinalAssessment;
  onSaved: () => void;
}) {
  const [answersText, setAnswersText] = useState(
    existing.answers ? JSON.stringify(existing.answers, null, 2) : '',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAnswersText(existing.answers ? JSON.stringify(existing.answers, null, 2) : '');
    }
  }, [open, existing]);

  async function submit() {
    let parsedAnswers: unknown = answersText.trim() ? null : '';
    if (answersText.trim()) {
      try {
        parsedAnswers = JSON.parse(answersText);
      } catch {
        // Allow plain text too — wrap it in an object so the server stores something
        // typed but the consultant doesn't need to know JSON.
        parsedAnswers = { text: answersText };
      }
    }
    setSaving(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/final-assessment/submit`, {
        answers: parsedAnswers,
      });
      toast.success('Submitted — awaiting grading');
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to submit');
    } finally {
      setSaving(false);
    }
  }

  const questions = useMemo(() => {
    if (!existing.questions) return null;
    try {
      return JSON.stringify(existing.questions, null, 2);
    } catch {
      return String(existing.questions);
    }
  }, [existing.questions]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit final assessment"
      footer={
        <button
          onClick={submit}
          disabled={saving}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      }
    >
      {questions && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
            Questions
          </div>
          <pre className="text-xs bg-hover border border-border rounded-md p-2 whitespace-pre-wrap">
            {questions}
          </pre>
        </div>
      )}
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Your answers
        </span>
        <textarea
          rows={10}
          value={answersText}
          onChange={(e) => setAnswersText(e.target.value)}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
          placeholder="Type your answers here. JSON is accepted but not required."
        />
      </label>
    </Modal>
  );
}

// ----- Grade modal: manager scores + approves/rejects -----
function FinalAssessmentGradeModal({
  open,
  onClose,
  assignmentId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  existing: FinalAssessment;
  onSaved: () => void;
}) {
  const [score, setScore] = useState<string>(existing.score?.toString() ?? '');
  const [passed, setPassed] = useState<boolean>(existing.passed ?? true);
  const [feedback, setFeedback] = useState<string>(existing.manager_feedback ?? '');
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setScore(existing.score?.toString() ?? '');
      setPassed(existing.passed ?? true);
      setFeedback(existing.manager_feedback ?? '');
      setDecision('APPROVED');
    }
  }, [open, existing]);

  async function save() {
    const numericScore = score === '' ? null : Number(score);
    if (
      numericScore != null &&
      (Number.isNaN(numericScore) || numericScore < 0 || numericScore > 100)
    ) {
      toast.error('Score must be 0–100');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/final-assessment/grade`, {
        score: numericScore,
        passed,
        manager_feedback: feedback.trim() || null,
        approval_status: decision,
      });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Returned to consultant');
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Show the submitted answers so the manager doesn't have to swap windows.
  const answersBlock = useMemo(() => {
    if (existing.answers == null) return null;
    try {
      return JSON.stringify(existing.answers, null, 2);
    } catch {
      return String(existing.answers);
    }
  }, [existing.answers]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Grade final assessment"
      footer={
        <button
          onClick={save}
          disabled={saving}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save grade'}
        </button>
      }
    >
      {answersBlock && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
            Consultant submission
          </div>
          <pre className="text-xs bg-hover border border-border rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap">
            {answersBlock}
          </pre>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Score (0–100)
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Pass / fail
          </span>
          <select
            value={passed ? 'pass' : 'fail'}
            onChange={(e) => setPassed(e.target.value === 'pass')}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
        </label>
      </div>
      <label className="block mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Manager feedback
        </span>
        <textarea
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
        />
      </label>
      <label className="block mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Decision
        </span>
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as 'APPROVED' | 'REJECTED')}
          className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
        >
          <option value="APPROVED">Approve — counts toward completion</option>
          <option value="REJECTED">Reject — send back to consultant</option>
        </select>
      </label>
    </Modal>
  );
}

// ============================================================================
// Supervision notes
// ============================================================================
export function SupervisionNotesPanel({
  assignmentId,
  isManager,
}: {
  assignmentId: string;
  isManager: boolean;
}) {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/training/assignments/${assignmentId}/supervision-notes`);
      setNotes(r.data ?? []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [assignmentId]);

  return (
    <>
      <div className="bg-surface border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Supervision notes
            </div>
            <h3 className="text-base font-semibold tracking-tight">
              Trainer journal ({notes.length})
            </h3>
          </div>
          {isManager && (
            <button
              onClick={() => setOpen(true)}
              className="bg-ink text-bg text-sm px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              + Add note
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted italic">No supervision notes recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="border-l-2 border-border pl-3">
                <div className="text-xs text-muted">
                  {new Date(n.observed_on).toLocaleDateString()} ·{' '}
                  {n.trainer?.full_name ?? 'Trainer'}
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap">{n.note}</p>
                {(n.skill_progress || n.areas_for_improvement || n.next_steps) && (
                  <dl className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
                    {n.skill_progress && (
                      <NoteBlock label="Skill progress" value={n.skill_progress} />
                    )}
                    {n.areas_for_improvement && (
                      <NoteBlock label="Areas for improvement" value={n.areas_for_improvement} />
                    )}
                    {n.next_steps && <NoteBlock label="Next steps" value={n.next_steps} />}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <SupervisionNoteModal
        open={open}
        onClose={() => setOpen(false)}
        assignmentId={assignmentId}
        onSaved={load}
      />
    </>
  );
}

function NoteBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-hover border border-border rounded-md p-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-0.5">
        {label}
      </div>
      <p className="text-ink whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function SupervisionNoteModal({
  open,
  onClose,
  assignmentId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    note: '',
    skill_progress: '',
    areas_for_improvement: '',
    next_steps: '',
    observed_on: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        note: '',
        skill_progress: '',
        areas_for_improvement: '',
        next_steps: '',
        observed_on: new Date().toISOString().slice(0, 10),
      });
    }
  }, [open]);

  async function save() {
    if (!form.note.trim()) {
      toast.error('Note is required');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/training/assignments/${assignmentId}/supervision-notes`, {
        note: form.note,
        skill_progress: form.skill_progress || null,
        areas_for_improvement: form.areas_for_improvement || null,
        next_steps: form.next_steps || null,
        observed_on: form.observed_on,
      });
      toast.success('Note added');
      onClose();
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New supervision note"
      footer={
        <button
          onClick={save}
          disabled={saving}
          className="bg-ink text-bg text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Observed on
          </span>
          <input
            type="date"
            value={form.observed_on}
            onChange={(e) => setForm({ ...form, observed_on: e.target.value })}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Note (required)
          </span>
          <textarea
            rows={4}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
          />
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Skill progress
            </span>
            <textarea
              rows={3}
              value={form.skill_progress}
              onChange={(e) => setForm({ ...form, skill_progress: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Areas for improvement
            </span>
            <textarea
              rows={3}
              value={form.areas_for_improvement}
              onChange={(e) => setForm({ ...form, areas_for_improvement: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Next steps
            </span>
            <textarea
              rows={3}
              value={form.next_steps}
              onChange={(e) => setForm({ ...form, next_steps: e.target.value })}
              className="mt-1 w-full text-sm border border-border rounded-md px-2 py-1.5"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Compliance report download button
// ============================================================================
export function ComplianceReportButton({ assignmentId }: { assignmentId: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const r = await api.get(
        `/training/assignments/${assignmentId}/compliance-report?format=csv`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training-compliance-${assignmentId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to download report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="border border-border text-ink text-sm px-3 py-1.5 rounded-lg hover:bg-hover disabled:opacity-50"
    >
      {busy ? 'Building…' : '⤓ Compliance report (CSV)'}
    </button>
  );
}
