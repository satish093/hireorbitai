import { Fragment, type ReactNode } from 'react';

/** Render inline **bold** spans (the only inline markup the tailor output uses). */
export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    if (m) {
      return (
        <strong key={i} className="font-semibold">
          {m[1]}
        </strong>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/**
 * Minimal markdown → React renderer for resume bodies. Handles `#`/`##`/`###`
 * headings, `-`/`*` bullet lists, and **bold** inline. Deliberately tiny — the
 * tailor output is constrained markdown, so we avoid a heavyweight dependency.
 */
export function MarkdownView({ md, className }: { md: string; className?: string }) {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1 my-2">
        {items.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (heading) {
      flushBullets();
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        blocks.push(
          <h1 key={`h-${key++}`} className="text-2xl font-bold mt-1 mb-1">
            {renderInline(text)}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2
            key={`h-${key++}`}
            className="text-sm font-bold uppercase tracking-wider mt-5 mb-1.5 pb-1 border-b border-slate-300"
          >
            {renderInline(text)}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={`h-${key++}`} className="text-[13px] font-semibold mt-3 mb-0.5">
            {renderInline(text)}
          </h3>,
        );
      }
    } else if (bullet) {
      bullets.push(bullet[1]);
    } else if (line.trim() === '') {
      flushBullets();
    } else {
      flushBullets();
      blocks.push(
        <p key={`p-${key++}`} className="my-1.5 leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushBullets();

  return <div className={className}>{blocks}</div>;
}
