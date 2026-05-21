import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { FormInput } from '../components/FormInput';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface FormData {
  full_name: string;
  phone: string;
  team: string;
  target_submissions_per_week: number;
  notes: string;
}

export function RecruiterOnboarding() {
  const { profile, refreshProfile } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    defaultValues: {
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      target_submissions_per_week: 10,
    },
  });
  const nav = useNavigate();

  async function submit(data: FormData) {
    try {
      await api.post('/recruiters/onboard', {
        full_name: data.full_name?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
        team: data.team?.trim() || undefined,
        target_submissions_per_week: Number(data.target_submissions_per_week) || 10,
        notes: data.notes?.trim() || undefined,
      });
      toast.success('Profile saved');
      await refreshProfile();
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Layout title="Recruiter onboarding">
      <form
        onSubmit={handleSubmit(submit)}
        className="bg-card rounded-xl border border-border p-6 max-w-2xl mx-auto space-y-5"
      >
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Welcome — let's finish your profile
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tell us who you are and a few details about your recruiting setup.
          </p>
        </div>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Personal details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Full name"
              {...register('full_name', { required: 'Required' })}
              error={errors.full_name?.message}
            />
            <FormInput
              label="Email"
              value={profile?.email ?? ''}
              disabled
              hint="Set when you accepted the invite — can't change here."
            />
            <FormInput label="Phone" placeholder="+1 555 123 4567" {...register('phone')} />
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Recruiting setup
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput label="Team / Pod" placeholder="e.g. Pod Alpha" {...register('team')} />
            <FormInput
              label="Weekly submission target"
              type="number"
              {...register('target_submissions_per_week')}
            />
          </div>
          <div className="mt-4">
            <label className="block text-xs font-medium text-foreground mb-1.5">Notes</label>
            <textarea
              placeholder="Time zone, focus areas, etc."
              {...register('notes')}
              rows={3}
              className="w-full rounded-lg border border-border hover:border-muted-foreground bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </section>

        <div className="flex justify-end">
          <button
            disabled={isSubmitting}
            className="h-10 bg-foreground text-background px-5 rounded-lg text-sm font-medium shadow-sm disabled:opacity-50 hover:opacity-90 transition"
          >
            {isSubmitting ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </form>
    </Layout>
  );
}
