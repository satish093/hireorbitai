import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../jobs';

interface ActivityRow {
  id: string;
  kind?: string | null;
  status?: string | null;
  course_title?: string | null;
  model?: string | null;
  message?: string | null;
  created_at: string;
}

/**
 * AI generation activity — GET /training/activity. MANAGER_TIER.
 *
 * Course generation is long-running and can fail partway (an outline succeeds,
 * lesson bodies time out). This is the log that says which. Failures are what
 * anyone comes here to find, so status drives the colour.
 */
export default function TrainingAIActivityScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <AIActivityList />
    </RouteGuard>
  );
}

function toneFor(status?: string | null): PillTone {
  const s = (status ?? '').toLowerCase();
  if (/(fail|error|timeout|abort)/.test(s)) return 'danger';
  if (/(pending|running|queued|progress)/.test(s)) return 'warn';
  if (/(done|complete|success|ok)/.test(s)) return 'success';
  return 'neutral';
}

function AIActivityList() {
  const { colors, spacing, fontSize } = useTheme();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<ActivityRow>(
    '/training/activity',
    { channel: 'training' },
  );

  return (
    <>
      <PageHeader title="AI activity" subtitle={`${items.length} events`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(a) => a.id}
        emptyTitle="No AI activity"
        emptyDescription="Course generation runs will show up here."
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                >
                  {item.course_title ?? item.kind?.replace(/_/g, ' ') ?? 'Generation run'}
                </Text>
                {item.kind && item.course_title ? (
                  <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                    {item.kind.replace(/_/g, ' ')}
                  </Text>
                ) : null}
                <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
                  {relativeDate(item.created_at)}
                  {item.model ? ` · ${item.model}` : ''}
                </Text>
              </View>
              {item.status ? (
                <Pill label={item.status} tone={toneFor(item.status)} size="sm" />
              ) : null}
            </View>

            {item.message ? (
              <Text
                numberOfLines={4}
                style={{
                  fontSize: fontSize.sm,
                  color: colors.muted,
                  marginTop: spacing.sm,
                  lineHeight: 19,
                }}
              >
                {item.message}
              </Text>
            ) : null}
          </Card>
        )}
      />
    </>
  );
}
