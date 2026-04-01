import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import { FiMenu, FiLogOut, FiUser, FiSettings, FiChevronDown } from 'react-icons/fi';
import './DashboardLayout.css';

const DashboardLayout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const { user, logout } = useAuth();
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
    };

    // Close dropdown on outside click
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
                        <div className="profile-dropdown-container" ref={dropdownRef}>
                            <button 
                                className={`profile-trigger ${dropdownOpen ? 'active' : ''}`}
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                            >
                                <div className="profile-avatar">
                                    {getInitials(user?.name)}
                                </div>
                                <div className="profile-info-compact">
                                    <span className="profile-name">{user?.name}</span>
                                    <span className="profile-role">{user?.role}</span>
                                </div>
                                <FiChevronDown className="profile-chevron" />
                            </button>

                            {dropdownOpen && (
                                <div className="profile-dropdown-menu">
                                    <div className="dropdown-header">
                                        <strong>{user?.name}</strong>
                                        <span>{user?.email}</span>
                                    </div>
                                    <div className="dropdown-divider"></div>
                                    
                                    <button className="dropdown-item" onClick={() => { setDropdownOpen(false); /* maybe navigate('/profile') */ }}>
                                        <FiUser />
                                        <span>My Profile</span>
                                    </button>
                                    <button className="dropdown-item" onClick={() => { setDropdownOpen(false); /* settings */ }}>
                                        <FiSettings />
                                        <span>Settings</span>
                                    </button>
                                    
                                    <div className="dropdown-divider"></div>
                                    
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
