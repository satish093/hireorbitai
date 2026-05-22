import { EmptyState } from '../EmptyState';
import { Button } from '../Button';

interface Props {
  resumeId: string;
  refreshKey: number;
  activeSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onNewSession: () => void;
}

// Placeholder — fleshed out in the tailor-history step.
export function TailorHistory(_props: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <EmptyState
          compact
          title="No tailor sessions"
          description="Tailor this version for a job to start the timeline."
        />
      </div>
      <Button variant="accent" block size="sm" className="mt-3" onClick={_props.onNewSession}>
        New tailor session
      </Button>
    </div>
  );
}
