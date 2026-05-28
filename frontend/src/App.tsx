import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoadingScreen } from './components/LoadingScreen';
import { AppChrome } from './components/AppChrome';
import { FeatureGuard } from './hooks/useFeatureFlags';
import { RealtimeNotifications } from './components/RealtimeNotifications';
import { ProductTour } from './components/ProductTour';
import { useAuth } from './context/AuthContext';
import { useSessionRevoke } from './hooks/useSessionRevoke';
import { config } from './config/env';
import {
  ADMIN_TIER,
  MANAGER_TIER,
  OPERATOR_TIER,
  BUSINESS_ROLES,
  MESSAGING_ROLES,
  hasCapability,
} from './types';

// DEV-ONLY test panel. Gated by the build-time flag VITE_DEV_TOOLS so the
// import lands in a dead branch and is tree-shaken out of production builds
// (verified by scripts/check-dist-clean.mjs). The dev deploy sets the flag.
const DevPanel =
  import.meta.env.VITE_DEV_TOOLS === 'true'
    ? lazy(() => import('./dev/DevPanel').then((m) => ({ default: m.DevPanel })))
    : null;

// ---------------------------------------------------------------------------
// Route-level code splitting.
//
// The auth pages stay in the main chunk — they're pre-auth and loaded on first
// paint, so async-loading them would only add a network round-trip.
//
// The three role dashboards are lazy-loaded individually so a signed-in user
// only downloads the dashboard for THEIR role — a consultant never fetches the
// manager/recruiter dashboard code, and vice versa. Same for the two
// role-specific onboarding flows.
//
// Every other route is lazy-loaded too. Vite turns each lazy() call into its
// own dynamic-import chunk, which knocks the initial bundle down from ~688
// kB to a much smaller shell. Suspense renders a low-key fallback while the
// chunk is fetched.
// ---------------------------------------------------------------------------
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ChangePassword } from './pages/ChangePassword';
import { Unauthorized } from './pages/Unauthorized';
import { AcceptInvitation } from './pages/AcceptInvitation';
import { ResetPassword } from './pages/ResetPassword';

const ConsultantOnboarding = lazy(() =>
  import('./pages/ConsultantOnboarding').then((m) => ({ default: m.ConsultantOnboarding })),
);
const RecruiterOnboarding = lazy(() =>
  import('./pages/RecruiterOnboarding').then((m) => ({ default: m.RecruiterOnboarding })),
);
const ManagerDashboard = lazy(() =>
  import('./pages/ManagerDashboard').then((m) => ({ default: m.ManagerDashboard })),
);
const RecruiterDashboard = lazy(() =>
  import('./pages/RecruiterDashboard').then((m) => ({ default: m.RecruiterDashboard })),
);
const ConsultantDashboard = lazy(() =>
  import('./pages/ConsultantDashboard').then((m) => ({ default: m.ConsultantDashboard })),
);

