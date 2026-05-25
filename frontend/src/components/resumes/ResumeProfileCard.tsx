import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { api } from '../../services/api';
import type { ResumeProfile } from './types';

interface Props {
  profile: ResumeProfile | null | undefined;
  resumeId: string;
  onParsed: () => void;
}

/** Deterministic accent color from a name string. */
function nameColor(name: string | null): string {
  const palette = [
    'bg-blue-500',
    'bg-violet-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-cyan-500',
    'bg-indigo-500',
    'bg-pink-500',
  ];
  if (!name) return palette[0];
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return palette[idx];
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted mb-3">{children}</h3>
  );
}

export function ResumeProfileCard({ profile: initialProfile, resumeId, onParsed }: Props) {
  const [profile, setProfile] = useState<ResumeProfile | null | undefined>(initialProfile);
  const [parsing, setParsing] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);

  async function parseNow() {
    setParsing(true);
    try {
      const { data } = await api.post(`/resumes/${resumeId}/parse-profile`);
      setProfile(data);
      onParsed();
      toast.success('Profile extracted');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Profile extraction failed');
    } finally {
      setParsing(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-sunken flex items-center justify-center text-2xl text-muted">
          ?
        </div>
        <div>
          <p className="text-sm font-medium text-ink">No profile extracted yet</p>
          <p className="text-xs text-muted mt-1 max-w-xs">
            AI will parse name, contact, skills, experience, and education from the resume.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={parseNow} loading={parsing}>
          {parsing ? 'Extracting…' : 'Extract profile'}
        </Button>
      </div>
    );
  }

  const skills = profile.skills ?? [];
  const SKILL_LIMIT = 20;
  const visibleSkills = showAllSkills ? skills : skills.slice(0, SKILL_LIMIT);

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-260px)] pr-1 space-y-6">
      {/* ── Hero: avatar + name + contact ── */}
      <div className="flex gap-4 items-start">
        <div
          className={`w-14 h-14 rounded-full shrink-0 flex items-center justify-center text-lg font-bold text-white ${nameColor(profile.name)}`}
        >
          {initials(profile.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-ink leading-tight truncate">
            {profile.name ?? 'Unknown'}
          </h2>
          {profile.location && (
            <p className="text-xs text-muted mt-0.5 flex items-center gap-1">
              <svg
                className="w-3 h-3 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21c-4.418 0-8-4.03-8-9a8 8 0 1116 0c0 4.97-3.582 9-8 9z"
                />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {profile.location}
            </p>
          )}

          {/* Contact chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="inline-flex items-center gap-1 text-[11px] bg-sunken hover:bg-border text-ink-2 px-2 py-0.5 rounded-full transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                {profile.email}
              </a>
            )}
            {profile.phone && (
              <span className="inline-flex items-center gap-1 text-[11px] bg-sunken text-ink-2 px-2 py-0.5 rounded-full">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 5a2 2 0 012-2h3l2 4-2.5 1.5a11 11 0 005 5L14 11l4 2v3a2 2 0 01-2 2A16 16 0 013 5z"
                  />
                </svg>
                {profile.phone}
              </span>
            )}
            {profile.linkedin_url && (
              <a
                href={profile.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] bg-sunken hover:bg-border text-accent px-2 py-0.5 rounded-full transition-colors"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                LinkedIn
              </a>
            )}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] bg-sunken hover:bg-border text-accent px-2 py-0.5 rounded-full transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                Website
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      {(profile.total_years_experience != null ||
        profile.age != null ||
        profile.languages.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {profile.total_years_experience != null && (
            <div className="bg-sunken rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-ink tabular-nums">
                {profile.total_years_experience}
              </div>
              <div className="text-[10px] text-muted uppercase tracking-wide">Yrs exp.</div>
            </div>
          )}
          {skills.length > 0 && (
            <div className="bg-sunken rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-ink tabular-nums">{skills.length}</div>
              <div className="text-[10px] text-muted uppercase tracking-wide">Skills</div>
            </div>
          )}
          {profile.experiences.length > 0 && (
            <div className="bg-sunken rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-ink tabular-nums">
                {profile.experiences.length}
              </div>
              <div className="text-[10px] text-muted uppercase tracking-wide">Roles</div>
            </div>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {profile.summary && (
        <div>
          <SectionHead>Summary</SectionHead>
          <p className="text-sm text-ink-2 leading-relaxed">{profile.summary}</p>
        </div>
      )}

      {/* ── Skills ── */}
      {skills.length > 0 && (
        <div>
          <SectionHead>Skills · {skills.length}</SectionHead>
          <div className="flex flex-wrap gap-1.5">
            {visibleSkills.map((s) => (
              <span
                key={s}
                className="text-xs bg-accent-soft text-accent px-2.5 py-0.5 rounded-full font-medium"
              >
                {s}
              </span>
            ))}
            {!showAllSkills && skills.length > SKILL_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAllSkills(true)}
                className="text-xs text-muted hover:text-ink border border-border px-2.5 py-0.5 rounded-full"
              >
                +{skills.length - SKILL_LIMIT} more
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Experience (timeline) ── */}
      {profile.experiences.length > 0 && (
        <div>
          <SectionHead>Experience</SectionHead>
          <div className="space-y-4">
            {profile.experiences.map((exp, i) => (
              <div key={i} className="flex gap-3">
                {/* timeline dot + line */}
                <div className="flex flex-col items-center pt-1">
                  <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                  {i < profile.experiences.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1.5" />
                  )}
                </div>
                <div className="pb-4 min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-ink leading-snug">{exp.title}</span>
                    <span className="text-[11px] text-muted font-mono shrink-0 mt-0.5">
                      {[exp.start_date, exp.is_current ? 'Present' : exp.end_date]
                        .filter(Boolean)
                        .join(' – ')}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">{exp.company}</div>
                  {exp.description && (
                    <p className="text-xs text-ink-2 mt-1.5 leading-relaxed whitespace-pre-line">
                      {exp.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Education ── */}
      {profile.education.length > 0 && (
        <div>
          <SectionHead>Education</SectionHead>
          <div className="space-y-3">
            {profile.education.map((edu, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-lg bg-sunken flex items-center justify-center shrink-0">
                  <svg
                    className="w-4 h-4 text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink leading-snug">
                    {[edu.degree, edu.field].filter(Boolean).join(' in ') || 'Degree'}
                  </div>
                  <div className="text-xs text-muted mt-0.5">{edu.institution}</div>
                </div>
                {edu.graduation_year != null && (
                  <span className="text-[11px] font-mono text-muted bg-sunken px-1.5 py-0.5 rounded shrink-0">
                    {edu.graduation_year}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Certifications ── */}
      {profile.certifications.length > 0 && (
        <div>
          <SectionHead>Certifications</SectionHead>
          <div className="flex flex-wrap gap-1.5">
            {profile.certifications.map((c, i) => (
              <span
                key={i}
                className="text-xs border border-border text-ink-2 px-2.5 py-0.5 rounded-full"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Languages ── */}
      {profile.languages.length > 0 && (
        <div>
          <SectionHead>Languages</SectionHead>
          <div className="flex flex-wrap gap-1.5">
            {profile.languages.map((l, i) => (
              <span key={i} className="text-xs bg-sunken text-ink-2 px-2.5 py-0.5 rounded-full">
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Re-extract ── */}
      <div className="pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={parseNow} loading={parsing}>
          ↻ Re-extract profile
        </Button>
      </div>
    </div>
  );
}
