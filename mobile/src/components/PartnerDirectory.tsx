import { useMemo, useState } from 'react';
import { Linking, Text, View, type KeyboardTypeOptions } from 'react-native';
import { ListScreen, PageHeader, Banner } from './ui/Screen';
import { Card, DetailRow, Divider } from './ui/Card';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { SearchInput, FormInput, SelectInput } from './ui/Inputs';
import { useApiList, useApiMutation } from '../hooks/useApi';
import type { InvalidationChannel } from '../hooks/useInvalidate';
import { useTheme } from '../theme';

/**
 * Shared directory screen for Vendors and Clients.
 *
 * Both endpoints return the same core shape (company_name, contact_name,
 * contact_email, contact_phone, notes) and the web renders them with two
 * near-identical pages. Duplicating that here would mean fixing every future bug
 * twice, so they share one component and differ only by title, endpoint, the
 * extra rows each card surfaces (tier vs industry/location), and the create form.
 */

export interface Partner {
  id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  // Vendor-only
  tier?: string | null;
  website?: string | null;
  // Client-only
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
  created_at: string;
}

/** One field in the "New …" create sheet. `options` turns it into a SelectInput. */
export interface PartnerField {
  key: string;
  label: string;
  required?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface PartnerCreateConfig {
  buttonLabel: string;
  sheetTitle: string;
  sheetSubtitle: string;
  fields: PartnerField[];
}

export function PartnerDirectory({
  title,
  endpoint,
  channel,
  emptyDescription,
  create,
  extraRows,
}: {
  title: string;
  endpoint: string;
  channel: InvalidationChannel;
  emptyDescription: string;
  /** When provided, renders a "New …" button that opens the create sheet. */
  create?: PartnerCreateConfig;
  /** Extra label/value rows to show on each card (tier, industry, location). */
  extraRows?: (p: Partner) => { label: string; value?: string | null }[];
}) {
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Partner>(endpoint, {
    channel,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.company_name?.toLowerCase().includes(q) ||
        p.contact_name?.toLowerCase().includes(q) ||
        p.contact_email?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${items.length} total`}
        action={
          create ? (
            <Button
              label={create.buttonLabel}
              size="sm"
              variant="secondary"
              block={false}
              onPress={() => setAddOpen(true)}
            />
          ) : undefined
        }
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(p) => p.id}
        header={
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search company or contact"
          />
        }
        emptyTitle={query ? 'No matches' : `No ${title.toLowerCase()}`}
        emptyDescription={query ? 'Try a different search term.' : emptyDescription}
        renderItem={({ item }) => {
          const rows = [
            { label: 'Contact', value: item.contact_name },
            { label: 'Email', value: item.contact_email },
            ...(extraRows ? extraRows(item) : []),
          ].filter((r) => r.value);
          return (
            <Card>
              <Text
                numberOfLines={2}
                style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.accent }}
              >
                {item.company_name}
              </Text>

              {rows.length ? (
                <View style={{ marginTop: spacing.xs }}>
                  {rows.map((r) => (
                    <DetailRow key={r.label} label={r.label} value={r.value ?? '—'} />
                  ))}
                </View>
              ) : null}

              {item.notes ? (
                <Text
                  numberOfLines={3}
                  style={{
                    fontSize: fontSize.sm,
                    color: colors.muted,
                    marginTop: spacing.sm,
                    lineHeight: 19,
                  }}
                >
                  {item.notes}
                </Text>
              ) : null}

              {/* Tap-to-contact. mailto:/tel: are composed from the row, never
                  from free-form input, and are the two schemes a phone genuinely
                  improves on over the web — so they bypass the https-only rule in
                  safeUrl deliberately and narrowly. */}
              {item.contact_email || item.contact_phone ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  {item.contact_email ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Email"
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          void Linking.openURL(`mailto:${encodeURIComponent(item.contact_email!)}`);
                        }}
                      />
                    </View>
                  ) : null}
                  {item.contact_phone ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Call"
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          void Linking.openURL(`tel:${item.contact_phone!.replace(/[^\d+]/g, '')}`);
                        }}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        }}
      />

      {create ? (
        <PartnerCreateSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          config={create}
          endpoint={endpoint}
          channel={channel}
          onCreated={() => {
            setAddOpen(false);
            void refetch();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Generic "New vendor" / "New client" sheet. Fields are declared by the caller
 * so one component serves both. Sends only non-empty values as the payload,
 * mirroring the `.strict()` create schemas (company_name is the only required
 * field on both endpoints).
 */
function PartnerCreateSheet({
  open,
  onClose,
  config,
  endpoint,
  channel,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  config: PartnerCreateConfig;
  endpoint: string;
  channel: InvalidationChannel;
  onCreated: () => void;
}) {
  const { colors, spacing } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const create = useApiMutation<Record<string, string>>('post', endpoint, {
    invalidates: [channel],
  });

  // Reset the form each time the sheet opens so a new record starts clean.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setValues({});
    setTouched(false);
    create.reset();
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const requiredField = config.fields.find((f) => f.required);
  const canSave = !requiredField || !!values[requiredField.key]?.trim();

  const submit = async () => {
    setTouched(true);
    if (!canSave) return;
    const payload: Record<string, string> = {};
    for (const f of config.fields) {
      const v = values[f.key]?.trim();
      if (v) payload[f.key] = v;
    }
    const ok = await create.mutate(payload);
    if (ok) onCreated();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={config.sheetTitle}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={create.pending ? 'Creating…' : config.sheetTitle}
            onPress={submit}
            loading={create.pending}
            disabled={!canSave || create.pending}
          />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={create.pending} />
        </View>
      }
    >
      <View>
        <Text style={{ marginBottom: spacing.md, color: colors.muted, fontSize: 14 }}>
          {config.sheetSubtitle}
        </Text>
        {config.fields.map((f, i) =>
          f.options ? (
            <SelectInput
              key={f.key}
              label={f.label}
              required={f.required}
              value={values[f.key] || null}
              options={f.options}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              placeholder={f.placeholder ?? 'Select…'}
            />
          ) : (
            <FormInput
              key={f.key}
              label={f.label}
              required={f.required}
              value={values[f.key] ?? ''}
              onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              keyboardType={f.keyboardType}
              autoCapitalize={f.autoCapitalize}
              placeholder={f.placeholder}
              error={
                touched && f.required && !values[f.key]?.trim()
                  ? `${f.label.replace(/\s*\*$/, '')} is required.`
                  : null
              }
              autoFocus={i === 0}
            />
          ),
        )}
        {create.error ? (
          <View style={{ marginBottom: spacing.md }}>
            <Banner tone="danger" message={create.error} />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
