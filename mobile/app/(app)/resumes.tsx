import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ListScreen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { SearchInput, SelectInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { api } from '../../src/services/api';
import { useScreenCaptureGuard } from '../../src/security/PrivacyScreen';
import { openExternalUrl } from '../../src/utils/safeUrl';
import { OPERATOR_TIER, type Consultant, type Resume } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

/**
 * Résumés — operator view.
 *
 * There is no "list every résumé" endpoint; the API is
 * GET /resumes/consultant/:consultantId. That is not an oversight — it is what
 * keeps the surface row-scoped, since authorizeConsultantAccess() runs per
 * consultant and 404s (never 403) when the caller isn't entitled.
 *
 * So the screen is consultant-first: pick a person, see their versions.
 *
 * Screen capture is guarded — résumés carry name, address, phone and history.
 */
export default function ResumesScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <ResumesView />
    </RouteGuard>
  );
}

function ResumesView() {
  useScreenCaptureGuard();

  const { colors, spacing, fontSize } = useTheme();
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const consultants = useApiList<Consultant>('/consultants', { channel: 'consultants' });

  const resumes = useApiList<Resume>(consultantId ? `/resumes/consultant/${consultantId}` : null, {
    channel: 'resumes',
    enabled: !!consultantId,
  });

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return consultants.items
      .filter((c) =>
        q
          ? c.user?.full_name?.toLowerCase().includes(q) || c.user?.email?.toLowerCase().includes(q)
          : true,
      )
      .map((c) => ({
        value: c.id,
        label: c.user?.full_name?.trim() || c.user?.email || 'Unnamed consultant',
        description: c.user?.email ?? undefined,
      }));
  }, [consultants.items, query]);

  const openResume = async (id: string) => {
    try {
      const { data } = await api.get<{ url?: string; download_url?: string }>(
        `/resumes/${id}/download-url`,
      );
      await openExternalUrl(data?.url ?? data?.download_url);
    } catch {
      Alert.alert('Could not open', 'The download link could not be created. Try again.');
    }
  };

  return (
    <>
      <PageHeader title="Résumés" />
      <ListScreen
        items={consultantId ? resumes.items : []}
        loading={consultantId ? resumes.loading : false}
        refreshing={resumes.refreshing}
        error={resumes.error}
        onRefresh={resumes.onRefresh}
        onRetry={() => void resumes.refetch()}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: spacing.md }}>
            <SearchInput value={query} onChangeText={setQuery} placeholder="Filter consultants" />
            <SelectInput
              label="Consultant"
              value={consultantId}
              options={options}
              onChange={setConsultantId}
              placeholder={consultants.loading ? 'Loading consultants…' : 'Choose a consultant'}
            />
            <Banner
              tone="info"
              message="Screenshots are blocked here — résumés contain personal information."
            />
          </View>
        }
        emptyTitle={consultantId ? 'No résumés' : 'Pick a consultant'}
        emptyDescription={
          consultantId
            ? 'This consultant has no résumé uploaded yet.'
            : 'Choose someone above to see their résumé versions.'
        }
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                >
                  {item.file_name}
                </Text>
                <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                  v{item.version ?? '—'} · {relativeDate(item.created_at)}
                </Text>
              </View>
              {item.is_current ? <Pill label="Current" tone="success" size="sm" /> : null}
            </View>
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Open"
                size="sm"
                variant="secondary"
                onPress={() => void openResume(item.id)}
              />
            </View>
          </Card>
        )}
      />
    </>
  );
}
