import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { AiProgressCard } from '../AiProgressCard';
import { api } from '../../services/api';
import type { ResumeProfile } from './types';

interface Props {
  profile: ResumeProfile | null | undefined;
  resumeId: string;
  onParsed: () => void;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-widest text-muted pt-5 mt-5 border-t border-border mb-3">
      {children}
    </h3>
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

  const parseOverlay = (
    <AiProgressCard
      open={parsing}
      title="Extracting profile"
      stages={[
        'Reading resume text…',
        'Identifying skills & experience…',
        'Structuring the profile…',
      ]}
    />
  );

  if (!profile) {
    return (
      <>
        {parseOverlay}
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="text-4xl">🪪</div>
          <div>
            <p className="text-sm font-medium text-ink">No profile extracted yet</p>
            <p className="text-xs text-muted mt-1">
              AI will parse name, contact, skills, experience, and education from the resume text.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={parseNow} loading={parsing}>
            {parsing ? 'Extracting…' : 'Extract profile'}
          </Button>
        </div>
      </>
    );
  }

  const SKILL_LIMIT = 15;
  const skills = profile.skills ?? [];
  const visibleSkills = showAllSkills ? skills : skills.slice(0, SKILL_LIMIT);
  const hiddenCount = skills.length - SKILL_LIMIT;

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-260px)] pr-1">
      {parseOverlay}
      {/* ── Header: name + contact ── */}
      <div className="pb-4 border-b border-border">
        <h2 className="text-2xl font-bold text-ink leading-tight">{profile.name ?? 'Unknown'}</h2>
        <p className="text-sm text-muted mt-1 flex flex-wrap gap-x-1 items-center">
          {[profile.email, profile.phone].filter(Boolean).map((v, i, arr) => (
            <span key={i}>
              {v}
              {i < arr.length - 1 && <span className="mx-1 opacity-30">·</span>}
            </span>
          ))}
          {profile.linkedin_url && (
            <>
              <span className="mx-1 opacity-30">·</span>
              <a
                href={profile.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                LinkedIn ↗
              </a>
            </>
          )}
          {profile.website && (
            <>
              <span className="mx-1 opacity-30">·</span>
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Website ↗
              </a>
            </>
          )}
        </p>
      </div>

      {/* ── Stats row ── */}
      {(profile.age != null || profile.total_years_experience != null || profile.location) && (
        <div className="flex flex-wrap gap-6 py-3 border-b border-border">
          {profile.age != null && (
            <span>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-muted mr-1.5">
                Age
              </span>
              <span className="text-sm font-medium text-ink">{profile.age}</span>
            </span>
          )}
          {profile.total_years_experience != null && (
            <span>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-muted mr-1.5">
                Experience
              </span>
              <span className="text-sm font-medium text-ink">
                {profile.total_years_experience} yrs
              </span>
            </span>
          )}
          {profile.location && (
            <span>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-muted mr-1.5">
                Location
              </span>
              <span className="text-sm font-medium text-ink">{profile.location}</span>
            </span>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {profile.summary && (
        <>
          <Heading>Summary</Heading>
          <p className="text-sm text-ink-2 leading-relaxed">{profile.summary}</p>
        </>
      )}

      {/* ── Skills ── */}
      {skills.length > 0 && (
        <>
          <Heading>Skills ({skills.length})</Heading>
          <div className="flex flex-wrap gap-1.5">
            {visibleSkills.map((s) => (
              <span key={s} className="text-xs bg-accent-soft text-ink-2 px-2 py-0.5 rounded-full">
                {s}
              </span>
            ))}
            {!showAllSkills && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllSkills(true)}
                className="text-xs text-muted hover:text-ink underline underline-offset-2"
              >
                +{hiddenCount} more
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Experience ── */}
      {profile.experiences.length > 0 && (
        <>
          <Heading>Experience</Heading>
          <div className="space-y-4">
            {profile.experiences.map((exp, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{exp.title}</span>
                  <span className="text-xs text-muted font-mono shrink-0">
                    {[exp.start_date, exp.is_current ? 'Present' : exp.end_date]
                      .filter(Boolean)
                      .join(' – ')}
                  </span>
                </div>
                <div className="text-xs text-ink-2 mt-0.5">{exp.company}</div>
                {exp.description && (
                  <p className="text-xs text-ink-2 mt-1.5 leading-relaxed">{exp.description}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Education ── */}
      {profile.education.length > 0 && (
        <>
          <Heading>Education</Heading>
          <div className="space-y-3">
            {profile.education.map((edu, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-ink">
                    {[edu.degree, edu.field].filter(Boolean).join(' in ') || 'Degree'}
                  </div>
                  <div className="text-xs text-ink-2">{edu.institution}</div>
                </div>
                {edu.graduation_year != null && (
                  <span className="text-xs font-mono text-muted shrink-0">
                    {edu.graduation_year}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Certifications ── */}
      {profile.certifications.length > 0 && (
        <>
          <Heading>Certifications</Heading>
          <ul className="space-y-1">
            {profile.certifications.map((c, i) => (
              <li key={i} className="text-sm text-ink-2 flex gap-2">
                <span className="text-muted shrink-0">•</span>
                {c}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── Languages ── */}
      {profile.languages.length > 0 && (
        <>
          <Heading>Languages</Heading>
          <p className="text-sm text-ink-2">{profile.languages.join(' · ')}</p>
        </>
      )}

      {/* ── Re-extract ── */}
      <div className="pt-5 mt-5 border-t border-border">
        <Button variant="ghost" size="sm" onClick={parseNow} loading={parsing}>
          ↻ Re-extract profile
        </Button>
      </div>
    </div>
  );
}
