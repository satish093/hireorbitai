import { ReactNode } from 'react';

// Small presentational building blocks shared by JobDetailView and
// JobDescriptionSections. Split out so the description-formatting component
// doesn't have to import from the (much larger) detail-view file.

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm min-w-0">
      {title && (
        <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2.5">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border first:pt-0 last:border-0 last:pb-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted shrink-0">
        {label}
      </span>
      <span className="text-sm font-medium text-ink text-right min-w-0 break-words" title={value}>
        {value}
      </span>
    </div>
  );
}

export function Bullets({
  items,
  marker = '•',
  tone = 'text-muted',
}: {
  items: string[];
  marker?: string;
  tone?: string;
}) {
  return (
    <ul className="space-y-1 text-sm text-ink">
      {items.map((b, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className={tone}>{marker}</span>
          <span className="min-w-0 break-words">{b}</span>
        </li>
      ))}
    </ul>
  );
}
