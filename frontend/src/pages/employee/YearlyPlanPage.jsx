import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiSend, FiTarget, FiCheckCircle } from 'react-icons/fi';

const YearlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('plans');

    // Form states
    const [showPlanForm, setShowPlanForm] = useState(false);
    const [showAchievementForm, setShowAchievementForm] = useState(false);
    const [financialYear, setFinancialYear] = useState('');
    const [planDetails, setPlanDetails] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [tasksCompleted, setTasksCompleted] = useState('');
    const [additionalTasks, setAdditionalTasks] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchPlans = async () => {
        try {
            const res = await api.get('/employee/yearly-plans');
            setPlans(res.data);
        } catch (err) {
            toast.error('Failed to load yearly plans');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlans();
    }, []);

    const handleSubmitPlan = async (e) => {
        e.preventDefault();
        if (!financialYear || !planDetails) {
            toast.error('Please fill all fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-plan', { financialYear, planDetails });
            toast.success('Yearly plan submitted successfully!');
            setFinancialYear('');
            setPlanDetails('');
            setShowPlanForm(false);
            fetchPlans();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitAchievement = async (e) => {
        e.preventDefault();
        if (!selectedPlanId || !tasksCompleted) {
            toast.error('Please fill required fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-achievement', {
                yearlyPlanId: selectedPlanId,
                tasksCompleted,
                additionalTasks,
            });
            toast.success('Yearly achievement submitted successfully!');
            setSelectedPlanId('');
            setTasksCompleted('');
            setAdditionalTasks('');
            setShowAchievementForm(false);
            fetchPlans();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusBadge = (status) => {
        const cls = status === 'APPROVED' ? 'badge-approved' : status === 'REJECTED' ? 'badge-rejected' : 'badge-pending';
        return <span className={`badge ${cls}`}>{status}</span>;
    };

    const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading yearly plans...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Yearly Plan</h1>
                <p>Submit and track your yearly work plans and achievements</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => setShowPlanForm(!showPlanForm)}>
                    <FiSend /> Submit Yearly Plan
                </button>
                <button className="btn btn-secondary" onClick={() => setShowAchievementForm(!showAchievementForm)}>
                    <FiCheckCircle /> Submit Achievement
                </button>
            </div>

            {/* Plan Form */}
            {showPlanForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Submit Yearly Plan</h3>
                    <form onSubmit={handleSubmitPlan}>
                        <div className="form-group">
                            <label>Financial Year</label>
                            <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} required>
                                <option value="">Select Financial Year</option>
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Plan Details</label>
                            <textarea
                                placeholder="Describe your yearly work plan..."
                                value={planDetails}
                                onChange={(e) => setPlanDetails(e.target.value)}
                                required
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Submitting...' : 'Submit Plan'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowPlanForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Achievement Form */}
            {showAchievementForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Submit Yearly Achievement</h3>
                    {plans.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)' }}>No yearly plans available.</p>
                    ) : (
                        <form onSubmit={handleSubmitAchievement}>
                            <div className="form-group">
                                <label>Select Yearly Plan</label>
                                <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} required>
                                    <option value="">Select a plan...</option>
                                    {plans.map((p) => (
                                        <option key={p._id} value={p._id}>
                                            {p.financialYear} — {p.planDetails?.substring(0, 60)}...
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Tasks Completed</label>
                                <textarea
                                    placeholder="Describe the tasks you completed..."
                                    value={tasksCompleted}
                                    onChange={(e) => setTasksCompleted(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Additional Tasks (Optional)</label>
                                <textarea
                                    placeholder="Any additional tasks beyond the plan..."
                                    value={additionalTasks}
                                    onChange={(e) => setAdditionalTasks(e.target.value)}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : 'Submit Achievement'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAchievementForm(false)}>Cancel</button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {/* Plans List */}
            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Financial Year</th>
                            <th>Plan Details</th>
                            <th>Status</th>
                            <th>Submitted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {plans.length === 0 ? (
                            <tr><td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No yearly plans submitted yet</td></tr>
                        ) : (
                            plans.map((plan) => (
                                <tr key={plan._id}>
                                    <td><strong>{plan.financialYear}</strong></td>
                                    <td style={{ maxWidth: '400px' }}>{plan.planDetails}</td>
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

export default YearlyPlanPage;
