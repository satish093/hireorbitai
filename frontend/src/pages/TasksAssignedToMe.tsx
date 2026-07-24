import { Tasks } from './Tasks';

/** The "assigned to me" entry point is the same workspace, seeded with the
 *  current user as the assignee filter. */
export function TasksAssignedToMe() {
  return <Tasks initialAssigneeMe />;
}
