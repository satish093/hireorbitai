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
        extraRows={(c) => [
          { label: 'Industry', value: c.industry },
          { label: 'Location', value: c.location },
        ]}
        create={{
          buttonLabel: '+ New client',
          sheetTitle: 'New client',
          sheetSubtitle: 'Create a client company your team places consultants into.',
          fields: [
            { key: 'company_name', label: 'Company *', required: true },
            { key: 'industry', label: 'Industry' },
            { key: 'location', label: 'Location' },
            { key: 'contact_name', label: 'Contact name' },
            {
              key: 'contact_email',
              label: 'Contact email',
              keyboardType: 'email-address',
              autoCapitalize: 'none',
            },
          ],
        }}
      />
    </RouteGuard>
  );
}
