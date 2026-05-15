import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { FeatureGuard } from './hooks/useFeatureFlags';
import { useAuth } from './context/AuthContext';
import { ADMIN_TIER, MANAGER_TIER, OPERATOR_TIER, OWNER_TIER } from './types';

import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ChangePassword } from './pages/ChangePassword';
import { Unauthorized } from './pages/Unauthorized';
import { AcceptInvitation } from './pages/AcceptInvitation';
import { ConsultantOnboarding } from './pages/ConsultantOnboarding';
import { RecruiterOnboarding } from './pages/RecruiterOnboarding';
import { ManagerDashboard } from './pages/ManagerDashboard';
import { RecruiterDashboard } from './pages/RecruiterDashboard';
import { ConsultantDashboard } from './pages/ConsultantDashboard';
import { Consultants } from './pages/Consultants';
import { Recruiters } from './pages/Recruiters';
import { JobSearch } from './pages/JobSearch';
import { Applications } from './pages/Applications';
import { Interviews } from './pages/Interviews';
import { Calendar } from './pages/Calendar';
import { Resumes } from './pages/Resumes';
import { Vendors } from './pages/Vendors';
import { Clients } from './pages/Clients';
import { Reminders } from './pages/Reminders';
import { AIEmail } from './pages/AIEmail';
import { Reports } from './pages/Reports';
import { Invitations } from './pages/Invitations';
import { Tasks } from './pages/Tasks';
import { TaskDetail } from './pages/TaskDetail';
import { TasksAssignedToMe } from './pages/TasksAssignedToMe';
import { Messages } from './pages/Messages';
import { FeatureFlags } from './pages/FeatureFlags';
import { UserGroups } from './pages/UserGroups';
import { UserProfile } from './pages/UserProfile';
import { ResetPassword } from './pages/ResetPassword';
import { DeactivatedAccounts } from './pages/DeactivatedAccounts';
import { AdminUsers } from './pages/AdminUsers';
import { AdminUserDetail } from './pages/AdminUserDetail';
import { TrainingDashboard } from './pages/TrainingDashboard';
import { TrainingCourses } from './pages/TrainingCourses';
import { CreateTrainingCourse } from './pages/CreateTrainingCourse';
import { EditTrainingCourse } from './pages/EditTrainingCourse';
import { TrainingCourseDetails } from './pages/TrainingCourseDetails';
import { TrainingAssignments } from './pages/TrainingAssignments';
import { MyTraining } from './pages/MyTraining';
import { TrainingReports } from './pages/TrainingReports';
import { LessonViewer } from './pages/LessonViewer';
import { QuizPage } from './pages/QuizPage';
import { TrainingPlanView } from './pages/TrainingPlanView';

function DashboardRouter() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role === 'CONSULTANT') return <ConsultantDashboard />;
  if (profile.role === 'RECRUITER') return <RecruiterDashboard />;
  // Everyone manager-and-above lands on the manager dashboard.
  return <ManagerDashboard />;
}

export default function App() {
  return (
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
            <AdminUserDetail />
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
          <ProtectedRoute allow={MANAGER_TIER}>
            <FeatureGuard feature="training">
              <TrainingDashboard />
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
      <Route
        path="/training/my"
        element={
          <ProtectedRoute>
            <FeatureGuard feature="training">
              <MyTraining />
            </FeatureGuard>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
