import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { FeatureGuard } from './hooks/useFeatureFlags';
import { RealtimeNotifications } from './components/RealtimeNotifications';
import { ProductTour } from './components/ProductTour';
import { useAuth } from './context/AuthContext';
import { ADMIN_TIER, MANAGER_TIER, OPERATOR_TIER, OWNER_TIER } from './types';

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
const Vendors = lazy(() => import('./pages/Vendors').then((m) => ({ default: m.Vendors })));
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })));
const Reminders = lazy(() => import('./pages/Reminders').then((m) => ({ default: m.Reminders })));
const AIEmail = lazy(() => import('./pages/AIEmail').then((m) => ({ default: m.AIEmail })));
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
  return (
    <div className="min-h-dvh flex items-center justify-center text-muted text-sm">Loading…</div>
  );
}

function DashboardRouter() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role === 'CONSULTANT') return <ConsultantDashboard />;
  if (profile.role === 'RECRUITER') return <RecruiterDashboard />;
  // Everyone manager-and-above lands on the manager dashboard.
  return <ManagerDashboard />;
}

export default function App() {
  // Keep a single realtime subscription alive for the signed-in user across
  // route changes. Keyed by user id so it remounts (reconnects) on a switch
  // of identity and unmounts on sign-out.
  const { profile } = useAuth();
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

        <Route
          path="/onboarding/consultant"
          element={
            <ProtectedRoute bypassOnboarding>
              <ConsultantOnboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding/recruiter"
          element={
            <ProtectedRoute bypassOnboarding>
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
          path="/jobs"
          element={
            <ProtectedRoute>
              <JobSearch />
            </ProtectedRoute>
          }
        />
        <Route
          path="/jobs/:id"
          element={
            <ProtectedRoute>
              <JobDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/applications"
          element={
            <ProtectedRoute>
              <Applications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/interviews"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="interviews">
                <Interviews />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <Calendar />
            </ProtectedRoute>
          }
        />
        <Route
          path="/resumes"
          element={
            <ProtectedRoute>
              <Resumes />
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
            <ProtectedRoute>
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
          path="/reports"
          element={
            <ProtectedRoute allow={MANAGER_TIER}>
              <FeatureGuard feature="reports">
                <Reports />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invitations"
          element={
            <ProtectedRoute allow={MANAGER_TIER}>
              <Invitations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="tasks">
                <Tasks />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks/me"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="tasks">
                <TasksAssignedToMe />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks/:id"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="tasks">
                <TaskDetail />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="messages">
                <Messages />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/features"
          element={
            <ProtectedRoute allow={OWNER_TIER}>
              <FeatureFlags />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/groups"
          element={
            <ProtectedRoute allow={MANAGER_TIER}>
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
            <ProtectedRoute allow={ADMIN_TIER}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <ProtectedRoute allow={ADMIN_TIER}>
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
            <ProtectedRoute>
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
            <ProtectedRoute>
              <FeatureGuard feature="training">
                <LessonViewer />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/training/assignments/:id/plan"
          element={
            <ProtectedRoute>
              <FeatureGuard feature="training">
                <TrainingPlanView />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/training/assignments/:id/quiz"
          element={
            <ProtectedRoute>
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

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
