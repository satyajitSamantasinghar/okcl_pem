import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DeadlineProvider } from './context/DeadlineContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';

// Pages
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';

// Shared
import ProfilePage from './pages/shared/ProfilePage/ProfilePage';

// Employee
import EmployeeDashboard from './pages/employee/EmployeeDashboard';
import MonthlyPlanPage from './pages/employee/MonthlyPlanPage';
import QuarterlyEvaluationPage from './pages/employee/QuarterlyEvaluationPage';
import YearlyPlanPage from './pages/employee/YearlyPlanPage';

// RA
import RADashboard from './pages/ra/RADashboard';
import RAMonthlyEvaluationPage from './pages/ra/RAMonthlyEvaluationPage';
import RAPendingEvaluationsPage from './pages/ra/RAPendingEvaluationsPage';
import RAQuarterlyEvaluationPage from './pages/ra/RAQuarterlyEvaluationPage';
import RAYearlyAppraisalPage from './pages/ra/RAYearlyAppraisalPage';
import RAEmployeeListPage from './pages/ra/RAEmployeeListPage';
import RAEmployeeDetailPage from './pages/ra/RAEmployeeDetailPage';
import RAQuarterlyDetailPage from './pages/ra/RAQuarterlyDetailPage';
import ExtendDeadlineManagementPage from './pages/ra/ExtendDeadlineManagementPage';

// HRD
import HRDDashboard from './pages/hrd/HRDDashboard';
import HRDYearlyAppraisalPage from './pages/hrd/HRDYearlyAppraisalPage';
import HRDEmployeeDetailPage from './pages/hrd/HRDEmployeeDetailPage';
import HRDEmployeeListPage from './pages/hrd/HRDEmployeeListPage';
import HRDMonthlyOverviewPage from './pages/hrd/HRDMonthlyOverviewPage';

// MD
import MDDashboard from './pages/md/MDDashboard';
import MDApprovalPage from './pages/md/MDApprovalPage';
import MDAuditPage from './pages/md/MDAuditPage';
import MDMonthlyOverviewPage from './pages/md/MDMonthlyOverviewPage';
import MDEmployeeListPage from './pages/md/MDEmployeeListPage';
import MDEmployeeDetailPage from './pages/md/MDEmployeeDetailPage';

// ── Smart redirect based on logged-in role and activeView ────────────────────
//  Uses activeView (not just user.role) so that a refreshed page respects the
//  last selected view context (stored in localStorage and restored by AuthContext).
// ─────────────────────────────────────────────────────────────────────────────
const HomeRedirect = () => {
  const { user, isAuthenticated, loading, activeView } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const rolePaths = {
    EMPLOYEE: '/employee',
    RA: '/ra',
    HRD: '/hrd',
    MD: '/md',
  };

  // Map active view to the correct landing path.
  // Special case: RA in EMPLOYEE view → /employee (EmployeeDashboard)
  //               MD in RA view       → /ra      (RADashboard scoped to MD's reportees)
  // Fallback to the user's base role path if activeView is not set.
  let destination;
  if (activeView === 'EMPLOYEE' && user.role === 'RA') {
    destination = '/employee';
  } else if (activeView === 'RA' && user.role === 'MD') {
    destination = '/ra';
  } else {
    destination = rolePaths[activeView] || rolePaths[user.role] || '/login';
  }

  return <Navigate to={destination} replace />;
};

function App() {
  return (
    <AuthProvider>
      <DeadlineProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: "'Inter', sans-serif",
              fontSize: '0.9rem',
              borderRadius: '10px',
              padding: '12px 16px',
            },
          }}
        />

        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Smart home redirect */}
          <Route path="/" element={<HomeRedirect />} />

          {/* ── Employee Routes ───────────────────────────────────────────────
              allowedRoles includes "RA" so that:
              - An RA in "Employee View" can navigate to /employee/* routes
              - All employee controllers scope by req.user.userId, so an RA
                only ever sees their own plans/achievements here — no leakage
              MD is NOT included: MD does not submit monthly plans or yearly plans
          ─────────────────────────────────────────────────────────────────── */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute allowedRoles={['EMPLOYEE', 'RA']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<EmployeeDashboard />} />
            <Route path="monthly-plan" element={<MonthlyPlanPage />} />
            <Route path="quarterly-evaluation" element={<QuarterlyEvaluationPage />} />
            <Route path="yearly-plan" element={<YearlyPlanPage />} />
            <Route path="profile" element={<ProfilePage />} />

          </Route>

          {/* ── RA Routes ─────────────────────────────────────────────────────
              allowedRoles includes "MD" so that:
              - MD in "RA View" can access /ra/* for evaluating direct reportees
              - All RA controllers scope by req.user.userId, so MD only sees
                employees whose reportingAuthorityId = MD's userId
          ─────────────────────────────────────────────────────────────────── */}
          <Route
            path="/ra"
            element={
              <ProtectedRoute allowedRoles={['RA', 'MD']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<RADashboard />} />
            <Route path="pending-evaluations" element={<RAPendingEvaluationsPage />} />
            <Route path="monthly-evaluation" element={<RAMonthlyEvaluationPage />} />
            <Route path="quarterly-evaluation" element={<RAQuarterlyEvaluationPage />} />
            <Route path="yearly-appraisal" element={<RAYearlyAppraisalPage />} />
            <Route path="employees" element={<RAEmployeeListPage />} />
            <Route path="employee/:id" element={<RAEmployeeDetailPage />} />
            <Route path="/ra/quarterly-evaluation/:id" element={<RAQuarterlyDetailPage />} />
            {/* ── RA acting as an employee: self-submission routes ─────────────
                These stay under the /ra prefix so the JWT role "RA" always works.
                The sidebar in "Employee View" mode links to these paths.
            ───────────────────────────────────────────────────────────────── */}
            <Route path="my-monthly-plan" element={<MonthlyPlanPage />} />
            <Route path="my-yearly-plan" element={<YearlyPlanPage />} />
            <Route path="my-quarterly-evaluation" element={<QuarterlyEvaluationPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="deadline-management" element={<ExtendDeadlineManagementPage />} />
          </Route>

          {/* HRD Routes */}
          <Route
            path="/hrd"
            element={
              <ProtectedRoute allowedRoles={['HRD']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<HRDDashboard />} />
            <Route path="employees" element={<HRDEmployeeListPage />} />
            <Route path="monthly-overview" element={<HRDMonthlyOverviewPage />} />
            <Route path="employee/:id" element={<HRDEmployeeDetailPage />} />
            <Route path="yearly-appraisal" element={<HRDYearlyAppraisalPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          {/* MD Routes */}
          <Route
            path="/md"
            element={
              <ProtectedRoute allowedRoles={['MD']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<MDDashboard />} />
            <Route path="approvals" element={<MDApprovalPage />} />
            <Route path="audit" element={<MDAuditPage />} />
            <Route path="monthly-overview" element={<MDMonthlyOverviewPage />} />
            <Route path="employees" element={<MDEmployeeListPage />} />
            <Route path="employee/:id" element={<MDEmployeeDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </DeadlineProvider>
    </AuthProvider>
  );
}

export default App;
