import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, SectionHeader } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { FormInput, SelectInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { api, apiErrorMessage } from '../../../src/services/api';
import { invalidate } from '../../../src/hooks/useInvalidate';
import { useAuth } from '../../../src/context/AuthContext';
import { ADMIN_TIER, MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface CourseResponse {
  id: string;
}

type Difficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

/**
 * Create a course — POST /training/courses, or POST /training/courses/generate.
 *
 *   • manual create   → MANAGER_TIER. Requires title + category.
 *   • AI generate     → ADMIN_TIER. Payload is `.strict()` server-side, so only
 *                       title/category/difficulty are sent (NOT description).
 *
 * Generation is asynchronous on the server; this screen kicks it off and sends
 * the user to AI Activity to watch it.
 */
export default function CreateCourseScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <CreateCourse />
    </RouteGuard>
  );
}

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
];

function CreateCourse() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('BEGINNER');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'manual' | 'ai' | null>(null);

  const canGenerate = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const canSubmit = title.trim().length > 0 && category.trim().length > 0 && pending === null;

  const createManual = async () => {
    if (!canSubmit) return;
    setPending('manual');
    setError(null);
    try {
      const { data } = await api.post<CourseResponse>('/training/courses', {
        title: title.trim(),
        category: category.trim(),
        difficulty,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
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
      // generateCourseSchema is `.strict()` — send only accepted fields.
      await api.post('/training/courses/generate', {
        title: title.trim(),
        category: category.trim(),
        difficulty,
      });
      invalidate('training');
      router.replace('/(app)/training/ai-activity');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start generation.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen edges={['top', 'bottom']}>
        <PageTopBar title="New course" showBack />
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
                required
              />
              <SelectInput
                label="Difficulty"
                value={difficulty}
                options={DIFFICULTIES}
                onChange={setDifficulty}
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
                  Builds an outline, lesson bodies and quizzes from the title and category. This
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
