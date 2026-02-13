import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { FiCalendar, FiBarChart2, FiTarget, FiTrendingUp } from 'react-icons/fi';
import './EmployeeDashboard.css';

const EmployeeDashboard = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState({
        monthlyPlans: 0,
        monthlyAchievements: 0,
        yearlyPlans: 0,
        quarterlyEvals: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const [plansRes, achievementsRes, yearlyRes, quarterlyRes] = await Promise.all([
                    api.get('/employee/monthly-plans'),
                    api.get('/employee/monthly-achievements'),
                    api.get('/employee/yearly-plans'),
                    api.get('/ra/monthly-evaluations'),
                ]);
                setStats({
                    monthlyPlans: plansRes.data?.length || 0,
                    monthlyAchievements: achievementsRes.data?.length || 0,
                    yearlyPlans: yearlyRes.data?.length || 0,
                    quarterlyEvals: quarterlyRes.data?.totalRecords || 0,
                });
            } catch (err) {
                console.error('Failed to load dashboard stats', err);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

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
                <h1>Employee Dashboard</h1>
                <p>Welcome back, {user?.name}. Here's your performance overview.</p>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon orange"><FiCalendar /></div>
                    <div className="stat-info">
                        <h4>Monthly Plans</h4>
                        <div className="stat-value">{stats.monthlyPlans}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon green"><FiTrendingUp /></div>
                    <div className="stat-info">
                        <h4>Achievements</h4>
                        <div className="stat-value">{stats.monthlyAchievements}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon blue"><FiBarChart2 /></div>
                    <div className="stat-info">
                        <h4>Quarterly Evals</h4>
                        <div className="stat-value">{stats.quarterlyEvals}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon yellow"><FiTarget /></div>
                    <div className="stat-info">
                        <h4>Yearly Plans</h4>
                        <div className="stat-value">{stats.yearlyPlans}</div>
                    </div>
                </div>
            </div>

            <div className="cards-grid">
                <Link to="/employee/monthly-plan" className="action-card">
                    <div className="action-card-icon orange"><FiCalendar /></div>
                    <h3>Monthly Plan</h3>
                    <p>Submit and view your monthly work plans and achievements</p>
                    <span className="action-card-link">Go to Monthly Plan →</span>
                </Link>

                <Link to="/employee/quarterly-evaluation" className="action-card">
                    <div className="action-card-icon blue"><FiBarChart2 /></div>
                    <h3>Quarterly Evaluation</h3>
                    <p>View quarterly evaluation remarks from your reporting authority</p>
                    <span className="action-card-link">View Evaluations →</span>
                </Link>

                <Link to="/employee/yearly-plan" className="action-card">
                    <div className="action-card-icon yellow"><FiTarget /></div>
                    <h3>Yearly Plan</h3>
                    <p>Submit and track your yearly plan and achievements</p>
                    <span className="action-card-link">Go to Yearly Plan →</span>
                </Link>
            </div>
        </div>
    );
};

export default EmployeeDashboard;
