import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { api } from '../../services/api';
import type { ResumeProfile, ResumeExperience } from './types';

interface Props {
  profile: ResumeProfile | null | undefined;
  resumeId: string;
  onParsed: () => void;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-3">
      {children}
    </h3>
  );
}

function InfoField({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | number | null;
  href?: string;
}) {
  if (value == null || value === '') return null;
  const display = String(value);
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-0.5">
        {label}
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent hover:underline break-all"
        >
          {display}
        </a>
      ) : (
        <div className="text-sm text-ink">{display}</div>
      )}
    </div>
  );
}

function expPeriod(exp: ResumeExperience): string {
  return [exp.start_date, exp.is_current ? 'Present' : exp.end_date].filter(Boolean).join(' – ');
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

  const currentExp =
    profile.experiences.find((e) => e.is_current) ?? profile.experiences[0] ?? null;

  const primaryEdu = profile.education[0] ?? null;
  const eduText = profile.education
    .map((e) => {
      const deg = [e.degree, e.field].filter(Boolean).join(' ');
      return deg ? `${deg} from ${e.institution}` : e.institution;
    })
    .join(', ');

  const yrs = profile.total_years_experience;

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-260px)] pr-1 space-y-0">
      {/* ── Contact & Identity ── */}
      <div>
        <SectionHeading>Contact &amp; Identity</SectionHeading>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <InfoField label="Full Name" value={profile.name} />
          <InfoField label="Email" value={profile.email} />
          <InfoField label="Phone" value={profile.phone} />
          <InfoField label="Location" value={profile.location} />
          <InfoField
            label="LinkedIn"
            value={profile.linkedin_url}
            href={profile.linkedin_url ?? undefined}
          />
          {profile.website && (
            <InfoField label="Website" value={profile.website} href={profile.website} />
          )}
          <InfoField label="Current Position" value={currentExp?.title} />
          <InfoField label="Current Company" value={currentExp?.company} />
          <InfoField label="Years of Experience" value={yrs != null ? String(yrs) : null} />
        </div>
      </div>

      {/* ── Work Experience ── */}
      {profile.experiences.length > 0 && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Work Experience</SectionHeading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[540px]">
              <thead className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                <tr>
                  <th className="pb-2 pr-4 text-left font-semibold">Title</th>
                  <th className="pb-2 pr-4 text-left font-semibold">Company</th>
                  <th className="pb-2 pr-4 text-left font-semibold whitespace-nowrap">Period</th>
                  <th className="pb-2 text-left font-semibold">Highlights</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {profile.experiences.map((exp, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2.5 pr-4 font-medium text-ink whitespace-nowrap">
                      {exp.title}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2 text-xs whitespace-nowrap">
                      {exp.company}
                    </td>
                    <td className="py-2.5 pr-4 text-muted text-xs whitespace-nowrap">
                      {expPeriod(exp) || '—'}
                    </td>
                    <td className="py-2.5 text-ink-2 text-xs leading-relaxed">
                      {exp.description ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Education ── */}
      {profile.education.length > 0 && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Education</SectionHeading>
          {eduText && <p className="text-sm text-ink-2 leading-relaxed mb-3">{eduText}</p>}
          {primaryEdu && (
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              <InfoField label="Highest Degree" value={primaryEdu.degree} />
              <InfoField label="University" value={primaryEdu.institution} />
              <InfoField
                label="Graduation Year"
                value={
                  primaryEdu.graduation_year != null ? String(primaryEdu.graduation_year) : null
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {profile.summary && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Summary</SectionHeading>
          <p className="text-xs text-ink-2 leading-relaxed bg-bg-sunken rounded-lg px-3 py-2.5">
            {profile.summary}
          </p>
        </div>
      )}

      {/* ── Skills ── */}
      {skills.length > 0 && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Skills ({skills.length} items)</SectionHeading>
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

      {/* ── Certifications ── */}
      {profile.certifications.length > 0 && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Certifications</SectionHeading>
          <ul className="space-y-1">
            {profile.certifications.map((c, i) => (
              <li key={i} className="text-sm text-ink-2 flex gap-2">
                <span className="text-muted shrink-0">•</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Languages ── */}
      {profile.languages.length > 0 && (
        <div className="pt-5 mt-5 border-t border-border">
          <SectionHeading>Languages</SectionHeading>
          <ul className="space-y-1">
            {profile.languages.map((l, i) => (
              <li key={i} className="text-sm text-ink-2 flex gap-2">
                <span className="text-muted shrink-0">•</span>
                {l}
              </li>
            ))}
          </ul>
        </div>
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
