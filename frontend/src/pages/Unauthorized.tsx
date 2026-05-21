import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useAuth } from '../context/AuthContext';

/**
 * Shown when a user with a valid session hits a route they don't have a role
 * for. Distinct from /login — they ARE signed in, just not allowed here.
 */
export function Unauthorized() {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-dvh bg-hover flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <Brand size="lg" />
        </div>
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 dark:bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 text-2xl">
            ⚠
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink mt-3">
            You don't have access
          </h1>
          <p className="text-sm text-muted mt-2">
            {profile ? (
              <>
                Your role (<span className="font-medium">{profile.role}</span>) isn't allowed on
                this page. Ask an admin if you need access.
              </>
            ) : (
              <>This page requires a role you don't have.</>
            )}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link
              to="/dashboard"
              className="bg-ink hover:opacity-90 text-bg text-sm px-4 py-2 rounded-lg press"
            >
              Go to dashboard
            </Link>
            <button
              onClick={signOut}
              className="bg-surface border border-border hover:bg-hover text-ink text-sm px-4 py-2 rounded-lg press"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
