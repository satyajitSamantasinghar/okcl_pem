import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    FiUsers,
    FiFileText,
    FiTrendingUp,
    FiCheckCircle,
    FiClipboard,
    FiBarChart2,
    FiAward,
    FiAlertCircle,
    FiCalendar,
    FiUserX,
    FiX,
    FiEye,
    FiActivity,
    FiAlertTriangle,
    FiInfo,
} from 'react-icons/fi';
import {
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import './RADashboard.css';

/* ── Arrow icon ── */
const ArrowRightIcon = ({ className }) => (
    <svg
        className={className}
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

/* ── Insight pill ── */
const InsightCard = ({ icon, text, variant }) => (
    <div className={`ra-insight-item ra-insight-${variant}`}>
        <span className="ra-insight-icon">{icon}</span>
        <span className="ra-insight-text">{text}</span>
    </div>
);

/* ── Pure helpers (no state/hooks — safe to keep outside component) ── */
const formatMonth = (monthStr) => {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    return new Date(year, parseInt(month, 10) - 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    });
};

const formatActivityTimestamp = (dateValue) => {
    if (!dateValue) return 'Timestamp unavailable';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Timestamp unavailable';
    return date.toLocaleString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((part) => part[0]).join('').substring(0, 2).toUpperCase();
};

const uniqueIds = (items = []) =>
    [...new Set(items.map((id) => id?.toString()).filter(Boolean))];

const getWeekBucketIndex = (dateValue) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 0;
    return Math.min(3, Math.floor((date.getDate() - 1) / 7));
};

const createEmptyTrendData = () => ([
    { name: 'Week 1', submitted: 0, evaluated: 0 },
    { name: 'Week 2', submitted: 0, evaluated: 0 },
    { name: 'Week 3', submitted: 0, evaluated: 0 },
    { name: 'Week 4', submitted: 0, evaluated: 0 },
]);

/* ════════════════════════════════════════════════════════════
   RADashboard — main component
   ════════════════════════════════════════════════════════════ */
