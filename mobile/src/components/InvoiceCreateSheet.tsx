import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { FormInput, SelectInput } from './ui/Inputs';
import { SectionHeader, Divider } from './ui/Card';
import { Banner } from './ui/Screen';
import { useApiList, useApiMutation } from '../hooks/useApi';
import { useTheme } from '../theme';
import { money } from '../utils/format';

/**
 * Draft-invoice composer — POST /invoices (MANAGER_TIER).
 *
 * The server calculates and validates ALL money totals; the client only sends
 * line-item quantity/unit_rate plus discount_amount and tax_percent, and shows a
 * best-effort preview. Status is always forced to Draft on create. The "Issuing
 * company" list comes from GET /invoices/companies (each id is the company_group_id).
 *
 * Note: the UI "Tenure" field maps to the invoice `description` column — there is
 * no dedicated tenure column, and the create schema is `.strict()`.
 */

interface Company {
  id: string;
  name: string;
  email?: string | null;
}

interface Party {
  name: string;
  email: string;
  phone: string;
  website: string;
  country: string;
  tax_id: string;
  address: string;
}

interface LineItem {
  description: string;
  service_period: string;
  quantity: string;
  unit: string;
  unit_rate: string;
}

const emptyParty = (): Party => ({
  name: '',
  email: '',
  phone: '',
  website: '',
  country: '',
  tax_id: '',
  address: '',
});

const emptyLineItem = (): LineItem => ({
  description: '',
  service_period: '',
  quantity: '1',
  unit: 'hours',
  unit_rate: '0',
});

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'SGD'];

