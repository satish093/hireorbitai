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
    <h3 className="text-[11px] font-semibold tracking-widest text-muted uppercase mb-2">
      {children}
    </h3>
  );
}

function ExperienceEntry({ exp }: { exp: ResumeExperience }) {
  const dateRange = [exp.start_date, exp.is_current ? 'Present' : exp.end_date]
    .filter(Boolean)
    .join(' – ');
  return (
    <div className="relative pl-4 before:absolute before:left-0 before:top-2 before:w-2 before:h-2 before:rounded-full before:bg-border-strong before:border-2 before:border-surface">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-ink">{exp.title}</span>
        <span className="text-xs text-muted">@ {exp.company}</span>
        {dateRange && <span className="text-xs text-muted ml-auto">{dateRange}</span>}
      </div>
      {exp.description && (
        <p className="mt-1 text-xs text-ink-2 leading-relaxed whitespace-pre-line">
          {exp.description}
        </p>
      )}
    </div>
  );
}

function EducationEntry({ edu }: { edu: ResumeEducation }) {
  const degree = [edu.degree, edu.field].filter(Boolean).join(', ');
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-sm font-medium text-ink">{edu.institution}</div>
        {degree && <div className="text-xs text-muted">{degree}</div>}
      </div>
      {edu.graduation_year && (
        <span className="text-xs font-mono text-muted shrink-0">{edu.graduation_year}</span>
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

  const SKILL_LIMIT = 30;
  const skills = profile.skills ?? [];
  const visibleSkills = showAllSkills ? skills : skills.slice(0, SKILL_LIMIT);
  const hiddenCount = skills.length - SKILL_LIMIT;

  return (
    <div className="space-y-5 text-sm overflow-y-auto max-h-[calc(100vh-260px)] pr-1">
      {/* Contact header */}
      <div>
        {profile.name && <h2 className="text-xl font-semibold text-ink mb-2">{profile.name}</h2>}
        <div className="flex flex-wrap gap-1.5">
          {profile.email && (
            <ContactChip icon="✉" value={profile.email} href={`mailto:${profile.email}`} />
          )}
          {profile.phone && <ContactChip icon="📞" value={profile.phone} />}
          {profile.location && <ContactChip icon="📍" value={profile.location} />}
          {profile.linkedin_url && (
            <ContactChip icon="🔗" value="LinkedIn" href={profile.linkedin_url} />
          )}
          {profile.website && (
            <ContactChip icon="🌐" value={profile.website} href={profile.website} />
          )}
          {profile.total_years_experience != null && (
            <ContactChip icon="⏱" value={`${profile.total_years_experience} yrs exp`} />
          )}
        </div>
      </div>

      {/* Summary */}
      {profile.summary && (
        <div>
          <SectionHeading>Summary</SectionHeading>
          <p className="text-xs text-ink-2 leading-relaxed bg-bg-sunken rounded-lg px-3 py-2.5">
            {profile.summary}
          </p>
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div>
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
        <div>
          <SectionHeading>Experience</SectionHeading>
          <div className="space-y-4 border-l-2 border-border ml-1 pl-3">
            {profile.experiences.map((exp, i) => (
              <ExperienceEntry key={i} exp={exp} />
            ))}
          </div>
        </div>
      )}

      {/* Education */}
      {profile.education.length > 0 && (
        <div>
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
        <div>
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
        <div>
          <SectionHeading>Languages</SectionHeading>
          <p className="text-xs text-ink-2">{profile.languages.join(', ')}</p>
        </div>
      )}

      {/* Re-parse button */}
      <div className="pt-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={parseNow} loading={parsing}>
          ↻ Re-extract profile
        </Button>
      </div>
    </div>
  );
}
