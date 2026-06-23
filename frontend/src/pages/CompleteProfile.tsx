import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { FormInput } from '../components/FormInput';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface FormData {
  first_name: string;
  last_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  linkedin_url: string;
}

const REQUIRED = 'Required';

/**
 * Mandatory profile-completion form. Reached via ProtectedRoute when a non-admin
 * user has any required field blank (name, phone, address, LinkedIn). Pre-fills
 * whatever is already set so a partial profile only needs the gaps filled.
 * Saves through the standard self-update path (PATCH /users/:id).
 */
export function CompleteProfile() {
  const { profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    defaultValues: {
      first_name: profile?.first_name ?? '',
      last_name: profile?.last_name ?? '',
      phone: profile?.phone ?? '',
      address_line1: profile?.address_line1 ?? '',
      address_line2: profile?.address_line2 ?? '',
      city: profile?.city ?? '',
      state: profile?.state ?? '',
      postal_code: profile?.postal_code ?? '',
      country: profile?.country ?? '',
      linkedin_url: profile?.linkedin_url ?? '',
    },
  });

  async function submit(data: FormData) {
    if (!profile) return;
    try {
      await api.patch(`/users/${profile.id}`, {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        phone: data.phone.trim(),
        address_line1: data.address_line1.trim(),
        address_line2: data.address_line2.trim() || null,
        city: data.city.trim(),
        state: data.state.trim(),
        postal_code: data.postal_code.trim(),
        country: data.country.trim(),
        linkedin_url: data.linkedin_url.trim(),
      });
      toast.success('Profile completed');
      await refreshProfile();
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Layout title="Complete your profile">
      <form
        onSubmit={handleSubmit(submit)}
        className="bg-surface rounded-xl border border-border p-6 max-w-2xl mx-auto space-y-5"
      >
        <div>
          <h2 className="text-lg font-semibold text-ink">Complete your profile</h2>
          <p className="text-sm text-muted mt-1">
            These details are required before you can continue. They take a minute to fill in.
          </p>
        </div>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
            Contact
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="First name"
              {...register('first_name', { required: REQUIRED })}
              error={errors.first_name?.message}
            />
            <FormInput
              label="Last name"
              {...register('last_name', { required: REQUIRED })}
              error={errors.last_name?.message}
            />
            <FormInput label="Email" value={profile?.email ?? ''} disabled />
            <FormInput
              label="Phone"
              placeholder="+1 555 123 4567"
              {...register('phone', { required: REQUIRED })}
              error={errors.phone?.message}
            />
            <div className="md:col-span-2">
              <FormInput
                label="LinkedIn URL"
                placeholder="https://www.linkedin.com/in/your-handle"
                {...register('linkedin_url', {
                  required: REQUIRED,
                  pattern: {
                    value: /^https?:\/\/.+/i,
                    message: 'Enter a full URL starting with https://',
                  },
                })}
                error={errors.linkedin_url?.message}
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">
            Address
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormInput
                label="Street address"
                {...register('address_line1', { required: REQUIRED })}
                error={errors.address_line1?.message}
              />
            </div>
            <div className="md:col-span-2">
              <FormInput label="Apt / Suite (optional)" {...register('address_line2')} />
            </div>
            <FormInput
              label="City"
              {...register('city', { required: REQUIRED })}
              error={errors.city?.message}
            />
            <FormInput
              label="State / Province"
              {...register('state', { required: REQUIRED })}
              error={errors.state?.message}
            />
            <FormInput
              label="Postal code"
              {...register('postal_code', { required: REQUIRED })}
              error={errors.postal_code?.message}
            />
            <FormInput
              label="Country"
              {...register('country', { required: REQUIRED })}
              error={errors.country?.message}
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            Save and continue
          </Button>
        </div>
      </form>
    </Layout>
  );
}
