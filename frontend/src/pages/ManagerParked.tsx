import { Layout } from '../components/Layout';
import { EmptyState } from '../components/EmptyState';

/**
 * Landing for the parked MANAGER role. MANAGER currently has no tier access
 * (see shared/src/roles.ts — it's intentionally out of MANAGER_TIER), so rather
 * than drop it on the manager dashboard whose data endpoints would 403, we show
 * a clean "no access yet" page. Replace this when MANAGER gets a defined role.
 */
export function ManagerParked() {
  return (
    <Layout title="Dashboard" crumbs={[{ label: 'Workspace' }]}>
      <div className="mx-auto max-w-lg pt-8">
        <EmptyState
          icon="🚧"
          title="Your account isn’t set up yet"
          description="The Manager role doesn’t have access to any tools right now. An admin will enable your workspace — check back soon or reach out to your administrator."
        />
      </div>
    </Layout>
  );
}
