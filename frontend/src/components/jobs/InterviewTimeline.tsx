import React from 'react';

export interface InterviewStep {
  label: string;
  icon?: React.ReactNode;
}

// Default inline SVG icons for each step index (phone, document, building, star).
function PhoneIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 2a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 .49.39l.5 2.5a.5.5 0 0 1-.28.55L4 5.5a6.5 6.5 0 0 0 3.5 3.5l.61-1.21a.5.5 0 0 1 .55-.28l2.5.5a.5.5 0 0 1 .39.49V10a.5.5 0 0 1-.5.5A8.5 8.5 0 0 1 2 2.5.5.5 0 0 1 2.5 2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2.5" y="1.5" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <line
        x1="4.5"
        y1="4.5"
        x2="8.5"
        y2="4.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <line
        x1="4.5"
        y1="6.5"
        x2="8.5"
        y2="6.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <line
        x1="4.5"
        y1="8.5"
        x2="7"
        y2="8.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="3" width="9" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 11V8h3v3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <line
        x1="4"
        y1="5.5"
        x2="5.2"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="7.8"
        y1="5.5"
        x2="9"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="7.5"
        x2="5.2"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="7.8"
        y1="7.5"
        x2="9"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="6.5"
        y1="1.5"
        x2="6.5"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.5 1.5l1.24 2.51 2.77.4-2 1.95.47 2.76L6.5 7.77 4.02 9.12l.47-2.76-2-1.95 2.77-.4L6.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const DEFAULT_ICONS: React.ReactNode[] = [
  <PhoneIcon />,
  <DocumentIcon />,
  <BuildingIcon />,
  <StarIcon />,
];

const DEFAULT_STEPS: InterviewStep[] = [
  { label: 'Phone screen' },
  { label: 'Take-home' },
  { label: 'Onsite' },
  { label: 'Bar raiser' },
];

export function InterviewTimeline({ steps }: { steps?: InterviewStep[] }): JSX.Element {
  const resolved = steps ?? DEFAULT_STEPS;

  return (
    <div className="flex items-start w-full" role="list" aria-label="Interview stages">
      {resolved.map((step, idx) => {
        const icon = step.icon ?? DEFAULT_ICONS[idx % DEFAULT_ICONS.length];
        const isLast = idx === resolved.length - 1;

        return (
          <React.Fragment key={idx}>
            {/* Step node */}
            <div className="flex flex-col items-center shrink-0" role="listitem">
              {/* Circle */}
              <div className="w-7 h-7 rounded-full grid place-items-center border border-border-strong bg-surface text-muted">
                {icon}
              </div>
              {/* Label */}
              <span className="mt-1.5 text-[11px] text-muted text-center max-w-[64px] leading-tight">
                {step.label}
              </span>
            </div>

            {/* Connector hairline between steps — sits vertically at circle center (14px = half of h-7=28px) */}
            {!isLast && (
              <div className="flex-1 mt-[13px] h-px bg-border shrink" aria-hidden="true" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
