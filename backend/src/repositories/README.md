# Repositories

A thin data-access layer between services/controllers and the [`db`](../config/db.ts) query builder. Each repository:

- Owns a single table (or a tight cluster of FK-bound tables).
- Returns plain TS objects (no Postgres internals leaking out).
- Throws `httpError` from [`../types`](../types/index.ts) on not-found / unique-conflict / FK violation.
- Never reads from `req` or knows about HTTP — controllers translate parameters into repository calls.

## Why incrementally?

Most of the codebase still calls `db.from('users').select(...).eq(...)` directly from controllers. That's fine at the current scale and we are NOT doing a big-bang rewrite — see [docs/architecture.md §Technical debt](../../../docs/architecture.md).

This directory is the **target** pattern. New code (and any controller that gets non-trivially refactored) should funnel through here. Pre-existing controllers can stay in the direct-`db` pattern until someone has reason to touch them.

## Pattern

```ts
// repositories/users.repository.ts
import { db } from '../config/db';
import { httpError, Role } from '../types';

export interface UserRow {
  id: string;
  email: string;
  role: Role; /* … */
}

export async function findById(id: string): Promise<UserRow | null> {
  const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
  return (data as UserRow | null) ?? null;
}

export async function requireById(id: string): Promise<UserRow> {
  const u = await findById(id);
  if (!u) throw httpError(404, 'User not found');
  return u;
}
```

Controllers consume the module as a namespace:

```ts
import * as usersRepo from '../repositories/users.repository';
// …
const user = await usersRepo.requireById(req.params.id);
```

## What's already extracted

| Repository                                                 | Owns                                               | Notes                                                                |
| ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| [`training.repository.ts`](training.repository.ts)         | training_courses + lessons + quizzes + assignments | Baseline from the training module ship.                              |
| [`users.repository.ts`](users.repository.ts)               | public.users                                       | Auth-path reads, status changes, session-version bump.               |
| [`authSessions.repository.ts`](authSessions.repository.ts) | public.auth_sessions                               | Refresh-token rows + expiry purge.                                   |
| [`applications.repository.ts`](applications.repository.ts) | public.applications                                | Read paths + lifecycle.                                              |
| [`consultants.repository.ts`](consultants.repository.ts)   | public.consultants                                 | Embeds `user:users!user_id(...)`.                                    |
| [`recruiters.repository.ts`](recruiters.repository.ts)     | public.recruiters                                  | Symmetric with consultants.                                          |
| [`jobs.repository.ts`](jobs.repository.ts)                 | public.jobs                                        | Read paths; bulk upsert stays in `services/jobIngestion.service.ts`. |
| [`vendors.repository.ts`](vendors.repository.ts)           | public.vendors                                     | Standard CRUD.                                                       |
| [`clients.repository.ts`](clients.repository.ts)           | public.clients                                     | Standard CRUD.                                                       |

## What's not extracted (yet)

Controllers still using `db.from()` directly: `featureFlags`, `interviews`, `invitations`, `messages`, `reminders`, `reports`, `resumes`, `taskAttachments`, `taskComments`, `tasks`, `userGroups`, `adminUsers`, `jobSources`, `glassdoor`.

That list is intentional — repositories are added when a controller is touched for unrelated reasons, not in a single big-bang rewrite. The pattern + 9 exemplars are now in place; copy one when you're refactoring.
