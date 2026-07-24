import { RouteGuard } from '../../src/components/RouteGuard';
import { PartnerDirectory } from '../../src/components/PartnerDirectory';
import { OPERATOR_TIER } from '../../src/types';

/** Client directory — GET /clients. OPERATOR_TIER. */
export default function ClientsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <PartnerDirectory
        title="Clients"
        endpoint="/clients"
        channel="clients"
        emptyDescription="Client companies your team places into will appear here."
      />
    </RouteGuard>
  );
}
