import { Button } from '../Button';
import { type SavedView } from './types';

export function TaskViewsRibbon({
  views,
  activeId,
  onSelect,
  onSaveCurrent,
}: {
  views: SavedView[];
  activeId: string | null;
  onSelect: (v: SavedView) => void;
  onSaveCurrent: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0">
      {views.map((v) => {
        const active = v.id === activeId;
        return (
          <Button
            key={v.id}
            size="sm"
            variant={active ? 'primary' : 'outline'}
            onClick={() => onSelect(v)}
            className="shrink-0"
          >
            {v.name}
            {v.count != null && (
              <span
                className={[
                  'ml-1.5 text-[10px] font-mono rounded px-1',
                  active ? 'bg-white/15 text-bg' : 'bg-bg-sunken text-muted',
                ].join(' ')}
              >
                {v.count}
              </span>
            )}
          </Button>
        );
      })}

      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label="Save current view as a new view"
        onClick={onSaveCurrent}
        className="shrink-0"
        leftIcon={
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        }
      />
    </div>
  );
}