/** Today as YYYY-MM-DD (local). */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const numOr0 = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function InvoiceCreateSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();

  // Issuing companies feed the required company_group_id selector.
  const companies = useApiList<Company>('/invoices/companies', {
    channel: 'invoices',
    enabled: open,
  });

  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [netTerms, setNetTerms] = useState('30');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [discount, setDiscount] = useState('0');
  const [taxPercent, setTaxPercent] = useState('0');
  const [tenure, setTenure] = useState('');
  const [billTo, setBillTo] = useState<Party>(emptyParty);
  const [issuer, setIssuer] = useState<Party>(emptyParty);
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [touched, setTouched] = useState(false);

  const create = useApiMutation<Record<string, unknown>>('post', '/invoices', {
    invalidates: ['invoices'],
  });

  // Reset each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setCompanyId('');
    setName('');
    setInvoiceNumber('');
    setInvoiceDate(todayISO());
    setNetTerms('30');
    setDueDate('');
    setCurrency('USD');
    setDiscount('0');
    setTaxPercent('0');
    setTenure('');
    setBillTo(emptyParty());
    setIssuer(emptyParty());
    setItems([emptyLineItem()]);
    setTouched(false);
    create.reset();
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  // Client-side preview; the server is authoritative.
  const totals = useMemo(() => {
    const subtotal = items.reduce((s, li) => s + numOr0(li.quantity) * numOr0(li.unit_rate), 0);
    const disc = Math.min(numOr0(discount), subtotal);
    const taxable = subtotal - disc;
    const tax = (taxable * numOr0(taxPercent)) / 100;
    return { subtotal, disc, tax, total: taxable + tax };
  }, [items, discount, taxPercent]);

  const canSave =
    !!companyId &&
    !!billTo.name.trim() &&
    items.length > 0 &&
    items.every((li) => li.description.trim() && li.unit.trim() && numOr0(li.quantity) > 0);

  const setItem = (i: number, patch: Partial<LineItem>) =>
    setItems((arr) => arr.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));

  const partyPayload = (p: Party) => {
    const out: Record<string, string> = { name: p.name.trim() };
    if (p.email.trim()) out.email = p.email.trim();
    if (p.phone.trim()) out.phone = p.phone.trim();
    if (p.website.trim()) out.website = p.website.trim();
    if (p.country.trim()) out.country = p.country.trim();
    if (p.tax_id.trim()) out.tax_id = p.tax_id.trim();
    if (p.address.trim()) out.address = p.address.trim();
    return out;
  };

  const submit = async () => {
    setTouched(true);
    if (!canSave) return;

    const payload: Record<string, unknown> = {
      company_group_id: companyId,
      currency,
      discount_amount: numOr0(discount),
      tax_percent: numOr0(taxPercent),
      bill_to_snapshot: partyPayload(billTo),
      line_items: items.map((li) => {
        const row: Record<string, unknown> = {
          description: li.description.trim(),
          quantity: numOr0(li.quantity),
          unit: li.unit.trim(),
          unit_rate: numOr0(li.unit_rate),
        };
        if (/^\d{4}-\d{2}$/.test(li.service_period.trim()))
          row.service_period = li.service_period.trim();
        return row;
      }),
    };
    if (name.trim()) payload.name = name.trim();
    if (tenure.trim()) payload.description = tenure.trim();
    if (invoiceNumber.trim()) payload.invoice_number = invoiceNumber.trim();
    if (invoiceDate.trim()) payload.invoice_date = invoiceDate.trim();
    if (dueDate.trim()) payload.due_date = dueDate.trim();
    if (netTerms.trim()) payload.net_terms_days = numOr0(netTerms);
    if (issuer.name.trim()) payload.issuer_snapshot = partyPayload(issuer);

    const ok = await create.mutate(payload);
    if (ok) onCreated();
  };

  const companyOptions = companies.items.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New draft invoice"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={create.pending ? 'Creating…' : 'Create draft invoice'}
            onPress={submit}
            loading={create.pending}
            disabled={!canSave || create.pending}
          />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={create.pending} />
        </View>
      }
    >
      <View>
        <Text style={{ marginBottom: spacing.sm, color: colors.muted, fontSize: 14 }}>
          Totals are calculated and validated by the server.
        </Text>

        <SectionHeader title="Invoice details" />
        <SelectInput
          label="Issuing company *"
          required
          value={companyId || null}
          options={companyOptions}
          onChange={setCompanyId}
          placeholder={companies.loading ? 'Loading…' : 'Select company'}
          error={touched && !companyId ? 'Pick an issuing company.' : null}
          hint={
            !companies.loading && companyOptions.length === 0
              ? 'No companies in your scope — assign one first.'
              : undefined
          }
        />
        <FormInput
          label="Invoice number"
          value={invoiceNumber}
          onChangeText={setInvoiceNumber}
          placeholder="Auto-generated (INV-0001)"
          autoCapitalize="characters"
        />
        <FormInput
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. March retainer"
        />
        <FormInput
          label="Invoice date"
          value={invoiceDate}
          onChangeText={setInvoiceDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
        <FormInput
          label="Net terms (days)"
          value={netTerms}
          onChangeText={setNetTerms}
          keyboardType="number-pad"
        />
        <FormInput
          label="Due date"
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="YYYY-MM-DD (optional)"
          autoCapitalize="none"
        />
        <SelectInput
          label="Currency"
          value={currency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          onChange={setCurrency}
        />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <FormInput
              label="Discount amount"
              value={discount}
              onChangeText={setDiscount}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <FormInput
              label="Tax %"
              value={taxPercent}
              onChangeText={setTaxPercent}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <FormInput
          label="Tenure"
          value={tenure}
          onChangeText={setTenure}
          placeholder="e.g. Monthly — 1 Year Tenure (leave blank if none)"
        />

        <View style={{ height: spacing.lg }} />
        <SectionHeader title="Bill-to" />
        <PartyFields
          value={billTo}
          onChange={(patch) => setBillTo((p) => ({ ...p, ...patch }))}
          requireName
          nameError={touched && !billTo.name.trim() ? 'Bill-to name is required.' : null}
        />

        <View style={{ height: spacing.lg }} />
        <SectionHeader title="Issuer (optional)" />
        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginBottom: spacing.xs }}>
          Leave blank to use the issuing company's details.
        </Text>
        <PartyFields value={issuer} onChange={(patch) => setIssuer((p) => ({ ...p, ...patch }))} />

        <View style={{ height: spacing.lg }} />
        <SectionHeader title="Line items" />
        {items.map((li, i) => (
          <View
            key={i}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.md,
              gap: 2,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.ink2 }}>
                Item {i + 1}
              </Text>
              {items.length > 1 ? (
                <Pressable onPress={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}>
                  <Text style={{ fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' }}>
                    Remove
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <FormInput
              label="Description *"
              value={li.description}
              onChangeText={(v) => setItem(i, { description: v })}
              placeholder="Professional consulting services"
              error={touched && !li.description.trim() ? 'A description is required.' : null}
            />
            <FormInput
              label="Service month"
              value={li.service_period}
              onChangeText={(v) => setItem(i, { service_period: v })}
              placeholder="YYYY-MM (optional)"
              autoCapitalize="none"
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <FormInput
                  label="Quantity"
                  value={li.quantity}
                  onChangeText={(v) => setItem(i, { quantity: v })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormInput
                  label="Unit"
                  value={li.unit}
                  onChangeText={(v) => setItem(i, { unit: v })}
                  placeholder="hours"
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormInput
                  label="Unit rate"
                  value={li.unit_rate}
                  onChangeText={(v) => setItem(i, { unit_rate: v })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Text style={{ fontSize: fontSize.sm, color: colors.muted, textAlign: 'right' }}>
              {money(numOr0(li.quantity) * numOr0(li.unit_rate), currency)}
            </Text>
          </View>
        ))}
        <Button
          label="+ Add line item"
          variant="secondary"
          size="sm"
          onPress={() => setItems((arr) => [...arr, emptyLineItem()])}
        />

        <View style={{ height: spacing.lg }} />
        <View style={{ gap: 4 }}>
          <TotalRow label="Subtotal" value={money(totals.subtotal, currency)} />
          <TotalRow label="Discount" value={`− ${money(totals.disc, currency)}`} />
          <TotalRow label="Tax" value={money(totals.tax, currency)} />
          <Divider />
          <TotalRow label="Total" value={money(totals.total, currency)} strong />
        </View>

        {create.error ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner tone="danger" message={create.error} />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { colors, fontSize, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.xs,
      }}
    >
      <Text
        style={{
          fontSize: strong ? fontSize.md : fontSize.sm,
          fontWeight: strong ? '800' : '500',
          color: strong ? colors.ink : colors.muted,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: strong ? fontSize.md : fontSize.sm,
          fontWeight: strong ? '800' : '600',
          color: colors.ink,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function PartyFields({
  value,
  onChange,
  requireName,
  nameError,
}: {
  value: Party;
  onChange: (patch: Partial<Party>) => void;
  requireName?: boolean;
  nameError?: string | null;
}) {
  const { spacing } = useTheme();
  return (
    <View>
      <FormInput
        label={requireName ? 'Name *' : 'Name'}
        required={requireName}
        value={value.name}
        onChangeText={(v) => onChange({ name: v })}
        error={nameError}
      />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <FormInput
            label="Email"
            value={value.email}
            onChangeText={(v) => onChange({ email: v })}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput
            label="Phone"
            value={value.phone}
            onChangeText={(v) => onChange({ phone: v })}
            keyboardType="phone-pad"
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <FormInput
            label="Website"
            value={value.website}
            onChangeText={(v) => onChange({ website: v })}
            autoCapitalize="none"
          />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput
            label="Country"
            value={value.country}
            onChangeText={(v) => onChange({ country: v })}
          />
        </View>
      </View>
      <FormInput
        label="Tax ID"
        value={value.tax_id}
        onChangeText={(v) => onChange({ tax_id: v })}
      />
      <FormInput
        label="Address"
        value={value.address}
        onChangeText={(v) => onChange({ address: v })}
        multiline
      />
    </View>
  );
}
