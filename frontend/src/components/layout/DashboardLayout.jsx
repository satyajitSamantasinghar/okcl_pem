import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import { FiMenu, FiLogOut } from 'react-icons/fi';
import './DashboardLayout.css';

const DashboardLayout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { user, logout } = useAuth();

    const handleLogout = async () => {
        await logout();
    };

    return (
        <div className="dashboard-layout">
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div className="dashboard-main">
                <header className="dashboard-topbar">
                    <button
                        className="topbar-menu-btn"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <FiMenu />
                    </button>

                    <div className="topbar-greeting">
                        Welcome, <strong>{user?.name}</strong>
                    </div>

                    <button className="topbar-logout" onClick={handleLogout}>
                        <FiLogOut />
                        <span>Logout</span>
                    </button>
                </header>

                <main className="dashboard-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
