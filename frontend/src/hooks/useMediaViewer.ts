/**
 * Tiny hook that drives the lazy MediaViewerModal.
 *
 * Lives in its own file (not inside MediaViewerModal.tsx) so the heavy
 * lightbox / pdf-viewer chunks stay lazy. Importing the modal at all pulls
 * yet-another-react-lightbox + @react-pdf-viewer + pdfjs-dist into the
 * current bundle; this hook is just two useState transitions and a tiny
 * type — safe to import eagerly anywhere.
 */

import { useState } from 'react';

export interface ViewerAttachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  download_url: string | null;
  is_image?: boolean;
}

export interface MediaViewerState {
  attachments: ViewerAttachment[];
  startIndex: number;
}

export function useMediaViewer() {
  const [state, setState] = useState<MediaViewerState | null>(null);
  const open = (attachments: ViewerAttachment[], startIndex: number) =>
    setState({ attachments, startIndex });
  const close = () => setState(null);
  return { state, open, close };
}
