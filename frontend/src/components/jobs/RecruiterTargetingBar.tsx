import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { api } from '../../services/api';
import type { ApplyTarget, ConsultantOption, ResumeOption } from './types';

export function RecruiterTargetingBar({
  value,
  onChange,
}: {
  value: ApplyTarget | null;
  onChange: (next: ApplyTarget | null) => void;
}) {
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);

  useEffect(() => {
    api
      .get('/consultants', { params: {} })
      .then((r) => setConsultants(r.data ?? []))
      .catch(() => {
        /* silent */
      });
  }, []);

  useEffect(() => {
    if (!value?.consultantId) {
      setResumes([]);
      return;
    }
    api
      .get(`/resumes/consultant/${value.consultantId}`)
      .then((r) => {
        const list = (r.data ?? []) as ResumeOption[];
        setResumes(list);
        // Auto-pick current resume if none chosen yet.
        if (!value.resumeId) {
          const current = list.find((x) => x.is_current) ?? list[0];
          if (current) onChange({ ...value, resumeId: current.id });
        }
      })
      .catch(() => {
        setResumes([]);
      });
    // eslint-disable-next-line
  }, [value?.consultantId]);

  function pickConsultant(c: ConsultantOption | null) {
    if (!c) {
      onChange(null);
      return;
    }
    const skills =
      Array.isArray(c.skills) && c.skills.length > 0
        ? c.skills
        : c.primary_skill
          ? c.primary_skill
              .split(/[,;|/]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
    onChange({
      consultantId: c.id,
      consultantName: c.user?.full_name ?? c.user?.email ?? 'Consultant',
      resumeId: null,
      skills,
    });
  }
  function pickResume(rid: string) {
    if (!value) return;
    onChange({ ...value, resumeId: rid });
  }

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-3 flex items-center gap-3 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-brand-700 uppercase">
        Apply on behalf of
      </span>
      <select
        value={value?.consultantId ?? ''}
        onChange={(e) => {
          const c = consultants.find((x) => x.id === e.target.value) ?? null;
          pickConsultant(c);
        }}
        className="text-sm bg-surface border border-border rounded-md px-2 py-1 min-w-[200px]"
      >
        <option value="">— Select consultant —</option>
        {consultants.map((c) => (
          <option key={c.id} value={c.id}>
            {c.user?.full_name ?? c.user?.email ?? 'Unnamed'}
          </option>
        ))}
      </select>

      {value && (
        <>
          <select
            value={value.resumeId ?? ''}
            onChange={(e) => pickResume(e.target.value)}
            className="text-sm bg-surface border border-border rounded-md px-2 py-1 min-w-[180px]"
          >
            <option value="">— Select resume —</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.version} · {r.file_name}
                {r.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {value.skills.length} skill{value.skills.length === 1 ? '' : 's'} on file
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => pickConsultant(null)}
            className="ml-auto"
          >
            Clear ×
          </Button>
        </>
      )}
    </div>
  );
}
