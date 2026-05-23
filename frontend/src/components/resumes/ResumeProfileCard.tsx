import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { api } from '../../services/api';
import type { ResumeProfile, ResumeExperience, ResumeEducation } from './types';

interface Props {
  profile: ResumeProfile | null | undefined;
  resumeId: string;
  onParsed: () => void;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function ContactChip({ icon, value, href }: { icon: string; value: string; href?: string }) {
  const cls =
    'inline-flex items-center gap-1.5 text-xs bg-bg-sunken px-2.5 py-1 rounded-full text-ink-2 hover:text-ink transition';
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      <span>{icon}</span>
      <span className="truncate max-w-[200px]">{value}</span>
    </a>
  ) : (
    <span className={cls}>
      <span>{icon}</span>
      <span className="truncate max-w-[200px]">{value}</span>
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-widest text-muted uppercase mb-2.5">
      {children}
    </h3>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-bg-sunken border border-border text-center min-w-[72px]">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink mt-0.5">{value}</span>
    </div>
  );
}

function ExperienceEntry({ exp }: { exp: ResumeExperience }) {
  const dateRange = [exp.start_date, exp.is_current ? 'Present' : exp.end_date]
    .filter(Boolean)
    .join(' – ');
  return (
    <div className="rounded-lg border border-border bg-bg-sunken p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{exp.title}</span>
        {dateRange && <span className="text-xs text-muted shrink-0 font-mono">{dateRange}</span>}
      </div>
      <div className="text-xs text-ink-2 mt-0.5">{exp.company}</div>
      {exp.description && (
        <p className="mt-1.5 text-xs text-ink-2 leading-relaxed whitespace-pre-line">
          {exp.description}
        </p>
      )}
    </div>
  );
}

function EducationEntry({ edu }: { edu: ResumeEducation }) {
  const degree = [edu.degree, edu.field].filter(Boolean).join(', ');
  return (
    <div className="rounded-lg border border-border bg-bg-sunken px-3 py-2.5 flex items-start justify-between gap-2">
      <div>
        {degree && <div className="text-sm font-medium text-ink">{degree}</div>}
        <div className={degree ? 'text-xs text-muted mt-0.5' : 'text-sm font-medium text-ink'}>
          {edu.institution}
        </div>
      </div>
      {edu.graduation_year && (
        <span className="text-xs font-mono text-muted shrink-0 bg-surface border border-border px-1.5 py-0.5 rounded">
          {edu.graduation_year}
        </span>
      )}
    </div>
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
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
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
    );
  }

  const SKILL_LIMIT = 12;
  const skills = profile.skills ?? [];
  const visibleSkills = showAllSkills ? skills : skills.slice(0, SKILL_LIMIT);
  const hiddenCount = skills.length - SKILL_LIMIT;

  const contactLine = [profile.email, profile.phone, profile.location].filter(Boolean).join(' · ');

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-260px)] pr-1">
      {/* Header — initials avatar + name + contact */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-accent-soft flex items-center justify-center text-base font-bold text-ink-2 shrink-0 select-none">
          {getInitials(profile.name)}
        </div>
        <div className="min-w-0 flex-1">
          {profile.name && (
            <h2 className="text-2xl font-bold text-ink leading-tight">{profile.name}</h2>
          )}
          {contactLine && <p className="text-xs text-muted mt-0.5 truncate">{contactLine}</p>}
          {(profile.linkedin_url || profile.website) && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {profile.linkedin_url && (
                <ContactChip icon="🔗" value="LinkedIn" href={profile.linkedin_url} />
              )}
              {profile.website && (
                <ContactChip icon="🌐" value={profile.website} href={profile.website} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {(profile.age != null || profile.total_years_experience != null || profile.location) && (
        <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t border-border">
          {profile.age != null && <StatCard label="Age" value={String(profile.age)} />}
          {profile.total_years_experience != null && (
            <StatCard label="Experience" value={`${profile.total_years_experience} yrs`} />
          )}
          {profile.location && <StatCard label="Location" value={profile.location} />}
        </div>
      )}

      {/* Summary */}
      {profile.summary && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Summary</SectionHeading>
          <p className="text-xs text-ink-2 leading-relaxed bg-bg-sunken rounded-lg px-3 py-2.5">
            {profile.summary}
          </p>
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Skills</SectionHeading>
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
        </div>
      )}

      {/* Experience */}
      {profile.experiences.length > 0 && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Experience</SectionHeading>
          <div className="space-y-2">
            {profile.experiences.map((exp, i) => (
              <ExperienceEntry key={i} exp={exp} />
            ))}
          </div>
        </div>
      )}

      {/* Education */}
      {profile.education.length > 0 && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Education</SectionHeading>
          <div className="space-y-2">
            {profile.education.map((edu, i) => (
              <EducationEntry key={i} edu={edu} />
            ))}
          </div>
        </div>
      )}

      {/* Certifications */}
      {profile.certifications.length > 0 && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Certifications</SectionHeading>
          <ul className="space-y-0.5">
            {profile.certifications.map((c, i) => (
              <li key={i} className="text-xs text-ink-2 flex gap-2">
                <span className="text-muted">•</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Languages */}
      {profile.languages.length > 0 && (
        <div className="pt-4 mt-4 border-t border-border">
          <SectionHeading>Languages</SectionHeading>
          <p className="text-xs text-ink-2">{profile.languages.join(' · ')}</p>
        </div>
      )}

      {/* Re-parse button */}
      <div className="pt-4 mt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={parseNow} loading={parsing}>
          ↻ Re-extract profile
        </Button>
      </div>
    </div>
  );
}
