import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import { FiMenu, FiLogOut, FiUser, FiSettings, FiChevronDown, FiExternalLink } from 'react-icons/fi';
import './DashboardLayout.css';

const HRMS_PORTAL_URL  = 'https://hrmserp.okcl.co.in/plist.php';
const HRMS_LOGOUT_URL  = 'https://hrmserp.okcl.co.in/phpscript/logout.php';

const DashboardLayout = () => {
    const [sidebarOpen, setSidebarOpen]   = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const { user, logout } = useAuth();
    const dropdownRef = useRef(null);
    const navigate    = useNavigate();

    
    const handleLogout = async () => {
        await logout();
         window.location.href = HRMS_LOGOUT_URL;
    };

    
    const handleRedirectToHRMS = async () => {
        setDropdownOpen(false);
        await logout();
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
                                    </div>
                                    <div className="dropdown-divider"></div>

                                    {/* My Profile — unchanged */}
                                    <button className="dropdown-item" onClick={() => { setDropdownOpen(false); navigate(`/${user.role.toLowerCase()}/profile`); }}>
                                        <FiUser />
                                        <span>My Profile</span>
                                    </button>

                                    {/* ✅ Change 5 — New Redirect to HRMS button */}
                                    <button className="dropdown-item" onClick={handleRedirectToHRMS}>
                                        <FiExternalLink />
                                        <span>Go to HRMS</span>
                                    </button>

                                    <div className="dropdown-divider"></div>

                                    {/* Logout — now also logs out of HRMS */}
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