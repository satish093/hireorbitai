import { EmptyState } from '../EmptyState';

interface Props {
  resumeId: string;
  againstJobId?: string | null;
}

// Placeholder — fleshed out in the ATS-breakdown step.
export function AtsBreakdownRail(_props: Props) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <EmptyState
        compact
        title="ATS breakdown"
        description="Select a version to see its score factors."
      />
    </div>
  );
}
