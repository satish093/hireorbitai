import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { MyResumeCard } from '../components/resumes/MyResumeCard';
import { AlertFilters } from '../components/jobs/AlertFilters';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

/**
 * CONSULTANT-only self-service resume page. The same MyResumeCard component is
 * rendered on the consultant dashboard, but several consultants asked for a
 * dedicated nav entry so they don't have to scroll the dashboard to find it.
 *
 * Backend access: every resume endpoint funnels through authorizeConsultantAccess,
 * which scopes a CONSULTANT to their OWN consultant row only. The frontend
 * route gate (allow={['CONSULTANT']}) is the first line of defense.
 */
export function MyResume() {
  const { profile } = useAuth();
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    api
      .get('/consultants')
      .then((r) => {
        if (cancelled) return;
        const me = (r.data ?? []).find((c: { user_id?: string }) => c.user_id === profile.id);
        setConsultantId(me?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load your profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Key on user id only — depending on the full profile would re-fire on every
    // silent token refresh even though `id` is the only field we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return (
    <Layout title="My resume">
      <PageHeader
        title="My resume"
        description="Upload your resume so your recruiter can submit you to roles. PDF, Word (.doc/.docx), or image — up to 10 MB."
      />
      {loading ? (
        <SkeletonCard />
      ) : !consultantId ? (
        <EmptyState
          title="Finish onboarding first"
          description="Your recruiter needs to finish setting you up before you can upload a resume."
        />
      ) : (
        <div className="space-y-4">
          <MyResumeCard consultantId={consultantId} />
          {/* Daily match-email controls — the consultant-reachable home for
              job alerts (the /jobs page is operator-tier only). */}
          <AlertFilters />
        </div>
      )}
    </Layout>
  );
}
