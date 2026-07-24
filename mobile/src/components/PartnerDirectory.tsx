import { useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ListScreen, PageHeader } from './ui/Screen';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { SearchInput } from './ui/Inputs';
import { useApiList } from '../hooks/useApi';
import type { InvalidationChannel } from '../hooks/useInvalidate';
import { useTheme } from '../theme';

/**
 * Shared directory screen for Vendors and Clients.
 *
 * Both endpoints return the same shape (company_name, contact_name,
 * contact_email, phone, notes) and the web renders them with two near-identical
 * pages. Duplicating that here would mean fixing every future bug twice, so
 * they share one component and differ only by title and endpoint.
 */

export interface Partner {
  id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
}

export function PartnerDirectory({
  title,
  endpoint,
  channel,
  emptyDescription,
}: {
  title: string;
  endpoint: string;
  channel: InvalidationChannel;
  emptyDescription: string;
}) {
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');

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
      <PageHeader title={title} subtitle={`${items.length} total`} />
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
        renderItem={({ item }) => (
          <Card>
            <Text
              numberOfLines={2}
              style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
            >
              {item.company_name}
            </Text>
            {item.contact_name ? (
              <Text style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}>
                {item.contact_name}
              </Text>
            ) : null}
            {item.contact_email ? (
              <Text
                numberOfLines={1}
                style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
              >
                {item.contact_email}
              </Text>
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
            {item.contact_email || item.phone ? (
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
                {item.phone ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Call"
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        void Linking.openURL(`tel:${item.phone!.replace(/[^\d+]/g, '')}`);
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        )}
      />
    </>
  );
}
