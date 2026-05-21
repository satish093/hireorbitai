import { Button } from '../Button';
import type { TabKey } from './types';

export function EmptyState({ tab, onSync }: { tab: TabKey; onSync?: () => void }) {
  const map: Record<TabKey, string> = {
    recommended: 'No jobs found yet. Pull fresh listings from your live sources to get started.',
    liked: "You haven't saved any jobs yet — tap the bookmark on a card to save it.",
    applied: "You haven't submitted to any jobs yet.",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-10 text-center text-muted">
      <div className="mb-3">{map[tab]}</div>
      {tab === 'recommended' && onSync && (
        <Button variant="primary" size="sm" pill onClick={onSync} leftIcon={<span>↻</span>}>
          Sync jobs now
        </Button>
      )}
    </div>
  );
}
