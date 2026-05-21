export function RequirementRow({
  kind,
  title,
  items,
}: {
  kind: 'must' | 'nice';
  title?: string;
  items: string[];
}): JSX.Element | null {
  if (items.length === 0) return null;

  const heading = title ?? (kind === 'must' ? 'Must have' : 'Nice to have');

  return (
    <div>
      {/* Section title */}
      <p className="text-[12px] font-semibold text-ink-2 mb-1.5">{heading}</p>

      {/* Item list */}
      <ul className="space-y-0">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-[13px] text-ink-2 py-0.5">
            {/* Diamond bullet */}
            {kind === 'must' ? (
              // Filled accent diamond
              <span
                className="mt-1.5 w-[7px] h-[7px] rotate-45 bg-accent shrink-0"
                aria-hidden="true"
              />
            ) : (
              // Outline-only diamond in faint
              <span
                className="mt-1.5 w-[7px] h-[7px] rotate-45 border border-faint bg-transparent shrink-0"
                aria-hidden="true"
              />
            )}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
