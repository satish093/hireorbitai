import { Fragment, type ReactNode } from 'react';

/** Render inline **bold** and *italic* spans within a line. */
export function renderInline(text: string): ReactNode[] {
  // Split on **bold** and *italic* markers.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold)
      return (
        <strong key={i} className="font-semibold">
          {bold[1]}
        </strong>
      );
    const italic = p.match(/^\*([^*]+)\*$/);
    if (italic)
      return (
        <em key={i} className="italic">
          {italic[1]}
        </em>
      );
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/**
 * Minimal markdown → React renderer styled to look like a polished resume.
 *
 * Uses fixed Tailwind colors (slate-*) rather than CSS-variable tokens so the
 * output stays legible on the always-white paper regardless of the app theme.
 *
 * Supported syntax:
 *   #   Name header  — centered, large, prominent
 *   ##  Section      — small-caps + full-width rule (EXPERIENCE, EDUCATION …)
 *   ### Role/Company — bold label for a job or degree entry
 *   -/* Bullets      — tight list
 *   ---  / ___       — horizontal divider (contact line separator etc.)
 *   **bold**  *italic*  inline
 */
export function MarkdownView({ md, className }: { md: string; className?: string }) {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = [...bullets];
    bullets = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc pl-4 space-y-0.5 my-1.5 marker:text-slate-400">
        {items.map((b, i) => (
          <li key={i} className="leading-[1.55]">
            {renderInline(b)}
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    const hr = /^(-{3,}|_{3,}|\*{3,})\s*$/.test(line);

    if (heading) {
      flushBullets();
      const level = heading[1].length;
      const text = heading[2];

      if (level === 1) {
        // Candidate name — large, centered, prominent.
        blocks.push(
          <h1
            key={`h-${key++}`}
            className="text-[22px] font-bold tracking-tight text-center text-slate-900 leading-tight mt-0 mb-1"
          >
            {renderInline(text)}
          </h1>,
        );
      } else if (level === 2) {
        // Section header — e.g. EXPERIENCE, EDUCATION, SKILLS.
        blocks.push(
          <h2
            key={`h-${key++}`}
            className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-500 mt-5 mb-2 pb-1 border-b-2 border-slate-200"
          >
            {renderInline(text)}
          </h2>,
        );
      } else {
        // Role / company / degree title.
        blocks.push(
          <h3
            key={`h-${key++}`}
            className="text-[12.5px] font-semibold text-slate-900 mt-3 mb-0.5 leading-snug"
          >
            {renderInline(text)}
          </h3>,
        );
      }
    } else if (hr) {
      flushBullets();
      blocks.push(<hr key={`hr-${key++}`} className="border-t border-slate-200 my-2" />);
    } else if (bullet) {
      bullets.push(bullet[1]);
    } else if (line.trim() === '') {
      flushBullets();
      // Blank line between blocks — small gap already handled by margins.
    } else {
      flushBullets();
      blocks.push(
        <p key={`p-${key++}`} className="text-[12.5px] text-slate-700 leading-[1.6] my-1">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushBullets();

  return <div className={className}>{blocks}</div>;
}
