import { KANBAN_COLUMNS, columnForStatus, type TaskRow } from './types';
import type { TaskStatus } from '../../types';
import { TaskCard } from './TaskCard';

export function TaskKanban({
  tasks,
  selectedId,
  onSelect,
  onStatusChange,
}: {
  tasks: TaskRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
}): JSX.Element {
  // Group tasks by column key
  const byColumn = new Map<string, TaskRow[]>(KANBAN_COLUMNS.map((col) => [col.key, []]));
  for (const task of tasks) {
    const key = columnForStatus(task.status);
    byColumn.get(key)?.push(task);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {KANBAN_COLUMNS.map((col) => {
        const colTasks = byColumn.get(col.key) ?? [];

        return (
          <div
            key={col.key}
            className="flex flex-col"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              if (id) {
                onStatusChange(id, col.canonical);
              }
            }}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${col.dot}`} aria-hidden="true" />
              <span className="text-sm font-semibold text-ink">{col.label}</span>
              <span className="text-[11px] font-mono text-muted bg-bg-sunken rounded px-1.5">
                {colTasks.length}
              </span>
            </div>

            {/* Column body — drop target */}
            <div className="space-y-2 min-h-[120px] rounded-lg">
              {colTasks.length === 0 ? (
                <div className="flex items-center justify-center min-h-[80px] rounded-lg border border-dashed border-border">
                  <span className="text-[12px] text-faint">Drop here</span>
                </div>
              ) : (
                colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    selected={t.id === selectedId}
                    onSelect={() => onSelect(t.id)}
                    onDragStart={(e, id) => {
                      e.dataTransfer.setData('text/plain', id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
