import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiSend, FiFilter, FiFileText, FiCheckCircle } from 'react-icons/fi';

const MonthlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [achievements, setAchievements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('plans');
    const [filterMonth, setFilterMonth] = useState('');

    // Form states
    const [showPlanForm, setShowPlanForm] = useState(false);
    const [showAchievementForm, setShowAchievementForm] = useState(false);
    const [planMonth, setPlanMonth] = useState('');
    const [planDetails, setPlanDetails] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [achievementDetails, setAchievementDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchData = async () => {
        try {
            const params = filterMonth ? { month: filterMonth } : {};
            const [plansRes, achievementsRes] = await Promise.all([
                api.get('/employee/monthly-plans', { params }),
                api.get('/employee/monthly-achievements', { params: filterMonth ? { monthlyPlanId: '' } : {} }),
            ]);
            setPlans(plansRes.data);
            setAchievements(achievementsRes.data);
        } catch (err) {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [filterMonth]);

    const handleSubmitPlan = async (e) => {
        e.preventDefault();
        if (!planMonth || !planDetails) {
            toast.error('Please fill all fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/monthly-plan', { month: planMonth, planDetails });
            toast.success('Monthly plan submitted successfully!');
            setPlanMonth('');
            setPlanDetails('');
            setShowPlanForm(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitAchievement = async (e) => {
        e.preventDefault();
        if (!selectedPlanId || !achievementDetails) {
            toast.error('Please fill all fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/monthly-achievement', {
                monthlyPlanId: selectedPlanId,
                achievementDetails,
            });
            toast.success('Monthly achievement submitted successfully!');
            setSelectedPlanId('');
            setAchievementDetails('');
            setShowAchievementForm(false);
            fetchData();
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

    // Get available months for filter
    const availableMonths = [...new Set(plans.map((p) => p.month))].sort().reverse();

    // Check which plans already have achievements
    const achievementPlanIds = new Set(achievements.map((a) => a.monthlyPlanId?._id || a.monthlyPlanId));
    const plansWithoutAchievement = plans.filter((p) => !achievementPlanIds.has(p._id));

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading monthly plans...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Monthly Plan</h1>
                <p>Submit and track your monthly work plans and achievements</p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => setShowPlanForm(!showPlanForm)}>
                    <FiSend /> Submit Monthly Plan
                </button>
                <button className="btn btn-secondary" onClick={() => setShowAchievementForm(!showAchievementForm)}>
                    <FiCheckCircle /> Submit Achievement
                </button>
            </div>

            {/* Submit Plan Form */}
            {showPlanForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Submit Monthly Plan</h3>
                    <form onSubmit={handleSubmitPlan}>
                        <div className="form-group">
                            <label>Month</label>
                            <input
                                type="month"
                                value={planMonth}
                                onChange={(e) => setPlanMonth(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Plan Details</label>
                            <textarea
                                placeholder="Describe your work plan for this month..."
                                value={planDetails}
                                onChange={(e) => setPlanDetails(e.target.value)}
                                required
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Submitting...' : 'Submit Plan'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowPlanForm(false)}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Submit Achievement Form */}
            {showAchievementForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Submit Monthly Achievement</h3>
                    {plansWithoutAchievement.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)' }}>
                            All plans already have achievements submitted or no plans available.
                        </p>
                    ) : (
                        <form onSubmit={handleSubmitAchievement}>
                            <div className="form-group">
                                <label>Select Monthly Plan</label>
                                <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} required>
                                    <option value="">Select a plan...</option>
                                    {plansWithoutAchievement.map((p) => (
                                        <option key={p._id} value={p._id}>
                                            {p.month} — {p.planDetails?.substring(0, 60)}...
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Achievement Details</label>
                                <textarea
                                    placeholder="Describe your achievements for this month..."
                                    value={achievementDetails}
                                    onChange={(e) => setAchievementDetails(e.target.value)}
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : 'Submit Achievement'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAchievementForm(false)}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {/* Tabs */}
            <div className="tabs">
                <button className={`tab ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <FiFileText style={{ marginRight: '6px' }} /> Plans
                </button>
                <button className={`tab ${activeTab === 'achievements' ? 'active' : ''}`} onClick={() => setActiveTab('achievements')}>
                    <FiCheckCircle style={{ marginRight: '6px' }} /> Achievements
                </button>
            </div>

            {/* Filter */}
            <div className="filter-bar">
                <FiFilter />
                <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
                    <option value="">All Months</option>
                    {availableMonths.map((m) => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
            </div>

            {/* Plans Tab */}
            {activeTab === 'plans' && (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Month</th>
                                <th>Plan Details</th>
                                <th>Status</th>
                                <th>Submitted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {plans.length === 0 ? (
                                <tr><td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No monthly plans submitted yet</td></tr>
                            ) : (
                                plans.map((plan) => (
                                    <tr key={plan._id}>
                                        <td><strong>{plan.month}</strong></td>
                                        <td style={{ maxWidth: '400px' }}>{plan.planDetails}</td>
                                        <td>{getStatusBadge(plan.status)}</td>
                                        <td>{new Date(plan.submittedAt).toLocaleDateString()}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Achievements Tab */}
            {activeTab === 'achievements' && (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Month</th>
                                <th>Achievement Details</th>
                                <th>Submitted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {achievements.length === 0 ? (
                                <tr><td colSpan="3" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No achievements submitted yet</td></tr>
                            ) : (
                                achievements.map((ach) => (
                                    <tr key={ach._id}>
                                        <td><strong>{ach.monthlyPlanId?.month || 'N/A'}</strong></td>
                                        <td style={{ maxWidth: '400px' }}>{ach.achievementDetails}</td>
                                        <td>{new Date(ach.submittedAt).toLocaleDateString()}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default MonthlyPlanPage;
