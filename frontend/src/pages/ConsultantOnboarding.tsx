import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';

interface FormData {
  visa_status: string;
  current_location: string;
  preferred_locations: string;
  primary_skill: string;
  total_experience_years: number;
  relocation: boolean;
  remote_only: boolean;
  expected_rate: number;
  linkedin_url: string;
  github_url: string;
  notes: string;
}

// Common engagement / employment models recruiters look for.
const POSITION_OPTIONS = [
  'Full-Time',
  'W2',
  'C2C',
  '1099',
  'Contract',
  'Contract-to-Hire',
  'Part-Time',
  'Internship',
];

export function ConsultantOnboarding() {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormData>();
  const { refreshProfile } = useAuth();
  const nav = useNavigate();
  const [desired, setDesired] = useState<string[]>(['Full-Time']);

  function toggle(p: string) {
    setDesired((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function submit(data: FormData) {
    try {
      await api.post('/consultants/onboard', {
        ...data,
        total_experience_years: Number(data.total_experience_years) || 0,
        expected_rate: Number(data.expected_rate) || 0,
        preferred_locations:
          data.preferred_locations
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean) ?? [],
        desired_positions: desired,
      });
      toast.success('Profile saved');
      await refreshProfile();
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Layout title="Consultant onboarding">
      <form
        onSubmit={handleSubmit(submit)}
        className="bg-surface rounded-xl border border-border p-6 max-w-3xl mx-auto"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-ink">Welcome — tell us about your profile</h2>
          <p className="text-sm text-muted mt-1">
            These fields drive your job recommendations and vendor pitch.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectInput
            label="Visa status"
            {...register('visa_status')}
            options={[
              { value: 'USC', label: 'US Citizen' },
              { value: 'GC', label: 'Green Card' },
              { value: 'H1B', label: 'H-1B' },
              { value: 'OPT', label: 'OPT/CPT' },
              { value: 'OTHER', label: 'Other' },
            ]}
            placeholder="Select…"
          />
          <FormInput label="Current location" {...register('current_location')} />
          <FormInput
            label="Preferred locations (comma separated)"
            {...register('preferred_locations')}
          />
          <FormInput label="Primary skill" {...register('primary_skill')} />
          <FormInput
            label="Total experience (years)"
            type="number"
            step="0.5"
            {...register('total_experience_years')}
          />
          <FormInput
            label="Expected rate / hour ($)"
            type="number"
            {...register('expected_rate')}
          />
          <FormInput label="LinkedIn URL" {...register('linkedin_url')} />
          <FormInput label="GitHub URL" {...register('github_url')} />
          <label className="flex items-center gap-2 text-sm bg-hover rounded-lg px-3 py-2 border border-border cursor-pointer hover:border-border">
            <input
              type="checkbox"
              {...register('relocation')}
              className="rounded border-border text-brand-600 focus:ring-brand-500/30"
            />{' '}
            Open to relocation
          </label>
          <label className="flex items-center gap-2 text-sm bg-hover rounded-lg px-3 py-2 border border-border cursor-pointer hover:border-border">
            <input
              type="checkbox"
              {...register('remote_only')}
              className="rounded border-border text-brand-600 focus:ring-brand-500/30"
            />{' '}
            Remote only
          </label>
        </div>

        {/* Desired positions — multi-select chips */}
        <div className="mt-6">
          <label className="block text-xs font-medium text-ink mb-1">Desired positions</label>
          <p className="text-xs text-muted mb-2">
            Pick all employment types you're open to. Recruiters filter against this.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {POSITION_OPTIONS.map((p) => {
              const active = desired.includes(p);
              return (
                <Button
                  key={p}
                  type="button"
                  variant={active ? 'primary' : 'outline'}
                  size="sm"
                  pill
                  onClick={() => toggle(p)}
                >
                  {active ? '✓ ' : ''}
                  {p}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <label className="block text-xs font-medium text-ink mb-1.5">Notes</label>
          <textarea
            placeholder="Anything else recruiters should know"
            {...register('notes')}
            className="w-full rounded-lg border border-border hover:border-muted bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            rows={3}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            Save and continue
          </Button>
        </div>
      </form>
    </Layout>
  );
}
