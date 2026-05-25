import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { api } from '../../services/api';
import { MarkdownView } from './markdown';

interface Props {
  resumeId: string;
  fileName?: string;
  /** Bump to force a background re-fetch (e.g. after re-extraction). */
  refreshKey?: number;
  /** Re-extract readable text from the stored file (for old fileless uploads). */
  onReextract?: () => void;
  reextracting?: boolean;
}

/**
 * Renders a resume version the way it would print: real white paper, sans-serif
 * type, sectioned headers, drop shadow. The paper is intentionally NOT themed —
 * it stays white in dark mode so the PDF export matches what's on screen.
 *
 * Stale-while-revalidate: when the same resumeId re-fetches (e.g. after AI
 * re-extraction or applying a tailor session) the existing body stays visible
 * rather than being replaced by a skeleton. A skeleton only appears when a
 * genuinely different resumeId is loaded for the first time.
 */
export function ResumePreview({
  resumeId,
  fileName,
  refreshKey,
  onReextract,
  reextracting,
}: Props) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const loadedIdRef = useRef<string | null>(null);

  const print = useReactToPrint({
    contentRef: paperRef,
    documentTitle: (fileName || 'resume').replace(/\.[^.]+$/, ''),
  });

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    const isNewResume = resumeId !== loadedIdRef.current;

    if (isNewResume) {
      setBody(null);
      setLoading(true);
      setRefreshing(false);
    } else {
      setRefreshing(true);
    }
    setError(false);

    api
      .get(`/resumes/${resumeId}/body`)
      .then((r) => {
        if (cancelled) return;
        loadedIdRef.current = resumeId;
        setBody(r.data?.body ?? '');
        setLoading(false);
        setRefreshing(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 p-6 sm:p-10 flex justify-center">
        <div className="bg-white w-full max-w-[720px] rounded-sm px-10 py-12 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.08),0_12px_32px_-4px_rgba(0,0,0,0.14)]">
          <div className="flex flex-col items-center mb-8 gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-2.5 w-px bg-indigo-300" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-5/6 mb-2" />
          <Skeleton className="h-3 w-4/6 mb-6" />
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        compact
        title="Couldn't load preview"
        description="The resume body failed to load. Try again or download the original file."
      />
    );
  }

  if (!body) {
    return (
      <EmptyState
        compact
        icon="📄"
        title="No text preview"
        description="This version has no extracted text yet. Re-extract reads the original PDF/DOCX and pulls the text in; otherwise use Download to get the original file."
        action={
          onReextract ? (
            <Button size="sm" variant="primary" onClick={onReextract} loading={reextracting}>
              ↻ Re-extract text
            </Button>
          ) : undefined
        }
      />
    );
  }

  const displayName = fileName ? fileName.replace(/\.[^.]+$/, '') : null;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 px-1">
        {displayName ? (
          <span className="text-[12px] text-muted font-medium truncate max-w-[60%]">
            {displayName}
          </span>
        ) : (
          <span />
        )}
        <Button size="sm" variant="outline" onClick={() => print()}>
          ⬇ Export PDF
        </Button>
      </div>

      {/* Tray — gradient neutral bg so the white paper stands out */}
      <div className="overflow-y-auto max-h-[72vh] bg-gradient-to-b from-slate-200 to-slate-300 dark:from-slate-800 dark:to-slate-900 rounded-2xl p-5 sm:p-8 flex justify-center">
        {/* Paper — always white regardless of app theme; matches what will print */}
        <div
          ref={paperRef}
          className={`bg-white text-slate-900 w-full max-w-[720px] rounded-[2px] shadow-[0_2px_4px_rgba(0,0,0,0.06),0_8px_24px_-4px_rgba(0,0,0,0.16),0_0_0_1px_rgba(0,0,0,0.04)] px-10 sm:px-14 py-10 sm:py-12 print:!bg-white print:!text-slate-900 print:shadow-none print:max-w-none print:px-0 print:py-0 transition-opacity duration-300 ${refreshing ? 'opacity-60' : 'opacity-100'}`}
          style={{ fontFamily: "'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif" }}
        >
          <MarkdownView md={body ?? ''} />
        </div>
      </div>
    </div>
  );
}
