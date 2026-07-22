import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    FiHome,
    FiCalendar,
    FiBarChart2,
    FiTarget,
    FiUsers,
    FiClipboard,
    FiAward,
    FiCheckCircle,
    FiFileText,
    FiShield,
    FiList,
    FiX,
    FiUser,
    FiRepeat,
} from 'react-icons/fi';
import './Sidebar.css';

// ── Nav items by VIEW (not just role) ────────────────────────────────────────
//  "RA_AS_EMPLOYEE" is the special set shown when an RA switches to Employee view.
//  It uses /ra/my-* paths so the JWT role "RA" always works on backend.
//  "RA_AS_MD" is the set shown when MD switches to RA view — same RA pages.
// ─────────────────────────────────────────────────────────────────────────────
const navItemsByView = {
    EMPLOYEE: [
        { path: '/employee',                     label: 'Dashboard',            icon: <FiHome /> },
        { path: '/employee/monthly-plan',         label: 'Monthly Plan',         icon: <FiCalendar /> },
        { path: '/employee/quarterly-evaluation', label: 'Quarterly Evaluation', icon: <FiBarChart2 /> },
        { path: '/employee/yearly-plan',          label: 'Yearly Plan',          icon: <FiTarget /> },
        { path: '/employee/profile',              label: 'My Profile',           icon: <FiUser /> },
    ],
    RA: [
        { path: '/ra',                     label: 'Dashboard',           icon: <FiHome /> },
        { path: '/ra/employees',           label: 'My Employees',        icon: <FiUsers /> },
        { path: '/ra/monthly-evaluation',  label: 'Monthly Evaluation',  icon: <FiClipboard /> },
        { path: '/ra/quarterly-evaluation',label: 'Quarterly Evaluation',icon: <FiBarChart2 /> },
        { path: '/ra/yearly-appraisal',    label: 'Yearly Appraisal',   icon: <FiAward /> },
        { path: '/ra/profile',             label: 'My Profile',          icon: <FiUser /> },
    ],
    // RA in "Employee View" — Dashboard links to /employee (EmployeeDashboard, allowed for RA role).
    // Plan/achievement routes stay under /ra/my-* so the JWT role "RA" always satisfies backend guards.
    RA_AS_EMPLOYEE: [
        { path: '/employee',                    label: 'Dashboard',              icon: <FiHome /> },
        { path: '/ra/my-monthly-plan',          label: 'My Monthly Plan',        icon: <FiCalendar /> },
        { path: '/ra/my-yearly-plan',           label: 'My Yearly Plan',         icon: <FiTarget /> },
        { path: '/ra/my-quarterly-evaluation',  label: 'My Quarterly Evaluation',icon: <FiBarChart2 /> },
        { path: '/ra/profile',                  label: 'My Profile',             icon: <FiUser /> },
    ],
    HRD: [
        { path: '/hrd',                   label: 'Dashboard',        icon: <FiHome /> },
        { path: '/hrd/employees',         label: 'Employee Overview', icon: <FiUsers /> },
        { path: '/hrd/monthly-overview',  label: 'Monthly Overview', icon: <FiList /> },
        { path: '/hrd/yearly-appraisal',  label: 'Yearly Appraisal', icon: <FiAward /> },
        { path: '/hrd/profile',           label: 'My Profile',       icon: <FiUser /> },
    ],
    MD: [
        { path: '/md',                   label: 'Dashboard',        icon: <FiHome /> },
        { path: '/md/employees',         label: 'Employee Overview', icon: <FiUsers /> },
        { path: '/md/monthly-overview',  label: 'Monthly Overview', icon: <FiList /> },
        { path: '/md/approvals',         label: 'Yearly Appraisal', icon: <FiCheckCircle /> },
        { path: '/md/audit',             label: 'Audit Trail',      icon: <FiShield /> },
        { path: '/md/profile',           label: 'My Profile',       icon: <FiUser /> },
    ],
    // MD in "RA View" — same RA pages, scoped to MD's direct reportees on backend
    MD_AS_RA: [
        { path: '/ra',                     label: 'RA Dashboard',        icon: <FiHome /> },
        { path: '/ra/employees',           label: 'My Employees',        icon: <FiUsers /> },
        { path: '/ra/monthly-evaluation',  label: 'Monthly Evaluation',  icon: <FiClipboard /> },
        { path: '/ra/quarterly-evaluation',label: 'Quarterly Evaluation',icon: <FiBarChart2 /> },
        { path: '/ra/yearly-appraisal',    label: 'Yearly Appraisal',   icon: <FiAward /> },
        { path: '/md/profile',             label: 'My Profile',          icon: <FiUser /> },
    ],
};

