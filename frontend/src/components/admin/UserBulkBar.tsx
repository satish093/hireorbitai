import { Popover } from '../ui/Popover';
import { Button } from '../Button';
import { Role, ROLE_LABEL, assignableRolesFor } from '../../types';
import { useAuth } from '../../context/AuthContext';
import type { GroupLite } from './types';

/**
 * Replaces the filter bar when ≥1 row is selected. Accent-tinted; surfaces the
 * count + bulk actions. Change role / Move to group open a value picker first;
 * every action is confirmed by the parent (Deactivate requires a typed phrase).
 */
export function UserBulkBar({
  count,
  groups,
  onResetPassword,
  onChangeRole,
  onMoveGroup,
  onSuspend,
  onDeactivate,
  onClear,
}: {
  count: number;
  groups: GroupLite[];
  onResetPassword: () => void;
  onChangeRole: (role: Role) => void;
  onMoveGroup: (groupId: string | null) => void;
  onSuspend: () => void;
  onDeactivate: () => void;
  onClear: () => void;
}) {
  const { profile } = useAuth();
  // Only roles the current admin may actually assign (rank ceiling).
  const roleChoices = profile ? assignableRolesFor(profile.role) : [];
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-3 h-12 rounded-lg bg-accent-soft border border-accent/30">
      <span className="text-sm font-medium text-accent">{count} selected</span>
      <button onClick={onClear} className="text-xs text-accent/80 hover:underline">
        Clear
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onResetPassword}>
          Send reset
        </Button>

        <Popover
          button={(open) => (
            <Button variant="secondary" size="sm" className={open ? 'ring-2 ring-accent/30' : ''}>
              Change role ▾
            </Button>
          )}
        >
          {(close) => (
            <div className="min-w-[160px] max-h-64 overflow-y-auto">
              {roleChoices.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    onChangeRole(r);
                    close();
                  }}
                  className="block w-full text-left px-2.5 py-1.5 rounded-md text-sm text-ink hover:bg-hover"
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          )}
        </Popover>

        <Popover
          button={(open) => (
            <Button variant="secondary" size="sm" className={open ? 'ring-2 ring-accent/30' : ''}>
              Move to group ▾
            </Button>
          )}
        >
          {(close) => (
            <div className="min-w-[180px] max-h-64 overflow-y-auto">
              <button
                onClick={() => {
                  onMoveGroup(null);
                  close();
                }}
                className="block w-full text-left px-2.5 py-1.5 rounded-md text-sm text-muted hover:bg-hover"
              >
                No group
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    onMoveGroup(g.id);
                    close();
                  }}
                  className="block w-full text-left px-2.5 py-1.5 rounded-md text-sm text-ink hover:bg-hover"
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </Popover>

        <Button variant="secondary" size="sm" onClick={onSuspend}>
          Suspend
        </Button>
        <Button variant="danger" size="sm" onClick={onDeactivate}>
          Deactivate
        </Button>
      </div>
    </div>
  );
}
