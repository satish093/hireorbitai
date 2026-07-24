import { RouteGuard } from '../../src/components/RouteGuard';
import { PartnerDirectory } from '../../src/components/PartnerDirectory';
import { OPERATOR_TIER } from '../../src/types';

/** Vendor directory — GET /vendors. OPERATOR_TIER. */
export default function VendorsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <PartnerDirectory
        title="Vendors"
        endpoint="/vendors"
        channel="vendors"
        emptyDescription="Vendors your team works with will appear here."
      />
    </RouteGuard>
  );
}
