import { NavLink, useLocation } from 'react-router-dom';
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
} from 'react-icons/fi';
import './Sidebar.css';

const navItemsByRole = {
    EMPLOYEE: [
        { path: '/employee', label: 'Dashboard', icon: <FiHome /> },
        { path: '/employee/monthly-plan', label: 'Monthly Plan', icon: <FiCalendar /> },
        { path: '/employee/quarterly-evaluation', label: 'Quarterly Evaluation', icon: <FiBarChart2 /> },
        { path: '/employee/yearly-plan', label: 'Yearly Plan', icon: <FiTarget /> },
    ],
    RA: [
        { path: '/ra', label: 'Dashboard', icon: <FiHome /> },
        { path: '/ra/employees', label: 'My Employees', icon: <FiUsers /> },
        { path: '/ra/monthly-evaluation', label: 'Monthly Evaluation', icon: <FiClipboard /> },
        { path: '/ra/quarterly-evaluation', label: 'Quarterly Evaluation', icon: <FiBarChart2 /> },
        { path: '/ra/yearly-appraisal', label: 'Yearly Appraisal', icon: <FiAward /> },
    ],
    HRD: [
        { path: '/hrd', label: 'Dashboard', icon: <FiHome /> },
        { path: '/hrd/employees', label: 'People Directory', icon: <FiUsers /> },
        { path: '/hrd/monthly-overview', label: 'Monthly Overview', icon: <FiList /> },
        { path: '/hrd/yearly-appraisal', label: 'Yearly Appraisal', icon: <FiAward /> },
    ],
    MD: [
        { path: '/md', label: 'Dashboard', icon: <FiHome /> },
        { path: '/md/employees', label: 'People Directory', icon: <FiUsers /> },
        { path: '/md/monthly-overview', label: 'Monthly Overview', icon: <FiList /> },
        { path: '/md/approvals', label: 'Approvals', icon: <FiCheckCircle /> },
        { path: '/md/audit', label: 'Audit Trail', icon: <FiShield /> },
    ],
};

const Sidebar = ({ isOpen, onClose }) => {
    const { user } = useAuth();
    const location = useLocation();

    if (!user) return null;

    const navItems = navItemsByRole[user.role] || [];

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
            <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <img src="/logo.png" alt="Company Logo" className="sidebar-logo-img" />
                        <span className="sidebar-brand">PES</span>
                    </div>
                    <button className="sidebar-close" onClick={onClose}>
                        <FiX />
                    </button>
                </div>

                <nav className="sidebar-nav">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === `/${user.role.toLowerCase()}`}
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

                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">
                            {user.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="sidebar-user-info">
                            <span className="sidebar-user-name">{user.name}</span>
                            <span className="sidebar-user-role">{user.role}</span>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
