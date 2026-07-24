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
  refreshKey?: number;
  onReextract?: () => void;
  reextracting?: boolean;
}

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

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="bg-white dark:bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-8 sm:px-12 py-8 sm:py-10">
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

  /* ── Error ── */
  if (error) {
    return (
      <EmptyState
        compact
        title="Couldn't load preview"
        description="The resume body failed to load. Try again or download the original file."
      />
    );
  }

  /* ── No text yet ── */
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
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted font-mono truncate max-w-[60%]">
          {fileName ? fileName.replace(/\.[^.]+$/, '') : ''}
        </span>
        <Button size="sm" variant="outline" onClick={() => print()}>
          ↓ Export PDF
        </Button>
      </div>

      {/* Document */}
      <div
        ref={paperRef}
        className={`bg-white text-slate-900 rounded-xl border border-slate-200 shadow-sm w-full overflow-y-auto max-h-[70vh] px-8 sm:px-12 py-8 sm:py-10 print:!bg-white print:!text-slate-900 print:shadow-none print:border-none print:overflow-visible print:max-h-none print:px-0 print:py-0 transition-opacity duration-300 ${refreshing ? 'opacity-50' : 'opacity-100'}`}
        style={{ fontFamily: "'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif" }}
      >
        <MarkdownView md={body ?? ''} />
      </div>
    </div>
  );
}