// Talent + network pages.
const Consultants = lazy(() =>
  import('./pages/Consultants').then((m) => ({ default: m.Consultants })),
);
const Recruiters = lazy(() =>
  import('./pages/Recruiters').then((m) => ({ default: m.Recruiters })),
);
const Managers = lazy(() => import('./pages/Managers').then((m) => ({ default: m.Managers })));
const JobSearch = lazy(() => import('./pages/JobSearch').then((m) => ({ default: m.JobSearch })));
const JobDetail = lazy(() => import('./pages/JobDetail').then((m) => ({ default: m.JobDetail })));
const Applications = lazy(() =>
  import('./pages/Applications').then((m) => ({ default: m.Applications })),
);
const Interviews = lazy(() =>
  import('./pages/Interviews').then((m) => ({ default: m.Interviews })),
);
const Calendar = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.Calendar })));
const Resumes = lazy(() => import('./pages/Resumes').then((m) => ({ default: m.Resumes })));
const MyResume = lazy(() => import('./pages/MyResume').then((m) => ({ default: m.MyResume })));
const Vendors = lazy(() => import('./pages/Vendors').then((m) => ({ default: m.Vendors })));
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })));
const Reminders = lazy(() => import('./pages/Reminders').then((m) => ({ default: m.Reminders })));
const AIEmail = lazy(() => import('./pages/AIEmail').then((m) => ({ default: m.AIEmail })));
const AIUsage = lazy(() => import('./pages/AIUsage').then((m) => ({ default: m.AIUsage })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Invitations = lazy(() =>
  import('./pages/Invitations').then((m) => ({ default: m.Invitations })),
);

// Tasks module.
const Tasks = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const TaskDetail = lazy(() =>
  import('./pages/TaskDetail').then((m) => ({ default: m.TaskDetail })),
);
const TasksAssignedToMe = lazy(() =>
  import('./pages/TasksAssignedToMe').then((m) => ({ default: m.TasksAssignedToMe })),
);

// Messaging.
const Messages = lazy(() => import('./pages/Messages').then((m) => ({ default: m.Messages })));

// Admin module — admin-only routes, so the chunk only loads for admins.
const FeatureFlags = lazy(() =>
  import('./pages/FeatureFlags').then((m) => ({ default: m.FeatureFlags })),
);
const UserGroups = lazy(() =>
  import('./pages/UserGroups').then((m) => ({ default: m.UserGroups })),
);
const UserProfile = lazy(() =>
  import('./pages/UserProfile').then((m) => ({ default: m.UserProfile })),
);
const DeactivatedAccounts = lazy(() =>
  import('./pages/DeactivatedAccounts').then((m) => ({ default: m.DeactivatedAccounts })),
);
const AdminUsers = lazy(() =>
  import('./pages/AdminUsers').then((m) => ({ default: m.AdminUsers })),
);
const AdminAISettings = lazy(() =>
  import('./pages/AdminAISettings').then((m) => ({ default: m.AdminAISettings })),
);
const AdminAuditLog = lazy(() =>
  import('./pages/AdminAuditLog').then((m) => ({ default: m.AdminAuditLog })),
);
const TrainingAIActivity = lazy(() =>
  import('./pages/TrainingAIActivity').then((m) => ({ default: m.TrainingAIActivity })),
);
/** Legacy /admin/users/:id now opens the detail pane on the list page. */
function AdminUserRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/admin/users?user=${id}` : '/admin/users'} replace />;
}

// Training module — heavy, lots of sub-pages. Loads only when a training
// route is hit.
const TrainingCourses = lazy(() =>
  import('./pages/TrainingCourses').then((m) => ({ default: m.TrainingCourses })),
);
const CreateTrainingCourse = lazy(() =>
  import('./pages/CreateTrainingCourse').then((m) => ({ default: m.CreateTrainingCourse })),
);
const EditTrainingCourse = lazy(() =>
  import('./pages/EditTrainingCourse').then((m) => ({ default: m.EditTrainingCourse })),
);
const TrainingCourseDetails = lazy(() =>
  import('./pages/TrainingCourseDetails').then((m) => ({ default: m.TrainingCourseDetails })),
);
const TrainingAssignments = lazy(() =>
  import('./pages/TrainingAssignments').then((m) => ({ default: m.TrainingAssignments })),
);
const MyTraining = lazy(() =>
  import('./pages/MyTraining').then((m) => ({ default: m.MyTraining })),
);
const TrainingReports = lazy(() =>
  import('./pages/TrainingReports').then((m) => ({ default: m.TrainingReports })),
);
const LessonViewer = lazy(() =>
  import('./pages/LessonViewer').then((m) => ({ default: m.LessonViewer })),
);
const QuizPage = lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage })));
const TrainingPlanView = lazy(() =>
  import('./pages/TrainingPlanView').then((m) => ({ default: m.TrainingPlanView })),
);

/** Suspense fallback used while a route chunk is being fetched. Intentionally
 *  minimal so it doesn't flash a heavy spinner on fast loads. */
function RouteFallback() {
  return <LoadingScreen />;
}

/** Minimal landing for a DEVELOPER with no obvious capability home. The manager
 *  dashboard would fire manager-only data calls (now 403/empty for DEVELOPER),
 *  so we show a neutral page and let them pick a granted area from the nav. */
function DeveloperHome() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-2 text-center px-6">
      <h1 className="text-lg font-semibold text-ink">Developer account</h1>
      <p className="text-sm text-muted max-w-md">
        Your access is scoped to the capabilities granted to you. Choose a permitted area from the
        navigation to get started.
      </p>
    </div>
  );
}

function DashboardRouter() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role === 'CONSULTANT') return <ConsultantDashboard />;
  if (profile.role === 'RECRUITER') return <RecruiterDashboard />;
  // DEVELOPER has no default business dashboard — never the ManagerDashboard
  // (its data calls are manager-scoped). Route to a granted capability area if
  // there is an obvious one, otherwise a neutral landing.
  if (profile.role === 'DEVELOPER') {
    if (hasCapability(profile, 'users')) return <Navigate to="/admin/users" replace />;
    if (hasCapability(profile, 'reports')) return <Navigate to="/reports" replace />;
    return <DeveloperHome />;
  }
  // Everyone manager-and-above (incl. the group leads HR_MANAGER + MANAGER)
  // lands on the manager dashboard.
  return <ManagerDashboard />;
}

export default function App() {
  // Keep a single realtime subscription alive for the signed-in user across
  // route changes. Keyed by user id so it remounts (reconnects) on a switch
  // of identity and unmounts on sign-out.
  const { profile } = useAuth();
  // Single-device enforcement: if the same account logs in elsewhere, the
  // backend pushes session:revoked and this hook redirects to /login.
  useSessionRevoke();

  // Preload every page chunk as soon as the user is authenticated so all
  // subsequent nav clicks are instant (no loading flash). The imports run in
  // the background — the browser fetches and caches the JS bundles without
  // blocking the current render. React.lazy reuses the same module promise,
  // so by the time the user clicks a link the chunk is already resolved.
  useEffect(() => {
    if (!profile?.id) return;
    void import('./pages/Tasks');
    void import('./pages/TaskDetail');
    void import('./pages/TasksAssignedToMe');
    void import('./pages/Messages');
    void import('./pages/ManagerDashboard');
    void import('./pages/RecruiterDashboard');
    void import('./pages/ConsultantDashboard');
    void import('./pages/Consultants');
    void import('./pages/Recruiters');
    void import('./pages/Managers');
    void import('./pages/JobSearch');
    void import('./pages/JobDetail');
    void import('./pages/Applications');
    void import('./pages/Interviews');
    void import('./pages/Calendar');
    void import('./pages/Resumes');
    void import('./pages/MyResume');
    void import('./pages/Vendors');
    void import('./pages/Clients');
    void import('./pages/Reminders');
    void import('./pages/AIEmail');
    void import('./pages/AIUsage');
    void import('./pages/Reports');
    void import('./pages/Invitations');
    void import('./pages/FeatureFlags');
    void import('./pages/UserGroups');
    void import('./pages/UserProfile');
    void import('./pages/DeactivatedAccounts');
    void import('./pages/AdminUsers');
    void import('./pages/TrainingCourses');
    void import('./pages/CreateTrainingCourse');
    void import('./pages/EditTrainingCourse');
    void import('./pages/TrainingCourseDetails');
    void import('./pages/TrainingAssignments');
    void import('./pages/MyTraining');
    void import('./pages/TrainingReports');
    void import('./pages/LessonViewer');
    void import('./pages/QuizPage');
    void import('./pages/TrainingPlanView');
  }, [profile?.id]);

  return (
    <Suspense fallback={<RouteFallback />}>
      {profile?.id && <RealtimeNotifications key={profile.id} />}
      {profile?.id && <ProductTour />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/invite/accept" element={<AcceptInvitation />} />

        {/* Forced password change — protected so we know who's rotating, but
          bypasses the must_change_password gate to avoid an infinite redirect. */}
        <Route
          path="/change-password"
          element={
            <ProtectedRoute bypassPasswordChange bypassOnboarding>
              <ChangePassword />
            </ProtectedRoute>
          }
        />

        {/* Persistent app shell — the sidebar lives in <AppChrome> and stays
            mounted across every navigation below (no more reload/scroll jump). */}
        <Route element={<AppChrome />}>
          <Route
            path="/onboarding/consultant"
            element={
              <ProtectedRoute allow={['CONSULTANT']} bypassOnboarding>
                <ConsultantOnboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding/recruiter"
            element={
              <ProtectedRoute allow={['RECRUITER']} bypassOnboarding>
                <RecruiterOnboarding />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardRouter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/consultants"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <Consultants />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recruiters"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <Recruiters />
              </ProtectedRoute>
            }
          />
          <Route
            path="/managers"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <Managers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <JobSearch />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <JobDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/applications"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <Applications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/interviews"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="interviews">
                  <Interviews />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <Calendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/resumes"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <Resumes />
              </ProtectedRoute>
            }
          />
          {/* Consultant self-service: a dedicated page so the resume upload is
              one click from the sidebar, not buried on the dashboard. */}
          <Route
            path="/my-resume"
            element={
              <ProtectedRoute allow={['CONSULTANT']}>
                <MyResume />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vendors"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <Vendors />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <Clients />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reminders"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="reminders">
                  <Reminders />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai-email"
            element={
              <ProtectedRoute allow={OPERATOR_TIER}>
                <FeatureGuard feature="ai_email">
                  <AIEmail />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai-usage"
            element={
              <ProtectedRoute allow={MANAGER_TIER} capability="ai_usage">
                <AIUsage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              // RECRUITER may open /reports for their OWN submissions + daily
              // numbers (backend gates each endpoint and self-scopes the rows
              // inside the controller). The page itself filters the visible
              // tabs to "Submissions" + "Daily log" for a recruiter — full
              // analytics tabs stay manager-tier only.
              <ProtectedRoute allow={OPERATOR_TIER} capability="reports">
                <FeatureGuard feature="reports">
                  <Reports />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/invitations"
            element={
              <ProtectedRoute allow={OPERATOR_TIER} capability="invitations">
                <Invitations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tasks"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="tasks">
                  <Tasks />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tasks/me"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="tasks">
                  <TasksAssignedToMe />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tasks/:id"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="tasks">
                  <TaskDetail />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/messages"
            element={
              // MESSAGING_ROLES (= BUSINESS_ROLES + DEVELOPER) is the ONE
              // exception that admits DEVELOPER, so every user can reach a
              // developer for bug/error reporting and the developer can reply.
              // Every other business route stays BUSINESS_ROLES.
              <ProtectedRoute allow={MESSAGING_ROLES}>
                <FeatureGuard feature="messages">
                  <Messages />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ai-settings"
            element={
              <ProtectedRoute allow={ADMIN_TIER}>
                <AdminAISettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-log"
            element={
              <ProtectedRoute allow={ADMIN_TIER}>
                <AdminAuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/ai-activity"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <TrainingAIActivity />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/features"
            element={
              // Read access opens to ADMIN_TIER (CTO + Director need
              // visibility into flag state) plus a DEVELOPER with the
              // `feature_flags` capability. The PAGE itself disables
              // write controls for non-OWNER_TIER callers and the
              // backend rejects PATCH/PUT regardless of capability, so
              // a CTO / Director / Developer here can only look.
              <ProtectedRoute allow={ADMIN_TIER} capability="feature_flags">
                <FeatureFlags />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/groups"
            element={
              <ProtectedRoute allow={ADMIN_TIER} capability="user_groups">
                <UserGroups />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/deactivated"
            element={
              <ProtectedRoute allow={ADMIN_TIER}>
                <DeactivatedAccounts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allow={ADMIN_TIER} capability="users">
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users/:id"
            element={
              <ProtectedRoute allow={ADMIN_TIER} capability="users">
                <AdminUserRedirect />
              </ProtectedRoute>
            }
          />
          {/* Profile page. Access is controlled server-side: operator-tier sees everyone,
          consultants only see their own. */}
          <Route
            path="/users/:id"
            element={
              <ProtectedRoute>
                <UserProfile />
              </ProtectedRoute>
            }
          />

          {/* Training / LMS module. Manager-tier manages courses; everyone authed
          can view their own assignments under /training/my. */}
          <Route
            path="/training"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="training">
                  <MyTraining />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/courses"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <TrainingCourses />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/courses/new"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <CreateTrainingCourse />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/courses/:id"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <TrainingCourseDetails />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/courses/:id/edit"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <EditTrainingCourse />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/assignments"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <TrainingAssignments />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/assignments/:id"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="training">
                  <LessonViewer />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/assignments/:id/plan"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="training">
                  <TrainingPlanView />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/assignments/:id/quiz"
            element={
              <ProtectedRoute allow={BUSINESS_ROLES}>
                <FeatureGuard feature="training">
                  <QuizPage />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/training/reports"
            element={
              <ProtectedRoute allow={MANAGER_TIER}>
                <FeatureGuard feature="training">
                  <TrainingReports />
                </FeatureGuard>
              </ProtectedRoute>
            }
          />
          {/* Legacy student route — folded into the unified /training workspace. */}
          <Route path="/training/my" element={<Navigate to="/training" replace />} />
          <Route path="/training/my/*" element={<Navigate to="/training" replace />} />

          {/* DEV-ONLY super-admin test panel. Registered only in dev builds with
              VITE_DEV_TOOLS on; tree-shaken from production. */}
          {config.isDevTools && DevPanel && (
            <Route
              path="/dev"
              element={
                <ProtectedRoute allow={['SUPER_ADMIN']}>
                  <DevPanel />
                </ProtectedRoute>
              }
            />
          )}

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
