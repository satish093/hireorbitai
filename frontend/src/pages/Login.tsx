import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FormInput } from '../components/FormInput';
import { Brand } from '../components/Brand';
import { useAuth } from '../context/AuthContext';

interface SigninForm {
  email: string;
  password: string;
}

export function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const signinForm = useForm<SigninForm>();

  async function onSignIn(data: SigninForm) {
    setBusy(true);
    try {
      const r = await signIn(data.email, data.password);
      // The backend tells us when a temp-password rotation is required —
      // route the user there and block dashboard access until it's done.
      if (r.must_change_password) {
        nav('/change-password', { replace: true });
        return;
      }
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      // Surface a generic message — anti-enumeration applies on the client too.
      const msg = e?.response?.data?.error ?? e?.message ?? 'Sign in failed';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-muted flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" />
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-7">
          <form onSubmit={signinForm.handleSubmit(onSignIn)} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Use your work email and password.
              </p>
            </div>

            <FormInput
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              {...signinForm.register('email', { required: 'Required' })}
              error={signinForm.formState.errors.email?.message}
            />
            <FormInput
              label="Password"
              type="password"
              autoComplete="current-password"
              {...signinForm.register('password', { required: 'Required' })}
              error={signinForm.formState.errors.password?.message}
            />

            <button
              disabled={busy}
              className="w-full bg-foreground hover:opacity-90 disabled:opacity-50 text-background rounded-lg py-2.5 text-sm font-medium press"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="flex items-center justify-between text-xs">
              <Link to="/forgot-password" className="text-brand-700 hover:underline">
                Forgot password?
              </Link>
              <span className="text-muted-foreground">Need an account? Ask an admin.</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
