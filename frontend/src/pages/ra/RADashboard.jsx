import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiUsers, FiFileText, FiTrendingUp, FiCheckCircle, FiClipboard, FiBarChart2, FiAward } from 'react-icons/fi';

const RADashboard = () => {
    const [stats, setStats] = useState({
        totalEmployees: 0,
        totalPlansSubmitted: 0,
        totalAchievementsSubmitted: 0,
        totalEvaluated: 0,
    });
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    useEffect(() => {
        const fetchDashboard = async () => {
            try {
                const res = await api.get('/ra/dashboard', { params: { month: selectedMonth } });
                setStats(res.data);
            } catch (err) {
                toast.error('Failed to load dashboard');
            } finally {
                setLoading(false);
            }
        };
        fetchDashboard();
    }, [selectedMonth]);

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading dashboard...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>RA Dashboard</h1>
                <p>Monitor and evaluate your team's performance</p>
            </div>

            <div className="filter-bar">
                <label style={{ fontWeight: '600', fontSize: '0.875rem' }}>Month:</label>
                <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                />
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon orange"><FiUsers /></div>
                    <div className="stat-info">
                        <h4>Total Employees</h4>
                        <div className="stat-value">{stats.totalEmployees}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon blue"><FiFileText /></div>
                    <div className="stat-info">
                        <h4>Plans Submitted</h4>
                        <div className="stat-value">{stats.totalPlansSubmitted}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon green"><FiTrendingUp /></div>
                    <div className="stat-info">
                        <h4>Achievements</h4>
                        <div className="stat-value">{stats.totalAchievementsSubmitted}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon yellow"><FiCheckCircle /></div>
                    <div className="stat-info">
                        <h4>Evaluated</h4>
                        <div className="stat-value">{stats.totalEvaluated}</div>
                    </div>
                </div>
            </div>

            <div className="cards-grid">
                <Link to="/ra/monthly-evaluation" className="action-card">
                    <div className="action-card-icon orange"><FiClipboard /></div>
                    <h3>Monthly Evaluation</h3>
                    <p>Review employee monthly plans & achievements and provide marks and remarks</p>
                    <span className="action-card-link">Evaluate Now →</span>
                </Link>

                <Link to="/ra/quarterly-evaluation" className="action-card">
                    <div className="action-card-icon blue"><FiBarChart2 /></div>
                    <h3>Quarterly Evaluation</h3>
                    <p>Generate quarterly average marks and provide quarterly remarks</p>
                    <span className="action-card-link">Generate Quarterly →</span>
                </Link>

                <Link to="/ra/yearly-appraisal" className="action-card">
                    <div className="action-card-icon yellow"><FiAward /></div>
                    <h3>Yearly Appraisal</h3>
                    <p>Assign final marks and provide year-end remarks for employees</p>
                    <span className="action-card-link">View Appraisals →</span>
                </Link>
            </div>
        </div>
    );
};

export default RADashboard;
