import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { AiProgressCard } from '../AiProgressCard';
import { FormInput } from '../FormInput';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { api } from '../../services/api';
import type { JobLite, TailorSession } from './types';

interface Props {
  open: boolean;
  resumeId: string;
  onClose: () => void;
  onCreated: (session: TailorSession) => void;
}

const ALL_SECTIONS = ['Summary', 'Skills', 'Work Experience', 'Projects', 'Certifications'];
const DEFAULT_SECTIONS = ['Summary', 'Skills', 'Work Experience'];

/**
 * "Tailor with AI" launcher: pick a target job, choose which sections the AI may
 * rewrite, then POST a new tailor session. On success the workspace lands in
 * Diff mode on the fresh session.
 */
export function TailorLauncher({ open, resumeId, onClose, onCreated }: Props) {
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<JobLite[] | null>(null);
  const [jobId, setJobId] = useState('');
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [busy, setBusy] = useState(false);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setJobId('');
      setSections(DEFAULT_SECTIONS);
      setBusy(false);
    }
  }, [open]);

  // Debounced job search.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setJobs(null);
    const t = setTimeout(() => {
      api
        .get('/jobs', { params: query.trim() ? { q: query.trim() } : {} })
        .then((r) => !cancelled && setJobs((r.data ?? []).slice(0, 25)))
        .catch(() => !cancelled && setJobs([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  function toggleSection(s: string) {
    setSections((curr) => (curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s]));
  }

  async function generate() {
    if (!jobId) return toast.error('Pick a target job first');
    setBusy(true);
    try {
      const { data } = await api.post(`/resumes/${resumeId}/tailor-sessions`, {
        job_id: jobId,
        sections,
      });
      toast.success('Tailored resume drafted');
      onCreated(data);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'AI tailoring failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AiProgressCard
        open={busy}
        title="Tailoring your resume"
        stages={[
          'Scoring against the job…',
          'Rewriting selected sections…',
          'Re-scoring the draft…',
        ]}
        note="This can take up to a minute."
      />
      <Modal
        open={open}
        onClose={busy ? () => undefined : onClose}
        title="Tailor with AI"
        description="Generate a job-targeted draft you can review change-by-change."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="accent" onClick={generate} loading={busy} disabled={!jobId}>
              {busy ? 'Tailoring…' : '✦ Generate draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <FormInput
              label="Target job"
              placeholder="Search jobs by title or keyword…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {jobs === null && (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              )}
              {jobs && jobs.length === 0 && (
                <EmptyState compact title="No jobs found" description="Try a different search." />
              )}
              {jobs?.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setJobId(j.id)}
                  className={clsx(
                    'w-full text-left px-3 py-2 transition flex items-center justify-between gap-2',
                    j.id === jobId ? 'bg-accent-soft' : 'hover:bg-hover',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{j.title}</span>
                    <span className="block text-xs text-muted truncate">
                      {j.company_name ?? 'Unknown company'}
                    </span>
                  </span>
                  {j.id === jobId && <span className="text-accent text-xs shrink-0">✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-1.5">
              Sections the AI may rewrite
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_SECTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSection(s)}
                  className={clsx(
                    'text-xs font-medium border rounded-full px-3 py-1 transition',
                    sections.includes(s)
                      ? 'bg-ink text-bg border-ink'
                      : 'bg-surface text-ink border-border hover:bg-hover',
                  )}
                >
                  {sections.includes(s) ? '✓ ' : ''}
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
