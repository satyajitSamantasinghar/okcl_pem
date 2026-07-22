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
    const { user, loading, isAuthenticated } = useAuth();

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
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
