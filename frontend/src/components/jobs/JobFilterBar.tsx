import { Button } from '../Button';
import { Popover } from '../ui/Popover';
import { PillSelect } from './PillSelect';

export interface JobFilterState {
  location: string;
  remote: '' | 'true' | 'false';
  postedAfter: string;
  yearsMin: string;
  jobFunction: string;
  publisher: string;
  source: string;
}

// ── option arrays ──────────────────────────────────────────────────────────────

const LOCATION_OPTIONS = [
  { value: 'United States', label: 'United States' },
  { value: 'Remote', label: 'Remote' },
  { value: 'New York', label: 'New York' },
  { value: 'San Francisco', label: 'San Francisco' },
  { value: 'Seattle', label: 'Seattle' },
  { value: 'Austin', label: 'Austin' },
  { value: 'Los Angeles', label: 'Los Angeles' },
  { value: 'Boston', label: 'Boston' },
  { value: 'Chicago', label: 'Chicago' },
  { value: 'London', label: 'London' },
  { value: 'Europe', label: 'Europe' },
];

const REMOTE_OPTIONS: { value: '' | 'true' | 'false'; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Remote' },
  { value: 'false', label: 'Onsite' },
];

const POSTED_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Past 24 hours' },
  { value: '7', label: 'Past week' },
  { value: '30', label: 'Past month' },
];

const YEARS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '0', label: 'Entry (0+)' },
  { value: '3', label: 'Mid (3+)' },
  { value: '5', label: 'Senior (5+)' },
  { value: '8', label: 'Lead (8+)' },
];

const JOB_FUNCTION_OPTIONS = [
  { value: '', label: 'Any role' },
  { value: 'Software Engineer', label: 'Software Engineer' },
  { value: 'Data Engineer', label: 'Data Engineer' },
  { value: 'Data Scientist', label: 'Data Scientist' },
  { value: 'DevOps / SRE', label: 'DevOps / SRE' },
  { value: 'Frontend Engineer', label: 'Frontend Engineer' },
  { value: 'Backend Engineer', label: 'Backend Engineer' },
  { value: 'Full Stack Engineer', label: 'Full Stack' },
  { value: 'Product Manager', label: 'Product Manager' },
  { value: 'Business Analyst', label: 'Business Analyst' },
];

const PUBLISHER_OPTIONS = [
  { value: '', label: 'All boards' },
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Dice', label: 'Dice' },
  { value: 'Indeed', label: 'Indeed' },
  { value: 'Glassdoor', label: 'Glassdoor' },
  { value: 'ZipRecruiter', label: 'ZipRecruiter' },
];

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'remoteok', label: 'RemoteOK' },
  { value: 'adzuna', label: 'Adzuna' },
  { value: 'jsearch', label: 'JSearch' },
  { value: 'linkedin', label: 'LinkedIn (API)' },
  { value: 'manual', label: 'Manual import' },
];

// ── human-readable chip labels ──────────────────────────────────────────────

function remoteLabel(v: string): string {
  if (v === 'true') return 'Remote';
  if (v === 'false') return 'Onsite';
  return v;
}

function postedLabel(v: string): string {
  if (v === '1') return 'Past 24h';
  if (v === '7') return 'Past week';
  if (v === '30') return 'Past month';
  return v;
}

// ── active chips ────────────────────────────────────────────────────────────

type FilterKey = keyof JobFilterState;

interface ActiveChip {
  key: FilterKey;
  label: string;
}

function getActiveChips(value: JobFilterState): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (value.location) chips.push({ key: 'location', label: value.location });
  if (value.remote) chips.push({ key: 'remote', label: remoteLabel(value.remote) });
  if (value.postedAfter) chips.push({ key: 'postedAfter', label: postedLabel(value.postedAfter) });
  if (value.yearsMin) chips.push({ key: 'yearsMin', label: `${value.yearsMin}+ yrs` });
  if (value.jobFunction) chips.push({ key: 'jobFunction', label: value.jobFunction });
  if (value.publisher) chips.push({ key: 'publisher', label: value.publisher });
  if (value.source) chips.push({ key: 'source', label: value.source });
  return chips;
}

// ── component ───────────────────────────────────────────────────────────────

export function JobFilterBar({
  value,
  onChange,
  onApply,
  onReset,
}: {
  value: JobFilterState;
  onChange: (patch: Partial<JobFilterState>) => void;
  onApply: () => void;
  onReset: () => void;
}): JSX.Element {
  const chips = getActiveChips(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Active filter chips */}
      {chips.map(({ key, label }) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent border border-accent/40 pl-2.5 pr-1 py-0.5 text-[12px] font-medium"
        >
          {label}
          <button
            type="button"
            aria-label={`Remove ${label} filter`}
            onClick={() => onChange({ [key]: '' } as Partial<JobFilterState>)}
            className="ml-0.5 w-4 h-4 grid place-items-center rounded-full hover:bg-surface"
          >
            ×
          </button>
        </span>
      ))}

      {/* "+ Add" popover */}
      <Popover
        align="left"
        button={() => (
          <Button variant="ghost" size="sm" pill>
            + Add
          </Button>
        )}
        panelClassName="min-w-[260px] space-y-2"
      >
        {(close) => (
          <>
            <PillSelect
              label="Location"
              placeholder="Pick a location"
              value={value.location}
              onChange={(v) => onChange({ location: v })}
              options={LOCATION_OPTIONS}
            />
            <PillSelect
              label="Onsite"
              value={value.remote}
              onChange={(v) => onChange({ remote: v as JobFilterState['remote'] })}
              options={REMOTE_OPTIONS as { value: string; label: string }[]}
            />
            <PillSelect
              label="Posted"
              value={value.postedAfter}
              onChange={(v) => onChange({ postedAfter: v })}
              options={POSTED_OPTIONS}
            />
            <PillSelect
              label="Years"
              value={value.yearsMin}
              onChange={(v) => onChange({ yearsMin: v })}
              options={YEARS_OPTIONS}
            />
            <PillSelect
              label="Job function"
              value={value.jobFunction}
              onChange={(v) => onChange({ jobFunction: v })}
              options={JOB_FUNCTION_OPTIONS}
            />
            <PillSelect
              label="Job board"
              value={value.publisher}
              onChange={(v) => onChange({ publisher: v })}
              options={PUBLISHER_OPTIONS}
            />
            <PillSelect
              label="Source"
              value={value.source}
              onChange={(v) => onChange({ source: v })}
              options={SOURCE_OPTIONS}
            />

            {/* Footer actions */}
            <div className="flex items-center justify-between pt-1 border-t border-border">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onReset();
                  close();
                }}
              >
                Reset
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onApply();
                  close();
                }}
              >
                Apply
              </Button>
            </div>
          </>
        )}
      </Popover>
    </div>
  );
}
