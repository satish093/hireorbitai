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
        extraRows={(v) => [{ label: 'Tier', value: v.tier }]}
        create={{
          buttonLabel: '+ New vendor',
          sheetTitle: 'New vendor',
          sheetSubtitle: 'Create a vendor record so submissions can reference them.',
          fields: [
            { key: 'company_name', label: 'Company name *', required: true },
            { key: 'contact_name', label: 'Contact name' },
            {
              key: 'contact_email',
              label: 'Contact email',
              keyboardType: 'email-address',
              autoCapitalize: 'none',
            },
            { key: 'contact_phone', label: 'Contact phone', keyboardType: 'phone-pad' },
            {
              key: 'tier',
              label: 'Tier',
              placeholder: 'T1 / T2 / Prime',
              options: [
                { value: 'T1', label: 'T1' },
                { value: 'T2', label: 'T2' },
                { value: 'Prime', label: 'Prime' },
              ],
            },
            { key: 'website', label: 'Website', keyboardType: 'url', autoCapitalize: 'none' },
          ],
        }}
      />
    </RouteGuard>
  );
}
