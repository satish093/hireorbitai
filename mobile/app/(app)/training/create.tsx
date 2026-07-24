import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { Card, SectionHeader } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { FormInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { api, apiErrorMessage } from '../../../src/services/api';
import { invalidate } from '../../../src/hooks/useInvalidate';
import { useAuth } from '../../../src/context/AuthContext';
import { ADMIN_TIER, MANAGER_TIER, type TrainingCourse } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * Create a course — POST /training/courses, or POST /training/courses/generate.
 *
 * Two paths, with deliberately different gates mirroring the router:
 *   • manual create   → MANAGER_TIER
 *   • AI generate     → ADMIN_TIER only, because it spends real AI budget and
 *                       runs long. The button is hidden, not just disabled, for
 *                       anyone below that tier.
 *
 * Generation is asynchronous on the server. This screen kicks it off and sends
 * the user to AI Activity to watch it, rather than blocking on a request that
 * can outlive the screen.
 */
export default function CreateCourseScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <CreateCourse />
    </RouteGuard>
  );
}

function CreateCourse() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'manual' | 'ai' | null>(null);

  const canGenerate = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const canSubmit = title.trim().length > 0 && pending === null;

  const payload = () => {
    const body: Record<string, unknown> = { title: title.trim() };
    if (description.trim()) body.description = description.trim();
    if (category.trim()) body.category = category.trim();
    return body;
  };

  const createManual = async () => {
    if (!canSubmit) return;
    setPending('manual');
    setError(null);
    try {
      const { data } = await api.post<TrainingCourse>('/training/courses', payload());
      invalidate('training');
      if (data?.id) router.replace(`/(app)/training/course/${data.id}`);
      else router.replace('/(app)/training/courses');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the course.'));
    } finally {
      setPending(null);
    }
  };

  const generateAI = async () => {
    if (!canSubmit) return;
    setPending('ai');
    setError(null);
    try {
      await api.post('/training/courses/generate', payload());
      invalidate('training');
      // Generation continues server-side; the activity log is where it's visible.
      router.replace('/(app)/training/ai-activity');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start generation.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New course' }} />
      <Screen edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Banner tone="danger" message={error} /> : null}

            <Card>
              <SectionHeader title="Course details" />
              <FormInput
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Cybersecurity Awareness"
                required
              />
              <FormInput
                label="Category"
                value={category}
                onChangeText={setCategory}
                placeholder="e.g. Compliance"
              />
              <FormInput
                label="Description"
                value={description}
                onChangeText={setDescription}
                placeholder="What will learners get out of this?"
                multiline
              />
            </Card>

            <Button
              label="Create empty course"
              onPress={createManual}
              disabled={!canSubmit}
              loading={pending === 'manual'}
            />

            {canGenerate ? (
              <Card>
                <SectionHeader title="Generate with AI" />
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: colors.muted,
                    lineHeight: 20,
                    marginBottom: spacing.md,
                  }}
                >
                  Builds an outline, lesson bodies and quizzes from the title and description. This
                  runs in the background and spends AI budget — you&apos;ll be taken to the activity
                  log to watch it.
                </Text>
                <Button
                  label="Generate course"
                  onPress={generateAI}
                  disabled={!canSubmit}
                  loading={pending === 'ai'}
                  variant="secondary"
                />
              </Card>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </>
  );
}
