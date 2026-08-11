import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import {
    FiMenu, FiLogOut, FiUser, FiChevronDown,
    FiExternalLink, FiRepeat,
} from 'react-icons/fi';
import './DashboardLayout.css';

const HRMS_PORTAL_URL = 'https://hrmserp.okcl.co.in/plist.php';
const HRMS_LOGOUT_URL = 'https://hrmserp.okcl.co.in/phpscript/logout.php';

// ── View mode label + colour ──────────────────────────────────────────────────
const viewMeta = {
    EMPLOYEE: { label: 'Employee View', color: '#6366f1' },
    RA:       { label: 'RA View',       color: '#0ea5e9' },
    HRD:      { label: 'HRD',           color: '#10b981' },
    MD:       { label: 'MD View',       color: '#f97316' },
};

const DashboardLayout = () => {
    const [sidebarOpen, setSidebarOpen]   = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const { user, logout, activeView, switchView, mdIsRA } = useAuth();
    const dropdownRef = useRef(null);
    const navigate    = useNavigate();

    const handleLogout = async () => {
        await logout();
        window.location.href = HRMS_LOGOUT_URL;
    };

    const handleRedirectToHRMS = () => {
        setDropdownOpen(false);
        // ── Go to HRMS Portal ─────────────────────────────────────────────────
        // DO NOT call logout() here. The user is still authenticated in HRMS;
        // calling logout() clears the KRA session but ALSO destroys the HRMS
        // session cookie, which causes HRMS to redirect to its own login page
        // instead of landing on plist.php.
        // We simply navigate to the HRMS portal directly — the HRMS session
        // cookie is sent automatically by the browser and plist.php loads fine.
        // await logout(); // ← old behaviour: caused HRMS login redirect
        window.location.href = HRMS_PORTAL_URL;
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getInitials = (name) => {
        if (!name) return 'U';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    };

    // ── Switch action from topbar dropdown / chip ─────────────────────────────
    const handleSwitchView = () => {
        setDropdownOpen(false);
        if (user.role === 'RA') {
            if (activeView === 'RA') {
                switchView('EMPLOYEE');
                navigate('/employee');
            } else {
                switchView('RA');
                navigate('/ra');
            }
        } else if (user.role === 'MD') {
            if (activeView === 'MD') {
                switchView('RA');
                navigate('/ra');
            } else {
                switchView('MD');
                navigate('/md');
            }
        }
    };

    const switchLabel = () => {
        if (user?.role === 'RA') {
            return activeView === 'RA' ? 'Switch to Employee View' : 'Switch to RA View';
        }
        if (user?.role === 'MD') {
            return activeView === 'MD' ? 'Switch to RA View' : 'Switch to MD View';
        }
        return null;
    };

    const showSwitchInDropdown =
        (user?.role === 'RA') ||
        (user?.role === 'MD' && mdIsRA);

    const meta = viewMeta[activeView] || viewMeta[user?.role] || { label: user?.role, color: '#64748b' };
    const isInAlternateView = user && activeView !== user.role;

    return (
        <div className="dashboard-layout">
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div className="dashboard-main">
                <header className="dashboard-topbar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <button
                            className="topbar-menu-btn"
                            onClick={() => setSidebarOpen(true)}
                        >
                            <FiMenu />
                        </button>
                        <div className="topbar-greeting">
                            Welcome, <strong>{user?.name}</strong>
                        </div>

                        {/* ── Active View Chip ──────────────────────────────────────
                            Only shown for multi-role users (RA and MD with reportees).
                            Provides a clear visual indicator of the current operating context.
                            Clicking it toggles the view directly from the topbar.
                        ─────────────────────────────────────────────────────────── */}
                        {showSwitchInDropdown && (
                            <button
                                className={`topbar-view-chip ${isInAlternateView ? 'topbar-view-chip--alt' : ''}`}
                                style={{ '--chip-color': meta.color }}
                                onClick={handleSwitchView}
                                title={switchLabel()}
                            >
                                <FiRepeat className="topbar-view-chip-icon" />
                                <span>{meta.label}</span>
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <NotificationBell />

                        {/* Profile Dropdown */}
                        <div className="topbar-dropdown-container" ref={dropdownRef}>
                            <button
                                className={`topbar-trigger ${dropdownOpen ? 'active' : ''}`}
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                            >
                                <div className="topbar-avatar">
                                    {getInitials(user?.name)}
                                </div>
                                <div className="topbar-info-compact">
                                    <span className="topbar-user-name">{user?.name}</span>
                                    <span className="topbar-user-role">{user?.role}</span>
                                </div>
                                <FiChevronDown className="topbar-chevron" />
                            </button>

                            {dropdownOpen && (
                                <div className="topbar-dropdown-menu">
                                    <div className="dropdown-header">
                                        <strong>{user?.name}</strong>
                                        <span>{user?.email}</span>
                                        {isInAlternateView && (
                                            <span className="dropdown-view-badge" style={{ color: meta.color }}>
                                                Acting in {meta.label}
                                            </span>
                                        )}
                                    </div>
                                    <div className="dropdown-divider"></div>

                                    {/* My Profile */}
                                    <button
                                        className="dropdown-item"
                                        onClick={() => {
                                            setDropdownOpen(false);
                                            // Profile route depends on current active view's base path
                                            const profileBase =
                                                user.role === 'RA' ? '/ra' :
                                                user.role === 'MD' ? '/md' :
                                                `/${user.role.toLowerCase()}`;
                                            navigate(`${profileBase}/profile`);
                                        }}
                                    >
                                        <FiUser />
                                        <span>My Profile</span>
                                    </button>

                                    {/* Switch View — shown for RA and eligible MD */}
                                    {showSwitchInDropdown && (
                                        <button className="dropdown-item dropdown-item--switch" onClick={handleSwitchView}>
                                            <FiRepeat />
                                            <span>{switchLabel()}</span>
                                        </button>
                                    )}

                                    {/* Go to HRMS */}
                                    <button className="dropdown-item" onClick={handleRedirectToHRMS}>
                                        <FiExternalLink />
                                        <span>Go to HRMS</span>
                                    </button>

                                    <div className="dropdown-divider"></div>

                                    {/* Logout */}
                                    <button className="dropdown-item logout" onClick={handleLogout}>
                                        <FiLogOut />
                                        <span>Logout</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="dashboard-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;