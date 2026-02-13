import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiFileText, FiCheckCircle, FiFilter } from 'react-icons/fi';

const MDDashboard = () => {
    const [monthlyPlans, setMonthlyPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    useEffect(() => {
        const fetchData = async () => {
            try {
                const params = {};
                if (filterMonth) params.month = filterMonth;
                const res = await api.get('/employee/monthly-plans', { params });
                setMonthlyPlans(res.data || []);
            } catch (err) {
                toast.error('Failed to load data');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [filterMonth]);

    const getStatusBadge = (status) => {
        const cls = status === 'APPROVED' ? 'badge-approved' : status === 'REJECTED' ? 'badge-rejected' : 'badge-pending';
        return <span className={`badge ${cls}`}>{status}</span>;
    };

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
                <h1>MD Dashboard</h1>
                <p>Review all submissions and manage approvals across the organization</p>
            </div>

            <div className="cards-grid" style={{ marginBottom: '32px' }}>
                <Link to="/md/approvals" className="action-card">
                    <div className="action-card-icon orange"><FiCheckCircle /></div>
                    <h3>Approvals & Final Rating</h3>
                    <p>Approve or reject plans, provide final yearly appraisal marks and remarks</p>
                    <span className="action-card-link">Go to Approvals →</span>
                </Link>
            </div>

            <h2 style={{ marginBottom: '16px' }}>Monthly Plans Overview</h2>

            <div className="filter-bar">
                <FiFilter />
                <input
                    type="month"
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                />
            </div>

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Month</th>
                            <th>Plan Details</th>
                            <th>Status</th>
                            <th>Submitted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {monthlyPlans.length === 0 ? (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No plans found</td></tr>
                        ) : (
                            monthlyPlans.map((plan) => (
                                <tr key={plan._id}>
                                    <td>
                                        <strong>{plan.employeeId?.name || 'Unknown'}</strong>
                                        <br />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            {plan.employeeId?.employeeCode} • {plan.employeeId?.department}
                                        </span>
                                    </td>
                                    <td>{plan.month}</td>
                                    <td style={{ maxWidth: '300px' }}>{plan.planDetails}</td>
                                    <td>{getStatusBadge(plan.status)}</td>
                                    <td>{new Date(plan.submittedAt).toLocaleDateString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default MDDashboard;
