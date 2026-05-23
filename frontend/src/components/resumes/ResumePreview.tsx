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
  /** Bump to force a re-fetch of the body (e.g. after re-extraction). */
  refreshKey?: number;
  /** Re-extract readable text from the stored file (for old fileless uploads). */
  onReextract?: () => void;
  reextracting?: boolean;
}

/**
 * Renders a resume version the way it would print: real white paper, sans-serif
 * type, sectioned headers, drop shadow. The paper is intentionally NOT themed —
 * it stays white in dark mode so the PDF export matches what's on screen.
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
  const [error, setError] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);

  const print = useReactToPrint({
    contentRef: paperRef,
    documentTitle: (fileName || 'resume').replace(/\.[^.]+$/, ''),
  });

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .get(`/resumes/${resumeId}/body`)
      .then((r) => !cancelled && setBody(r.data?.body ?? ''))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [resumeId, refreshKey]);

  if (loading) {
    return (
      <div className="bg-bg-sunken rounded-lg p-8 flex justify-center">
        <div className="bg-surface w-full max-w-[760px] rounded-sm px-10 py-12 space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-full mt-6" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
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

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="outline" onClick={() => print()}>
          ⬇ Export PDF
        </Button>
      </div>
      {/* Outer tray — neutral gray so the white paper stands out. */}
      <div className="overflow-y-auto max-h-[72vh] bg-[#d8dce3] dark:bg-[#1a1c22] rounded-xl p-5 sm:p-8 flex justify-center">
        {/* Paper — always white regardless of app theme; matches what will print. */}
        <div
          ref={paperRef}
          className="bg-white text-slate-900 w-full max-w-[720px] shadow-[0_6px_40px_-4px_rgba(0,0,0,0.22)] px-10 sm:px-14 py-10 sm:py-12 print:!bg-white print:!text-slate-900 print:shadow-none print:max-w-none print:px-0 print:py-0"
          style={{ fontFamily: "'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif" }}
        >
          <MarkdownView md={body} />
        </div>
      </div>
    </div>
  );
}
