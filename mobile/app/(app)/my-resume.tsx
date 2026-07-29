import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card, SectionHeader, Divider, DetailRow } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { EmptyState, SkeletonList } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/services/api';
import { useScreenCaptureGuard } from '../../src/security/PrivacyScreen';
import { openExternalUrl } from '../../src/utils/safeUrl';
import type { Resume } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

/**
 * A consultant's own resume versions.
 *
 * CONSULTANT-only. Screen capture is blocked here: a resume carries full name,
 * address, phone and work history, and this is the screen most likely to be open
 * when a phone is handed to someone. On Android that is a real FLAG_SECURE
 * block; on iOS the OS offers no prevention API, so it is detection only.
 *
 * Downloads go through the HMAC-signed expiring URL the backend mints
 * (GET /api/files/:bucket/*) — the app never constructs a storage path itself,
 * and openExternalUrl refuses anything that isn't https.
 */
export default function MyResumeScreen() {
  return (
    <RouteGuard allow={['CONSULTANT']}>
      <MyResume />
    </RouteGuard>
  );
}

function MyResume() {
  useScreenCaptureGuard();

  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  // There is no /resumes/mine endpoint. The real one is
  // GET /resumes/consultant/:consultantId, which is open to a CONSULTANT for
  // their OWN row — authorizeConsultantAccess() inside the controller scopes a
  // consultant strictly to themselves and 404s otherwise, so passing our own
  // consultant_id is both correct and safe.
  const consultantId = profile?.consultant_id ?? null;
  const { items, loading, refreshing, error, onRefresh } = useApiList<Resume>(
    consultantId ? `/resumes/consultant/${consultantId}` : null,
    { channel: 'resumes', enabled: !!consultantId },
  );

  const current = items.find((r) => r.is_current) ?? items[0];
  const older = items.filter((r) => r.id !== current?.id);

  /**
   * Download URLs are minted on demand, not embedded in the list row: the
   * backend HMAC-signs them with an expiry, so a URL baked into a cached list
   * would already be dead by the time the user taps it.
   */
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
    <Screen edges={['top']}>
      <PageTopBar
        title="My résumé"
        subtitle={`${items.length} version${items.length === 1 ? '' : 's'}`}
        showBack
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {error ? <Banner tone="danger" message={error} /> : null}

        {loading ? (
          <SkeletonList count={2} />
        ) : !current ? (
          <Card>
            <EmptyState
              compact
              title="No résumé uploaded"
              description="Your recruiter can upload one for you, or you can add it from the web app."
            />
          </Card>
        ) : (
          <>
            <Card>
              <SectionHeader
                title="Current version"
                action={<Pill label="Current" tone="success" size="sm" />}
              />
              <Text
                numberOfLines={2}
                style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
              >
                {current.file_name}
              </Text>
              <View style={{ marginTop: spacing.sm }}>
                <DetailRow label="Version" value={current.version ?? 1} />
                <Divider />
                <DetailRow label="Uploaded" value={relativeDate(current.created_at)} />
              </View>
              <View style={{ marginTop: spacing.lg }}>
                <Button
                  label="Open résumé"
                  variant="secondary"
                  onPress={() => void openResume(current.id)}
                />
              </View>
            </Card>

            {older.length > 0 ? (
              <Card padded={false}>
                <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                  <SectionHeader title="Earlier versions" />
                </View>
                {older.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 ? <Divider /> : null}
                    <View
                      style={{
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={{ fontSize: fontSize.base, color: colors.ink }}
                        >
                          {r.file_name}
                        </Text>
                        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                          v{r.version ?? '—'} · {relativeDate(r.created_at)}
                        </Text>
                      </View>
                      <Button
                        label="Open"
                        size="sm"
                        variant="ghost"
                        block={false}
                        onPress={() => void openResume(r.id)}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}

        <Banner
          tone="info"
          message="Screenshots are blocked on this screen because your résumé contains personal information."
        />
      </ScrollView>
    </Screen>
  );
}
