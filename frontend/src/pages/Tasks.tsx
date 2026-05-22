import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { SkeletonCard } from '../components/Skeleton';
import { useTasksData } from '../components/tasks/useTasksData';
import { useSavedTaskViews } from '../components/tasks/useSavedTaskViews';
import {
  filterTasks,
  type FilterState,
  type ViewMode,
  type SavedView,
} from '../components/tasks/types';
import { TaskFilterBar } from '../components/tasks/TaskFilterBar';
import { TaskKanban } from '../components/tasks/TaskKanban';
import { TaskTable } from '../components/tasks/TaskTable';
import { TaskTimeline } from '../components/tasks/TaskTimeline';
import { TaskDetailPane } from '../components/tasks/TaskDetailPane';
import { CreateTaskModal } from '../components/tasks/CreateTaskModal';

export function Tasks({ initialAssigneeMe = false }: { initialAssigneeMe?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const view = ((params.get('view') as ViewMode) || 'kanban') as ViewMode;
  const selectedTaskId = params.get('task');

  const [filters, setFilters] = useState<FilterState>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { profile, tasks, users, loading, patchStatus, reload } = useTasksData();
  const { views, saveView } = useSavedTaskViews();
  const visible = filterTasks(tasks, filters);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  const setView = (v: ViewMode) => setParam('view', v);
  const setSelected = (id: string | null) => setParam('task', id);

  function selectView(v: SavedView) {
    setFilters(v.filters);
    setActiveViewId(v.id);
    setView(v.view_mode);
  }
  async function saveCurrent() {
    const name = window.prompt('Name this view');
    if (name?.trim()) await saveView(name.trim(), { filters, view_mode: view });
  }

  // Assigned-to-me entry point seeds the assignee filter once the profile loads.
  const seeded = useRef(false);
  useEffect(() => {
    if (initialAssigneeMe && profile?.id && !seeded.current) {
      seeded.current = true;
      setFilters((f) => ({ ...f, assignee_id: profile.id }));
    }
  }, [initialAssigneeMe, profile?.id]);

  // Press `/` to focus search (when not already typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const body = loading ? (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} lines={3} />
      ))}
    </div>
  ) : view === 'kanban' ? (
    <TaskKanban
      tasks={visible}
      selectedId={selectedTaskId}
      onSelect={setSelected}
      onStatusChange={patchStatus}
    />
  ) : view === 'table' ? (
    <TaskTable
      tasks={visible}
      selectedId={selectedTaskId}
      onSelect={setSelected}
      users={users}
      onChanged={reload}
    />
  ) : (
    <TaskTimeline tasks={visible} selectedId={selectedTaskId} onSelect={setSelected} />
  );

  return (
    <Layout title="Tasks" crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Tasks' }]}>
      <PageHeader title="Tasks" description="Track and organize your team's work." />

      <div className="space-y-3">
        <TaskFilterBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          total={tasks.length}
          shown={visible.length}
          view={view}
          onView={setView}
          searchRef={searchRef}
          users={users}
          views={views}
          activeViewId={activeViewId}
          onSelectView={selectView}
          onSaveCurrent={saveCurrent}
          profileId={profile?.id}
          onNewTask={() => setCreateOpen(true)}
        />

        <div
          className="grid gap-4 items-start transition-[grid-template-columns] duration-300 ease-out"
          style={{
            gridTemplateColumns: selectedTaskId ? 'minmax(0,1fr) 380px' : 'minmax(0,1fr) 0px',
          }}
        >
          <div className="min-w-0">{body}</div>
          <div className="overflow-hidden">
            {selectedTaskId && (
              <div className="sticky top-4 h-[calc(100dvh-10rem)] overflow-hidden rounded-xl border border-border">
                <TaskDetailPane
                  taskId={selectedTaskId}
                  onClose={() => setSelected(null)}
                  users={users}
                  onChanged={reload}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        users={users}
        onCreated={reload}
      />
    </Layout>
  );
}
