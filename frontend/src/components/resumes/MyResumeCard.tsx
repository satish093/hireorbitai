import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { Button } from '../Button';
import toast from 'react-hot-toast';

/**
 * Consultant self-service resume panel. A consultant who has finished
 * onboarding (has a consultant row) can upload their own resume, see their
 * version history, switch the current version, download, and delete. The
 * backend scopes every call to the caller's own consultant row, so this never
 * exposes another consultant's resumes.
 *
 * Accepts PDF, Word (.doc/.docx), and image resumes — matching the backend
 * uploadResume filter.
 */

interface ResumeVersion {
  id: string;
  version?: number | null;
  file_name?: string | null;
  is_current?: boolean | null;
  ai_score?: number | null;
  created_at?: string | null;
}

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
const MAX_BYTES = 10 * 1024 * 1024;

export function MyResumeCard({ consultantId }: { consultantId: string }) {
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    api
      .get(`/resumes/consultant/${consultantId}`)
      .then((r) => setVersions(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load resumes'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (consultantId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('File is larger than 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('consultant_id', consultantId);
      await api.post('/resumes/upload', form);
      toast.success('Resume uploaded');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function download(id: string) {
    try {
      const r = await api.get(`/resumes/${id}/download-url`);
      if (r.data?.url) window.open(r.data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to get download link');
    }
  }

  async function setCurrent(id: string) {
    setBusyId(id);
    try {
      await api.post(`/resumes/${id}/set-current`);
      toast.success('Set as current resume');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this resume version?')) return;
    setBusyId(id);
    try {
      await api.delete(`/resumes/${id}`);
      toast.success('Resume deleted');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to delete');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">My resume</h2>
          <p className="text-xs text-muted">PDF, Word (.doc/.docx), or image — up to 10 MB.</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={onFile}
          className="hidden"
          aria-label="Upload resume"
        />
        <Button
          size="sm"
          onClick={() => fileRef.current?.click()}
          loading={uploading}
          disabled={uploading}
        >
          {uploading ? 'Uploading' : 'Upload resume'}
        </Button>
      </div>

      {loading ? (
        <div className="skeleton h-16 rounded-lg" />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted">
          No resume uploaded yet. Upload one so recruiters can submit you to roles.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink truncate">
                    {v.file_name ?? `Version ${v.version ?? '?'}`}
                  </span>
                  {v.is_current && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted">
                  {v.version ? `v${v.version}` : ''}
                  {v.created_at ? ` · ${new Date(v.created_at).toLocaleDateString()}` : ''}
                  {typeof v.ai_score === 'number' ? ` · ATS ${v.ai_score}` : ''}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => download(v.id)}>
                Download
              </Button>
              {!v.is_current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCurrent(v.id)}
                  disabled={busyId === v.id}
                  loading={busyId === v.id}
                >
                  Make current
                </Button>
              )}
              <Button
                size="sm"
                variant="danger-ghost"
                onClick={() => remove(v.id)}
                disabled={busyId === v.id}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
