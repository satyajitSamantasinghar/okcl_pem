import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ── viewAccessMap ─────────────────────────────────────────────────────────────
//  Defines which route "views" each base role is allowed to access.
//  Key   = user.role (from JWT — never changes)
//  Value = array of allowedRoles values that this base role can visit
//
//  Examples:
//    RA with role="RA" can access routes guarded by allowedRoles=["RA"] ✓
//    RA with role="RA" can access routes guarded by allowedRoles=["EMPLOYEE"] ✓ (RA is also employee)
//    MD with role="MD" can access routes guarded by allowedRoles=["RA"] ✓ (MD in RA-view)
//    MD with role="MD" CANNOT access routes guarded by allowedRoles=["EMPLOYEE"] ✗
// ─────────────────────────────────────────────────────────────────────────────
const viewAccessMap = {
    EMPLOYEE: ['EMPLOYEE'],
    RA:       ['RA', 'EMPLOYEE'],   // RA is also an employee (can submit own plans)
    HRD:      ['HRD'],
    MD:       ['MD', 'RA'],         // MD can act as RA evaluator for direct reportees
};

const ProtectedRoute = ({ children, allowedRoles }) => {
    const { user, loading, isAuthenticated, isLoggingOut } = useAuth();

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        // ── Intentional Logout / Go-to-HRMS ──────────────────────────────────
        // If isLoggingOut=true, the user deliberately triggered logout or
        // navigated to HRMS. Do NOT fire the HRMS SSO redirect here — that
        // would append ?kra_redirect=... to the HRMS login URL and create
        // an infinite redirect loop. Fall back to the original /login behaviour.
        // DashboardLayout's window.location call will override this React Router
        // navigation and take the user to the correct final destination.
        if (isLoggingOut) {
            return <Navigate to="/login" replace />;
        }

        // ── HRMS SSO Fallback (email link / expired session) ──────────────────
        // When a user lands on a KRA page via an email link and their session
        // has expired, redirect them to the HRMS login page instead of the
        // local KRA login. HRMS will re-authenticate and bounce them back here
        // with a fresh encrypted token + the original KRA page as ?redirect=
        const kraReturnUrl = encodeURIComponent(window.location.href);
        window.location.replace(
            `https://hrmserp.okcl.co.in/index.php?kra_redirect=${kraReturnUrl}`
        );
        return null; // nothing to render while the browser is redirecting
        // return <Navigate to="/login" replace />; // old behaviour — kept for reference
    }

    // Check whether the user's BASE ROLE (from JWT) grants access to the required view.
    // This is intentionally based on user.role (not activeView) so that tampering
    // with activeView in localStorage never bypasses a real role guard.
    const canAccess = !allowedRoles || allowedRoles.some(
        (requiredRole) => viewAccessMap[user.role]?.includes(requiredRole)
    );

    if (!canAccess) {
        return <Navigate to="/unauthorized" replace />;
    }

    return children;
};

export default ProtectedRoute;
