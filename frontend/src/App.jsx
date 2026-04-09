import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';

// Pages
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';

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

// Smart redirect based on logged-in role
const HomeRedirect = () => {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const paths = {
    EMPLOYEE: '/employee',
    RA: '/ra',
    HRD: '/hrd',
    MD: '/md',
  };

  return <Navigate to={paths[user.role] || '/login'} replace />;
};

function App() {
  return (
    <AuthProvider>
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

          {/* Employee Routes */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute allowedRoles={['EMPLOYEE']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<EmployeeDashboard />} />
            <Route path="monthly-plan" element={<MonthlyPlanPage />} />
            <Route path="quarterly-evaluation" element={<QuarterlyEvaluationPage />} />
            <Route path="yearly-plan" element={<YearlyPlanPage />} />
          </Route>

          {/* RA Routes */}
          <Route
            path="/ra"
            element={
              <ProtectedRoute allowedRoles={['RA']}>
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
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
