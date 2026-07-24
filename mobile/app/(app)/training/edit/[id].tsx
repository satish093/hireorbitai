import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Banner } from '../../../../src/components/ui/Screen';
import { Card, SectionHeader } from '../../../../src/components/ui/Card';
import { Button } from '../../../../src/components/ui/Button';
import { FormInput } from '../../../../src/components/ui/Inputs';
import { ConfirmSheet } from '../../../../src/components/ui/Sheet';
import { SkeletonCard } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery } from '../../../../src/hooks/useApi';
import { invalidate } from '../../../../src/hooks/useInvalidate';
import { api, apiErrorMessage } from '../../../../src/services/api';
import { MANAGER_TIER, type TrainingCourse } from '../../../../src/types';
import { useTheme } from '../../../../src/theme';

/**
 * Edit a course — metadata, publish, delete.
 *
 * MANAGER_TIER.
 *
 * Scope note: this edits COURSE METADATA and lifecycle. Authoring lesson bodies
 * is not here — a lesson body runs to thousands of words (the generated content
 * SQL files are 40–70 KB per course) and a phone is the wrong tool for writing
 * one. Publishing, renaming, recategorising and deleting are the actions people
 * genuinely need away from a desk, and those are all here.
 */
export default function EditCourseScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <EditCourse />
    </RouteGuard>
  );
}

function EditCourse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const course = useApiQuery<TrainingCourse>(id ? `/training/courses/${id}` : null, {
    channel: 'training',
    enabled: !!id,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!course.data) return;
    setTitle(course.data.title ?? '');
    setDescription(course.data.description ?? '');
    setCategory(course.data.category ?? '');
  }, [course.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!title.trim()) return;
    setBusy('save');
    setError(null);
    try {
      // Only the three editable fields — never a spread of local state, so a
      // server-controlled column can't ride along.
      await api.patch(`/training/courses/${id}`, {
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
      });
      invalidate('training');
      await course.refetch();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the course.'));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy('publish');
    setError(null);
    try {
      await api.post(`/training/courses/${id}/publish`, {});
      invalidate('training');
      await course.refetch();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not publish the course.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await api.delete(`/training/courses/${id}`);
      invalidate('training');
      router.replace('/(app)/training/courses');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete the course.'));
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Edit course' }} />
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

            {course.loading && !course.data ? (
              <SkeletonCard />
            ) : (
              <>
                <Card>
                  <SectionHeader title="Details" />
                  <FormInput label="Title" value={title} onChangeText={setTitle} required />
                  <FormInput label="Category" value={category} onChangeText={setCategory} />
                  <FormInput
                    label="Description"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                  />
                  <Button
                    label="Save changes"
                    onPress={save}
                    disabled={!title.trim() || busy !== null}
                    loading={busy === 'save'}
                  />
                </Card>

                <Card>
                  <SectionHeader title="Lesson content" />
                  <Text style={{ fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 }}>
                    Lesson bodies run to thousands of words. Write them on the web console — this
                    screen covers naming, publishing and removal.
                  </Text>
                  <View style={{ marginTop: spacing.md }}>
                    <Button
                      label="View lessons"
                      href={`/(app)/training/course/${id}`}
                      variant="secondary"
                    />
                  </View>
                </Card>

                {!course.data?.is_published ? (
                  <Card>
                    <SectionHeader
                      title="Publish"
                      subtitle="Makes the course assignable to your team."
                    />
                    <Button
                      label="Publish course"
                      onPress={publish}
                      loading={busy === 'publish'}
                      disabled={busy !== null}
                    />
                  </Card>
                ) : null}

                <Button
                  label="Delete course"
                  variant="danger"
                  onPress={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        pending={busy === 'delete'}
        destructive
        title="Delete this course?"
        message="Lessons, quizzes and every learner's progress on it go too. This cannot be undone."
        confirmLabel="Delete permanently"
      />
    </>
  );
}
