import { Modal } from '../Modal';
import { Button } from '../Button';
import type { TailorSession } from './types';

interface Props {
  open: boolean;
  resumeId: string;
  onClose: () => void;
  onCreated: (session: TailorSession) => void;
}

// Placeholder — wired to the job picker + POST /tailor-sessions in the
// "Tailor with AI" step.
export function TailorLauncher({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Tailor with AI" size="lg">
      <p className="text-sm text-muted">Job picker coming up.</p>
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