// ── Resolve which nav set to render based on role + activeView ────────────────
const resolveNavKey = (role, activeView) => {
    if (role === 'RA'  && activeView === 'EMPLOYEE') return 'RA_AS_EMPLOYEE';
    if (role === 'MD'  && activeView === 'RA')       return 'MD_AS_RA';
    return activeView || role;
};

// ── Resolve the "end" prop for NavLink (exact match for index routes) ─────────
const isIndexPath = (path) => {
    const indexPaths = ['/employee', '/ra', '/hrd', '/md'];
    return indexPaths.includes(path);
};

const Sidebar = ({ isOpen, onClose }) => {
    const { user, activeView, switchView, mdIsRA } = useAuth();
    const navigate = useNavigate();

    if (!user) return null;

    const navKey   = resolveNavKey(user.role, activeView);
    const navItems = navItemsByView[navKey] || [];

    // ── Switch button config ───────────────────────────────────────────────────
    const canSwitchToEmployee = user.role === 'RA';
    const canSwitchToRA       = user.role === 'MD' && mdIsRA;

    const handleSwitch = () => {
        if (user.role === 'RA') {
            if (activeView === 'RA') {
                // RA → Employee view: switch state + navigate to Employee Dashboard
                switchView('EMPLOYEE');
                navigate('/employee');
            } else {
                // Employee view → back to RA dashboard
                switchView('RA');
                navigate('/ra');
            }
        } else if (user.role === 'MD') {
            if (activeView === 'MD') {
                // MD → RA view: switch state + navigate to RA Dashboard
                switchView('RA');
                navigate('/ra');
            } else {
                // RA view → back to MD dashboard
                switchView('MD');
                navigate('/md');
            }
        }
        onClose();
    };

    const switchLabel = () => {
        if (user.role === 'RA') {
            return activeView === 'RA' ? 'Switch to Employee View' : 'Switch to RA View';
        }
        if (user.role === 'MD') {
            return activeView === 'MD' ? 'Switch to RA View' : 'Switch to MD View';
        }
        return null;
    };

    const showSwitch = canSwitchToEmployee || canSwitchToRA;

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
            <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <img src="/logo.png" alt="Company Logo" className="sidebar-logo-img" />
                        <span className="sidebar-brand">KRA</span>
                    </div>
                    <button className="sidebar-close" onClick={onClose}>
                        <FiX />
                    </button>
                </div>

                {/* Active view badge */}
                {(user.role === 'RA' || user.role === 'MD') && (
                    <div className="sidebar-view-badge-wrap">
                        <span className={`sidebar-view-badge ${activeView === user.role ? 'primary' : 'secondary'}`}>
                            {activeView === 'RA' && user.role === 'MD'
                                ? '📋 RA View'
                                : activeView === 'EMPLOYEE' && user.role === 'RA'
                                    ? '👤 Employee View'
                                    : activeView === 'MD'
                                        ? '🏢 MD View'
                                        : '📊 RA View'
                            }
                        </span>
                    </div>
                )}

                <nav className="sidebar-nav">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={isIndexPath(item.path)}
                            className={({ isActive }) =>
                                `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`
                            }
                            onClick={onClose}
                        >
                            <span className="sidebar-link-icon">{item.icon}</span>
                            <span className="sidebar-link-label">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                {/* ── Switch View button ─────────────────────────────────────────
                    Shown only for RA and MD (when MD has direct reportees).
                    Clicking toggles between their two allowed views.
                ─────────────────────────────────────────────────────────────── */}
                {showSwitch && (
                    <div className="sidebar-switch-wrap">
                        <button
                            className="sidebar-switch-btn"
                            onClick={handleSwitch}
                            title={switchLabel()}
                        >
                            <FiRepeat className="sidebar-switch-icon" />
                            <span>{switchLabel()}</span>
                        </button>
                    </div>
                )}

                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">
                            {user.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="sidebar-user-info">
                            <span className="sidebar-user-name">{user.name}</span>
                            <span className="sidebar-user-role">
                                {user.role}
                                {user.role !== activeView && ` · ${activeView} View`}
                            </span>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
