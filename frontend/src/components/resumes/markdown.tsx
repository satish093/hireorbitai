import { Fragment, type ReactNode } from 'react';

/** Render inline **bold** and *italic* spans within a line. */
export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold)
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {bold[1]}
        </strong>
      );
    const italic = p.match(/^\*([^*]+)\*$/);
    if (italic)
      return (
        <em key={i} className="italic text-slate-600">
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
 *   ##  Section      — indigo accent pip + small-caps label + rule (EXPERIENCE …)
 *   ### Role/Company — bold label for a job or degree entry
 *   -/* Bullets      — tight list with indigo triangle marker
 *   ---  / ___       — horizontal divider
 *   **bold**  *italic*  inline
 *
 * Contact line detection: any paragraph between the # name and the first ##
 * section is rendered as a centered, muted contact/tagline line.
 */
export function MarkdownView({ md, className }: { md: string; className?: string }) {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;
  let sawH1 = false;
  let sawH2 = false;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = [...bullets];
    bullets = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-none pl-1 space-y-0.5 my-1.5">
        {items.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5 leading-[1.6]">
            <span className="text-indigo-400 text-[8px] mt-[5px] shrink-0 select-none">▸</span>
            <span className="text-[12px] text-slate-700">{renderInline(b)}</span>
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
        sawH1 = true;
        blocks.push(
          <div key={`h1-${key++}`} className="text-center mb-1">
            <h1 className="text-[26px] font-bold tracking-tight text-slate-900 leading-none mb-1.5">
              {renderInline(text)}
            </h1>
            <div className="flex justify-center">
              <span className="block w-10 h-[2px] rounded-full bg-indigo-500" />
            </div>
          </div>,
        );
      } else if (level === 2) {
        sawH2 = true;
        blocks.push(
          <h2
            key={`h-${key++}`}
            className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500 mt-5 mb-2 pb-1 border-b border-indigo-200"
          >
            <span className="inline-block w-[3px] h-3 rounded-full bg-indigo-500 shrink-0" />
            {renderInline(text)}
          </h2>,
        );
      } else {
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
      blocks.push(<hr key={`hr-${key++}`} className="border-t border-slate-200 my-2.5" />);
    } else if (bullet) {
      bullets.push(bullet[1]);
    } else if (line.trim() === '') {
      flushBullets();
    } else {
      flushBullets();
      if (sawH1 && !sawH2) {
        // Contact / tagline line in the header area (between # name and first ## section).
        blocks.push(
          <p
            key={`p-${key++}`}
            className="text-[11px] text-slate-500 text-center leading-relaxed tracking-wide mb-1"
          >
            {renderInline(line)}
          </p>,
        );
      } else {
        blocks.push(
          <p key={`p-${key++}`} className="text-[12px] text-slate-700 leading-[1.65] my-1">
            {renderInline(line)}
          </p>,
        );
      }
    }
  }
  flushBullets();

  return <div className={className}>{blocks}</div>;
}
