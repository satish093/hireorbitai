/**
 * WhatsApp/Discord-style media viewer for chat attachments.
 *
 *   - Image attachments open in a fullscreen lightbox (gallery navigation
 *     when multiple images are in the same message). Powered by
 *     yet-another-react-lightbox.
 *   - PDF attachments open in a centered modal using the browser's built-in
 *     PDF renderer via a plain <iframe>. This eliminates pdfjs-dist and its
 *     GHSA-wgrm-67xf-hhpq arbitrary-JS-execution advisory entirely. The
 *     browser's native PDF viewer is sandboxed at the OS/GPU process level.
 *   - Other file types show a centered file card with download/open buttons.
 *
 * This file is the HEAVY entry point. It pulls in:
 *   yet-another-react-lightbox + plugins + their CSS
 *
 * Callers MUST import it via React.lazy so the inbox chunk doesn't pay
 * the download until the user clicks an attachment. The corresponding
 * lightweight hook (useMediaViewer) lives in hooks/useMediaViewer.ts and
 * is safe to import eagerly.
 */

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import 'yet-another-react-lightbox/plugins/captions.css';

import { IconX, IconFile } from './Icons';
import type { MediaViewerState, ViewerAttachment } from '../hooks/useMediaViewer';

interface MediaViewerModalProps {
  state: MediaViewerState | null;
  onClose: () => void;
}

function isImageAttachment(a: ViewerAttachment | undefined): boolean {
  if (!a) return false;
  if (a.is_image) return true;
  return !!a.mime_type && a.mime_type.startsWith('image/');
}

function isPdfAttachment(a: ViewerAttachment | undefined): boolean {
  if (!a) return false;
  if (a.mime_type === 'application/pdf') return true;
  return a.file_name.toLowerCase().endsWith('.pdf');
}

/**
 * Default export so callers can use `React.lazy(() => import(...))`
 * without an extra `.then(m => m.MediaViewerModal)` wrapper.
 */
export default function MediaViewerModal({ state, onClose }: MediaViewerModalProps) {
  if (!state) return null;
  const clicked = state.attachments[state.startIndex];
  if (!clicked) return null;

  if (isImageAttachment(clicked)) {
    return <ImageLightbox state={state} onClose={onClose} />;
  }
  if (isPdfAttachment(clicked)) {
    return <PdfViewerModal attachment={clicked} onClose={onClose} />;
  }
  return <FileCardModal attachment={clicked} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// Image lightbox
// ---------------------------------------------------------------------------
function ImageLightbox({ state, onClose }: { state: MediaViewerState; onClose: () => void }) {
  const { slides, index } = useMemo(() => {
    const images = state.attachments
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => isImageAttachment(a));
    const slidesList = images
      .filter(({ a }) => !!a.download_url)
      .map(({ a }) => ({
        src: a.download_url ?? '',
        download: a.download_url ?? undefined,
        title: a.file_name,
        alt: a.file_name,
      }));
    const newIndex = Math.max(
      0,
      images.findIndex(({ i }) => i === state.startIndex),
    );
    return { slides: slidesList, index: newIndex };
  }, [state]);

  if (slides.length === 0) return null;

  return (
    <Lightbox
      open
      close={onClose}
      slides={slides}
      index={index}
      plugins={[Zoom, Counter, Download, Captions]}
      controller={{ closeOnBackdropClick: true }}
      styles={{
        container: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(4px)',
        },
      }}
      animation={{ fade: 220, swipe: 260 }}
      carousel={{ finite: slides.length <= 1, preload: 1 }}
      zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
    />
  );
}

// ---------------------------------------------------------------------------
// PDF viewer — uses the browser's native renderer via <iframe>.
// No pdfjs-dist; no arbitrary-JS-execution risk (GHSA-wgrm-67xf-hhpq).
// ---------------------------------------------------------------------------
function PdfViewerModal({
  attachment,
  onClose,
}: {
  attachment: ViewerAttachment;
  onClose: () => void;
}) {
  useEscKey(onClose);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return createPortal(
    <Backdrop onClose={onClose}>
      <div
        className="w-full max-w-5xl h-[calc(100dvh-3rem)] bg-surface rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-surface shrink-0">
          <IconFile size={16} className="text-muted shrink-0" />
          <div
            className="text-sm font-medium text-ink truncate flex-1"
            title={attachment.file_name}
          >
            {attachment.file_name}
          </div>
          {attachment.download_url && (
            <a
              href={attachment.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline shrink-0"
            >
              Open in new tab ↗
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-hover"
          >
            <IconX size={16} />
          </button>
        </div>

        {/* PDF content */}
        {attachment.download_url ? (
          <iframe
            src={attachment.download_url}
            title={attachment.file_name}
            className="flex-1 min-h-0 w-full border-0 bg-slate-100 dark:bg-slate-900"
            aria-label={`PDF: ${attachment.file_name}`}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted p-6">
            The PDF is not available right now. Try again in a moment.
          </div>
        )}
      </div>
    </Backdrop>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// File card
// ---------------------------------------------------------------------------
function FileCardModal({
  attachment,
  onClose,
}: {
  attachment: ViewerAttachment;
  onClose: () => void;
}) {
  useEscKey(onClose);
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);
  return createPortal(
    <Backdrop onClose={onClose}>
      <div
        className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 shadow-2xl text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex h-14 w-14 mx-auto rounded-2xl bg-hover items-center justify-center text-muted">
          <IconFile size={28} />
        </div>
        <div>
          <p className="text-sm font-medium text-ink truncate" title={attachment.file_name}>
            {attachment.file_name}
          </p>
          {attachment.size_bytes != null && (
            <p className="text-xs text-muted mt-0.5">{formatBytes(attachment.size_bytes)}</p>
          )}
        </div>
        <div className="flex gap-2">
          {attachment.download_url && (
            <a
              href={attachment.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center h-10 rounded-xl bg-ink text-bg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Open
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-center h-10 rounded-xl border border-border text-sm font-medium text-ink hover:bg-hover"
          >
            Close
          </button>
        </div>
      </div>
    </Backdrop>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

function useEscKey(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
