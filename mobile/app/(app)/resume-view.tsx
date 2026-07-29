import { useState } from 'react';
import { ActivityIndicator, Dimensions, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Pdf from 'react-native-pdf';
import { Screen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useScreenCaptureGuard } from '../../src/security/PrivacyScreen';
import { ALL_ROLES } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * In-app résumé viewer.
 *
 * "Open" on a résumé used to hand the file to the OS (external browser → the file
 * downloaded and left the app). This renders the PDF INSIDE the app with
 * react-native-pdf, so the résumé stays in HireOrbit and never lands in the
 * device's download folder. The signed, expiring URL is passed in as a param;
 * react-native-pdf fetches the bytes from our self-hosted backend directly (no
 * third-party document viewer — résumés carry PII).
 *
 * Screen capture is guarded, same as the résumé lists.
 */
export default function ResumeViewScreen() {
  return (
    <RouteGuard allow={[...ALL_ROLES]}>
      <ResumeViewer />
    </RouteGuard>
  );
}

function ResumeViewer() {
  useScreenCaptureGuard();
  const { colors, spacing, fontSize } = useTheme();
  const { url, name } = useLocalSearchParams<{ url?: string; name?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  return (
    <Screen edges={['top']}>
      <PageTopBar title={name || 'Résumé'} showBack bell={false} />
      <View style={{ flex: 1, backgroundColor: colors.bgSunken }}>
        {!url ? (
          <Centered>
            <Text style={{ color: colors.muted, fontSize: fontSize.sm }}>No document to show.</Text>
          </Centered>
        ) : error ? (
          <Centered>
            <Text
              style={{
                color: colors.danger,
                fontSize: fontSize.sm,
                textAlign: 'center',
                paddingHorizontal: spacing.xl,
              }}
            >
              {error}
            </Text>
          </Centered>
        ) : (
          <>
            <Pdf
              source={{ uri: url, cache: true }}
              trustAllCerts={false}
              onLoadComplete={() => setLoading(false)}
              onError={() =>
                setError(
                  'This résumé could not be displayed. The link may have expired — go back and try again.',
                )
              }
              style={{
                flex: 1,
                width: Dimensions.get('window').width,
                backgroundColor: colors.bgSunken,
              }}
            />
            {loading ? (
              <Centered pointerEventsNone>
                <ActivityIndicator color={colors.accent} />
              </Centered>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

function Centered({
  children,
  pointerEventsNone,
}: {
  children: React.ReactNode;
  pointerEventsNone?: boolean;
}) {
  return (
    <View
      pointerEvents={pointerEventsNone ? 'none' : 'auto'}
      style={{
        ...(pointerEventsNone
          ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
          : { flex: 1 }),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}