const RADashboard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [stats, setStats] = useState({
        totalEmployees: 0,
        plansSubmittedThisMonth: 0,
        achievementsThisMonth: 0,
        evaluatedThisMonth: 0,
        pendingEvaluation: 0,
        notYetSubmitted: 0,
        pendingYearly: 0,
        lists: {
            submitted: [],
            achievements: [],
            evaluated: [],
            notSubmitted: [],
        },
    });
    const [employeesList, setEmployeesList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', type: null });
    const [activityFeed, setActivityFeed] = useState([]);
    const [weeklyTrendData, setWeeklyTrendData] = useState(createEmptyTrendData());

    /* ── Primary data fetch (UNCHANGED) ── */
    useEffect(() => {
        const fetchDashboardData = async () => {
            setLoading(true);
            try {
                const [dashRes, empRes] = await Promise.all([
                    api.get('/ra/dashboard', { params: { month: selectedMonth } }),
                    api.get('/ra/my-employees'),
                ]);
                setStats(dashRes.data);
                setEmployeesList(Array.isArray(empRes.data) ? empRes.data : []);
            } catch (error) {
                toast.error('Failed to load dashboard data');
            } finally {
                setLoading(false);
            }
        };
        fetchDashboardData();
    }, [selectedMonth]);

    /* ── Timeline / activity fetch (UNCHANGED) ── */
    useEffect(() => {
        const relevantEmployeeIds = uniqueIds([
            ...(stats.lists?.submitted || []),
            ...(stats.lists?.achievements || []),
            ...(stats.lists?.evaluated || []),
        ]);

        const fetchTimelineData = async () => {
            if (relevantEmployeeIds.length === 0) {
                setActivityFeed([]);
                setWeeklyTrendData(createEmptyTrendData());
                return;
            }
            setTimelineLoading(true);
            try {
                const results = await Promise.allSettled(
                    relevantEmployeeIds.map((id) => api.get(`/ra/employee/${id}`))
                );

                const nextActivities = [];
                const nextTrendData = createEmptyTrendData();

                results.forEach((result) => {
                    if (result.status !== 'fulfilled') return;
                    const payload = result.value.data;
                    const employee = payload.employee;

                    const monthlyPlan = (payload.monthlyPlans || []).find(
                        (plan) => plan.month === selectedMonth && plan.submittedAt
                    );
                    if (monthlyPlan?.submittedAt) {
                        nextActivities.push({
                            id: `plan-${employee._id}`,
                            user: employee.name,
                            action: 'submitted the monthly plan',
                            time: formatActivityTimestamp(monthlyPlan.submittedAt),
                            sortTime: new Date(monthlyPlan.submittedAt).getTime(),
                            icon: <FiFileText />,
                            color: 'blue',
                        });
                        nextTrendData[getWeekBucketIndex(monthlyPlan.submittedAt)].submitted += 1;
                    }

                    const monthlyAchievement = (payload.monthlyAchievements || []).find((a) => {
                        const achievementMonth = a.monthlyPlanId?.month;
                        return achievementMonth === selectedMonth && a.submittedAt;
                    });
                    if (monthlyAchievement?.submittedAt) {
                        nextActivities.push({
                            id: `achievement-${employee._id}`,
                            user: employee.name,
                            action: 'uploaded the monthly achievement',
                            time: formatActivityTimestamp(monthlyAchievement.submittedAt),
                            sortTime: new Date(monthlyAchievement.submittedAt).getTime(),
                            icon: <FiTrendingUp />,
                            color: 'green',
                        });
                    }

                    const monthlyEvaluation = (payload.monthlyEvaluations || []).find(
                        (ev) => ev.month === selectedMonth && ev.status === 'EVALUATED'
                    );
                    const evaluationTime = monthlyEvaluation?.evaluatedAt || monthlyEvaluation?.createdAt;
                    if (evaluationTime) {
                        nextActivities.push({
                            id: `evaluation-${employee._id}`,
                            user: employee.name,
                            action: 'has a completed monthly evaluation',
                            time: formatActivityTimestamp(evaluationTime),
                            sortTime: new Date(evaluationTime).getTime(),
                            icon: <FiCheckCircle />,
                            color: 'yellow',
                        });
                        nextTrendData[getWeekBucketIndex(evaluationTime)].evaluated += 1;
                    }

                    const yearlyPlan = (payload.yearlyPlans || []).find(p => p.submittedAt && p.submittedAt.toString().startsWith(selectedMonth));
                    if (yearlyPlan) {
                        nextActivities.push({
                            id: `yearly-plan-${employee._id}`,
                            user: employee.name,
                            action: 'submitted the yearly plan',
                            time: formatActivityTimestamp(yearlyPlan.submittedAt),
                            sortTime: new Date(yearlyPlan.submittedAt).getTime(),
                            icon: <FiFileText />,
                            color: 'purple',
                        });
                    }

                    const yearlyReport = (payload.yearlyReports || []).find(r => r.submittedAt && r.submittedAt.toString().startsWith(selectedMonth));
                    if (yearlyReport) {
                        nextActivities.push({
                            id: `yearly-report-${employee._id}`,
                            user: employee.name,
                            action: 'submitted the yearly appraisal report',
                            time: formatActivityTimestamp(yearlyReport.submittedAt),
                            sortTime: new Date(yearlyReport.submittedAt).getTime(),
                            icon: <FiAward />,
                            color: 'orange',
                        });
                    }
                });

                nextActivities.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
                setActivityFeed(nextActivities.slice(0, 6));
                setWeeklyTrendData(nextTrendData);
            } catch {
                setActivityFeed([]);
                setWeeklyTrendData(createEmptyTrendData());
            } finally {
                setTimelineLoading(false);
            }
        };

        fetchTimelineData();
    }, [selectedMonth, stats.lists]);

    /* ── Modal helpers (UNCHANGED) ── */
    const openModal = (title, type) => setModalConfig({ isOpen: true, title, type });
    const closeModal = () => setModalConfig({ isOpen: false, title: '', type: null });

    const getFilteredEmployees = () => {
        if (!stats.lists || !modalConfig.type) return employeesList;
        const listMap = {
            PLANS: stats.lists.submitted || [],
            ACHIEVEMENTS: stats.lists.achievements || [],
            EVALUATED: stats.lists.evaluated || [],
            NOT_SUBMITTED: stats.lists.notSubmitted || [],
        };
        const targetIds = (listMap[modalConfig.type] || []).map((id) => id.toString());
        return employeesList.filter((emp) => targetIds.includes(emp._id.toString()));
    };

    /* ── Loading state ── */
    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading dashboard...</p>
            </div>
        );
    }

    /* ── Derived metrics (UNCHANGED) ── */
    const total = stats.totalEmployees || 1;
    const submittedPlansRate = Math.round((stats.plansSubmittedThisMonth / total) * 100);
    const achievementsRate = stats.plansSubmittedThisMonth > 0
        ? Math.round((stats.achievementsThisMonth / stats.plansSubmittedThisMonth) * 100) : 0;
    const evaluationRate = stats.plansSubmittedThisMonth > 0
        ? Math.round((stats.evaluatedThisMonth / stats.plansSubmittedThisMonth) * 100) : 0;
    const pendingRate = Math.round((stats.notYetSubmitted / total) * 100);

    /* ── Charts data (UNCHANGED) ── */
    const pieData = [
        { name: 'Evaluated', value: stats.evaluatedThisMonth, color: '#10B981' },
        { name: 'Pending Review', value: stats.pendingEvaluation, color: '#F59E0B' },
        { name: 'Not Submitted', value: stats.notYetSubmitted, color: '#EF4444' },
    ].filter((item) => item.value > 0);
    if (pieData.length === 0) pieData.push({ name: 'No Data', value: 1, color: '#E5E7EB' });

    /* ── Activity feed (UNCHANGED) ── */
    const activities = activityFeed.length > 0
        ? activityFeed
        : (stats.pendingEvaluation > 0 || stats.pendingYearly > 0)
            ? [{
                id: 'pending-summary',
                user: 'Evaluation Queue',
                action: `${stats.pendingEvaluation} monthly and ${stats.pendingYearly || 0} yearly evaluation(s) pending review`,
                time: `${formatMonth(selectedMonth)} - live queue`,
                icon: <FiAlertTriangle />,
                color: 'yellow',
            }]
            : [];

    const maxWeeklyValue = Math.max(
        4,
        ...weeklyTrendData.flatMap((entry) => [entry.submitted, entry.evaluated])
    );

    /* ── Insights (UNCHANGED logic) ── */
    const insights = [];
    if (pendingRate >= 50) {
        insights.push({
            icon: '⚠️',
            text: `${pendingRate}% of employees have not submitted their plan this month`,
            variant: 'warn',
        });
    }
    if (stats.evaluatedThisMonth <= 1 && stats.plansSubmittedThisMonth > 0) {
        insights.push({
            icon: 'ℹ️',
            text: `Only ${stats.evaluatedThisMonth} evaluation${stats.evaluatedThisMonth !== 1 ? 's' : ''} completed. ${stats.pendingEvaluation} still need review.`,
            variant: 'info',
        });
    }
    if (achievementsRate < 50 && stats.plansSubmittedThisMonth > 0) {
        insights.push({
            icon: '📋',
            text: `${100 - achievementsRate}% of submitted plans are missing achievement uploads`,
            variant: 'warn',
        });
    }
    if (evaluationRate === 100 && stats.plansSubmittedThisMonth > 0) {
        insights.push({
            icon: '🎉',
            text: 'All submitted plans have been evaluated. Great job!',
            variant: 'success',
        });
    }

    const displayEmployees = getFilteredEmployees();

    /* ════════════════════════ RENDER ════════════════════════ */
    return (
        <div className="fade-in ra-dashboard-container">

            {/* ── Modal (UNCHANGED) ── */}
            {modalConfig.isOpen && (
                <div className="ra-modal-overlay" onClick={closeModal}>
                    <div className="ra-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="ra-modal-header">
                            <div>
                                <h2>{modalConfig.title}</h2>
                                <p>Directory of employees involved in this metric.</p>
                            </div>
                            <button className="ra-modal-close" onClick={closeModal}><FiX /></button>
                        </div>
                        <div className="ra-modal-body">
                            {displayEmployees.length === 0 ? (
                                <div className="ra-empty-state">No employees found in this category.</div>
                            ) : (
                                <div className="ra-modal-list">
                                    {displayEmployees.map((employee) => (
                                        <div key={employee._id} className="ra-modal-list-item">
                                            <div className="ra-ml-avatar">{getInitials(employee.name)}</div>
                                            <div className="ra-ml-info">
                                                <strong>{employee.name}</strong>
                                                <span>#{employee.employeeCode} - {employee.department || 'No Dept'}</span>
                                            </div>
                                            <div className="ra-ml-stats">
                                                <div className="stat"><span>{employee.totalPlans || 0}</span>Plans</div>
                                                <div className="stat"><span>{employee.totalEvaluated || 0}</span>Evals</div>
                                            </div>
                                            <button className="ra-ml-btn"
                                                onClick={() => navigate(`/ra/employee/${employee._id}`)}>
                                                View
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── 1. Welcome Banner ── */}
            <div className="ra-welcome">
                <div className="ra-welcome-content">
                    <h1>Welcome back, {user?.name || 'Reporting Authority'} 👋</h1>
                    <p>Team performance overview for <strong>{formatMonth(selectedMonth)}</strong></p>
                </div>
                <div className="ra-welcome-actions">
                    <div className="filter-bar">
                        <FiCalendar />
                        <label htmlFor="ra-month-filter">Period:</label>
                        <input
                            id="ra-month-filter"
                            type="month"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* ── 2. Stats Cards ── */}
            <div className="ra-section-header">
                <h2>Team Overview</h2>
                <p>Key metrics for the selected month</p>
            </div>
            <div className="ra-stats-grid">
                {/* Card 1 — My Employees */}
                <div className="ra-smart-card clickable" onClick={() => navigate('/ra/employees')}>
                    <div className="ra-sc-header">
                        <div className="ra-sc-icon orange"><FiUsers /></div>
                        <div className="ra-sc-badge">Directory</div>
                    </div>
                    <div className="ra-sc-body">
                        <h3>My Employees</h3>
                        <div className="ra-sc-value">{stats.totalEmployees}</div>
                        <p>Total members in your team</p>
                    </div>
                    <div className="ra-sc-footer">
                        <span className="ra-sc-action">Manage &rarr;</span>
                    </div>
                </div>

                {/* Card 2 — Plans Submitted */}
                <div className="ra-smart-card">
                    <div className="ra-sc-header">
                        <div className="ra-sc-icon blue"><FiFileText /></div>
                        <button className="ra-sc-view-btn"
                            onClick={() => openModal('Plans Submitted', 'PLANS')}>
                            <FiEye /> View Plans
                        </button>
                    </div>
                    <div className="ra-sc-body">
                        <h3>Plans Submitted</h3>
                        <div className="ra-sc-value">
                            {stats.plansSubmittedThisMonth}
                            <span className="ra-sc-ratio">/ {stats.totalEmployees}</span>
                        </div>
                        <div className="ra-sc-progress-wrap">
                            <div className="ra-sc-progress-fill blue" style={{ width: `${submittedPlansRate}%` }} />
                        </div>
                        <p>{submittedPlansRate}% of team submitted plans</p>
                    </div>
                </div>

                {/* Card 3 — Achievements */}
                <div className="ra-smart-card">
                    <div className="ra-sc-header">
                        <div className="ra-sc-icon green"><FiTrendingUp /></div>
                        <button className="ra-sc-view-btn"
                            onClick={() => openModal('Achievements Uploaded', 'ACHIEVEMENTS')}>
                            <FiEye /> View Achievements
                        </button>
                    </div>
                    <div className="ra-sc-body">
                        <h3>Achievements</h3>
                        <div className="ra-sc-value">
                            {stats.achievementsThisMonth}
                            <span className="ra-sc-ratio">/ {stats.plansSubmittedThisMonth}</span>
                        </div>
                        <div className="ra-sc-progress-wrap">
                            <div className="ra-sc-progress-fill green" style={{ width: `${achievementsRate}%` }} />
                        </div>
                        <p>{achievementsRate}% of plans have achievements</p>
                    </div>
                </div>

                {/* Card 4 — Evaluated */}
                <div className="ra-smart-card">
                    <div className="ra-sc-header">
                        <div className="ra-sc-icon yellow"><FiCheckCircle /></div>
                        <button className="ra-sc-view-btn"
                            onClick={() => openModal('Evaluated Plans', 'EVALUATED')}>
                            <FiEye /> View Evaluations
                        </button>
                    </div>
                    <div className="ra-sc-body">
                        <h3>Evaluated</h3>
                        <div className="ra-sc-value">
                            {stats.evaluatedThisMonth}
                            <span className="ra-sc-ratio">/ {stats.plansSubmittedThisMonth}</span>
                        </div>
                        <div className="ra-sc-progress-wrap">
                            <div className="ra-sc-progress-fill yellow" style={{ width: `${evaluationRate}%` }} />
                        </div>
                        <p>{evaluationRate}% of submitted plans evaluated</p>
                    </div>
                </div>

                {/* Card 5 — Yet to Submit */}
                <div className="ra-smart-card">
                    <div className="ra-sc-header">
                        <div className="ra-sc-icon red"><FiUserX /></div>
                        <button className="ra-sc-view-btn"
                            onClick={() => openModal('Yet To Submit', 'NOT_SUBMITTED')}>
                            <FiEye /> View
                        </button>
                    </div>
                    <div className="ra-sc-body">
                        <h3>Yet to Submit</h3>
                        <div className="ra-sc-value">
                            {stats.notYetSubmitted}
                            <span className="ra-sc-ratio">/ {stats.totalEmployees}</span>
                        </div>
                        <div className="ra-sc-progress-wrap">
                            <div className="ra-sc-progress-fill red" style={{ width: `${pendingRate}%` }} />
                        </div>
                        <p>{pendingRate}% of team yet to submit</p>
                    </div>
                </div>
            </div>

            {/* ── 3. Pending Evaluation Alert ── */}
            {(stats.pendingEvaluation > 0 || stats.pendingYearly > 0) && (
                <div className="ra-urgent-card">
                    <div className="ra-urgent-icon pulse"><FiAlertCircle /></div>
                    <div className="ra-urgent-content">
                        <h3>Pending Evaluations Required</h3>
                        <p>
                            You have <strong>{stats.pendingEvaluation}</strong> monthly evaluation{stats.pendingEvaluation !== 1 ? 's' : ''} and <strong>{stats.pendingYearly || 0}</strong> yearly appraisal evaluation{(stats.pendingYearly || 0) !== 1 ? 's' : ''} pending review.
                        </p>
                        {stats.pendingEvaluation > 0 && (
                            <div className="ra-urgent-progress">
                                <div className="ra-urgent-bar">
                                    <div className="ra-urgent-fill" style={{
                                        width: `${100 - (stats.pendingEvaluation / (stats.plansSubmittedThisMonth || 1) * 100)}%`,
                                    }} />
                                </div>
                                <span>{stats.pendingEvaluation} monthly pending out of {stats.plansSubmittedThisMonth} total</span>
                            </div>
                        )}
                    </div>
                    <button className="ra-urgent-btn" onClick={() => navigate('/ra/monthly-evaluation')}>
                        Evaluate Now
                    </button>
                </div>
            )}

            {/* ── 4. Quick Insights ── */}
            {insights.length > 0 && (
                <div className="ra-insights-section">
                    <div className="ra-insights-header">
                        <FiInfo className="ra-insights-header-icon" />
                        <span>Quick Insights</span>
                    </div>
                    <div className="ra-insights-list">
                        {insights.map((item, index) => (
                            <InsightCard key={index} icon={item.icon} text={item.text} variant={item.variant} />
                        ))}
                    </div>
                </div>
            )}

            {/* ── 5. QUICK ACTIONS — moved here (above Analytics) ── */}
            <div className="ra-section-header">
                <h2>Quick Actions</h2>
                <p>Jump into your evaluation workflows</p>
            </div>
            <div className="ra-actions-grid">
                <Link to="/ra/monthly-evaluation" className="ra-action-tile orange">
                    <div className="ra-at-icon"><FiClipboard /></div>
                    <div className="ra-at-content">
                        <h3>Monthly Evaluation</h3>
                        <p>Review plans &amp; achievements</p>
                    </div>
                    <ArrowRightIcon className="ra-at-arrow" />
                </Link>
                <Link to="/ra/quarterly-evaluation" className="ra-action-tile blue">
                    <div className="ra-at-icon"><FiBarChart2 /></div>
                    <div className="ra-at-content">
                        <h3>Quarterly Evaluation</h3>
                        <p>Generate quarterly scores</p>
                    </div>
                    <ArrowRightIcon className="ra-at-arrow" />
                </Link>
                <Link to="/ra/yearly-appraisal" className="ra-action-tile yellow">
                    <div className="ra-at-icon"><FiAward /></div>
                    <div className="ra-at-content">
                        <h3>Yearly Appraisal</h3>
                        <p>Assign final year-end marks</p>
                    </div>
                    <ArrowRightIcon className="ra-at-arrow" />
                </Link>
            </div>

            {/* ── 6. Analytics + Activity (70/30) — now at the bottom ── */}
            <div className="ra-middle-grid">
                {/* Performance Analytics */}
                <div className="ra-chart-section">
                    <div className="ra-section-header">
                        <h2>Performance Analytics</h2>
                        <p>Overview of the evaluation cycle</p>
                    </div>
                    <div className="ra-charts-container">
                        <div className="ra-chart-box">
                            <h4>Evaluation Status Overview</h4>
                            <div style={{ height: 230 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%" cy="50%"
                                            innerRadius={52} outerRadius={78}
                                            paddingAngle={4}
                                            dataKey="value"
                                            label={({ percent }) => percent > 0.05 ? `${Math.round(percent * 100)}%` : ''}
                                            labelLine={false}
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            contentStyle={{
                                                borderRadius: '12px',
                                                border: 'none',
                                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                                fontSize: '13px',
                                            }}
                                        />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle"
                                            wrapperStyle={{ fontSize: '12px' }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="ra-chart-box">
                            <h4>Weekly Progress</h4>
                            <div style={{ height: 230 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={weeklyTrendData}
                                        margin={{ top: 14, right: 12, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false}
                                            tick={{ fontSize: 11, fill: '#6B7280', dy: 8 }} />
                                        <YAxis axisLine={false} tickLine={false}
                                            tick={{ fontSize: 11, fill: '#6B7280' }}
                                            allowDecimals={false}
                                            domain={[0, maxWeeklyValue]} />
                                        <RechartsTooltip
                                            cursor={{ stroke: 'rgba(243,244,246,0.8)', strokeWidth: 2 }}
                                            contentStyle={{
                                                borderRadius: '12px',
                                                border: 'none',
                                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                                fontSize: '13px',
                                            }}
                                        />
                                        <Legend verticalAlign="top" height={30} iconType="circle"
                                            wrapperStyle={{ fontSize: '12px' }} />
                                        <Line type="monotone" dataKey="submitted" name="Submitted"
                                            stroke="#3B82F6" strokeWidth={2.5}
                                            dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                        <Line type="monotone" dataKey="evaluated" name="Evaluated"
                                            stroke="#10B981" strokeWidth={2.5}
                                            dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="ra-chart-note">
                                Built from actual submission and evaluation timestamps for this month.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="ra-activity-section">
                    <div className="ra-section-header">
                        <h2>Recent Activity</h2>
                        <p>{timelineLoading
                            ? 'Loading activity...'
                            : 'Live feed from actual dashboard records'}</p>
                    </div>
                    <div className="ra-activity-list">
                        {activities.length > 0 ? activities.map((activity) => (
                            <div key={activity.id} className="ra-activity-item">
                                <div className={`ra-activity-icon ${activity.color}`}>{activity.icon}</div>
                                <div className="ra-activity-details">
                                    <p><strong>{activity.user}</strong> {activity.action}</p>
                                    <span>{activity.time}</span>
                                </div>
                            </div>
                        )) : (
                            <div className="ra-empty-state" style={{ padding: '40px 0' }}>
                                <FiActivity style={{ fontSize: '2rem', color: '#CBD5E1', marginBottom: '10px' }} />
                                <p>No recent activity available.</p>
                            </div>
                        )}
                        <button className="ra-activity-view-all"
                            onClick={() => navigate('/ra/monthly-evaluation')}>
                            View Evaluation Queue &rarr;
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default RADashboard;
