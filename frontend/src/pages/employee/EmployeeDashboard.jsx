import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
    FiCalendar, FiBarChart2, FiTarget, FiTrendingUp,
    FiAlertCircle, FiClock, FiCheckCircle, FiMessageSquare,
    FiActivity, FiChevronRight, FiList, FiBell, FiBriefcase
} from 'react-icons/fi';
import './EmployeeDashboard.css';

const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((p) => p[0]).join('').substring(0, 2).toUpperCase();
};

const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric'
    });
};

const formatExactTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
};

const getRelativeTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return formatDate(dateString);
};

const EmployeeDashboard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const actionCenterRef = useRef(null);

    const [stats, setStats] = useState({
        monthlyPlans: 0,
        monthlyAchievements: 0,
        yearlyPlans: 0,
        quarterlyEvals: 0,
    });

    const [loading, setLoading] = useState(true);
    const [actionItems, setActionItems] = useState([]);
    const [deadlines, setDeadlines] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [latestRemarks, setLatestRemarks] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [plansRes, achievementsRes, yearlyRes, quarterlyRes, evalsRes] = await Promise.all([
                    api.get('/employee/monthly-plans'),
                    api.get('/employee/monthly-achievements'),
                    api.get('/employee/yearly-plans'),
                    api.get('/ra/quarterly-evaluations'),
                    api.get('/ra/monthly-evaluations', { params: { limit: 100 } }),
                ]);

                const plans = plansRes.data || [];
                const achievements = achievementsRes.data || [];
                const yearly = yearlyRes.data || [];
                const evals = evalsRes.data?.data || [];

                setStats({
                    monthlyPlans: plans.length,
                    monthlyAchievements: achievements.length,
                    yearlyPlans: yearly.length,
                    quarterlyEvals: quarterlyRes.data?.totalRecords || 0,
                });

                // --- 1. Compute Action Items ---
                const actions = [];
                const activities = [];
                const remarks = [];

                const now = new Date();
                const currentMonthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const currentFinancialYear = now.getMonth() >= 3
                    ? `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, '0')}`
                    : `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, '0')}`;

                // Check Monthly Plan for current month
                const currentPlan = plans.find(p => p.month === currentMonthString);
                if (!currentPlan) {
                    const md = new Date(currentMonthString + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    actions.push({
                        id: 'submit_plan',
                        type: 'warning',
                        title: 'Submit Monthly Plan',
                        desc: `Your plan for ${md} is missing.`,
                        link: '/employee/monthly-plan',
                        btnText: 'Submit Now'
                    });
                }

                // Track actions for all plans (rejections or missing achievements)
                plans.forEach(plan => {
                    const monthParts = plan.month.split('-');
                    const monthDisplay = new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                    if (plan.status === 'REJECTED') {
                        actions.push({
                            id: `resubmit_plan_${plan._id}`,
                            type: 'danger',
                            title: `Resubmit Monthly Plan`,
                            desc: `Your plan for ${monthDisplay} was rejected by MD.`,
                            link: '/employee/monthly-plan',
                            btnText: 'Resubmit'
                        });
                    } else if (['PENDING', 'APPROVED', 'RA_EVALUATED'].includes(plan.status)) {
                        // Check if achievement submitted
                        const achievement = achievements.find(a => a.monthlyPlanId?._id === plan._id || a.monthlyPlanId === plan._id);
                        if (!achievement || achievement.status === 'DRAFT') {
                            actions.push({
                                id: `submit_ach_${plan._id}`,
                                type: 'primary',
                                title: `Submit Monthly Achievement`,
                                desc: `Pending achievement submission for ${monthDisplay}.`,
                                link: '/employee/monthly-plan',
                                btnText: 'Submit Target'
                            });
                        }
                    }
                });

                // Check Yearly Plan
                const currentYearly = yearly.find(y => y.financialYear === currentFinancialYear);
                if (!currentYearly) {
                    actions.push({
                        id: 'submit_yearly',
                        type: 'warning',
                        title: 'Submit Yearly Plan',
                        desc: `Your yearly plan for FY ${currentFinancialYear} is pending.`,
                        link: '/employee/yearly-plan',
                        btnText: 'Submit Yearly Plan'
                    });
                }

                setActionItems(actions);

                // --- 2. Compute Deadlines ---
                const dls = [];
                // Monthly Plan Deadline: 10th of current month
                const planDeadline = new Date(now.getFullYear(), now.getMonth(), 10, 23, 59, 59);
                const planDiff = Math.ceil((planDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                // Achievement Deadline: Last day of current month
                const achDeadline = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
                const achDiff = Math.ceil((achDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                const currMonthDisplay = new Date(now.getFullYear(), now.getMonth()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                if (!currentPlan && planDiff >= -10) { // Limit showing overdue deadlines to a reasonable amount
                    dls.push({
                        title: `Monthly Plan (${currMonthDisplay})`,
                        date: planDeadline,
                        days: planDiff,
                        critical: planDiff <= 2
                    });
                }

                // Check if current month needs an achievement
                const hasCurrentAchievement = achievements.some(a => a.monthlyPlanId?._id === currentPlan?._id || a.monthlyPlanId === currentPlan?._id);
                if (currentPlan && !hasCurrentAchievement && achDiff >= -10) {
                    dls.push({
                        title: `Monthly Achievement (${currMonthDisplay})`,
                        date: achDeadline,
                        days: achDiff,
                        critical: achDiff <= 3
                    });
                }

                setDeadlines(dls.sort((a, b) => a.days - b.days));

                // --- 3. Compute Recent Activity ---
                plans.forEach(p => activities.push({
                    type: 'Plan ' + p.status,
                    desc: `Monthly Plan for ${p.month}`,
                    date: new Date(p.submittedAt || p.createdAt || Date.now()),
                    icon: <FiCalendar />
                }));
                achievements.forEach(a => activities.push({
                    type: 'Achievement ' + a.status,
                    desc: `Monthly Achievement submitted`,
                    date: new Date(a.submittedAt || a.createdAt || Date.now()),
                    icon: <FiTarget />
                }));
                yearly.forEach(y => activities.push({
                    type: 'Yearly Plan ' + y.status,
                    desc: `FY ${y.financialYear}`,
                    date: new Date(y.submittedAt || y.createdAt || Date.now()),
                    icon: <FiBriefcase />
                }));

                activities.sort((a, b) => b.date - a.date);
                setRecentActivity(activities.slice(0, 5));

                // --- 4. Compute Latest Remarks ---
                try {
                    plans.forEach(p => {
                        if (p.mdRemarks && typeof p.mdRemarks === 'string' && p.mdRemarks.trim() !== '') {
                            const monthParts = p.month ? p.month.split('-') : [];
                            const mDisp = monthParts.length === 2 ? new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown Month';
                            remarks.push({ source: 'MD', text: p.mdRemarks, context: `Plan ${mDisp}`, date: new Date(p.updatedAt || p.submittedAt || p.createdAt || Date.now()) });
                        }
                    });

                    evals.forEach(ev => {
                        if (ev.remarks && typeof ev.remarks === 'string' && ev.remarks.trim() !== '') {
                            const monthParts = ev.month ? ev.month.split('-') : [];
                            const mDisp = monthParts.length === 2 ? new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown Month';
                            remarks.push({ source: 'RA', text: ev.remarks, context: `Evaluation ${mDisp}`, date: new Date(ev.updatedAt || ev.createdAt || Date.now()) });
                        }
                    });

                    const qEvals = Array.isArray(quarterlyRes.data) ? quarterlyRes.data : (quarterlyRes.data?.data || []);
                    qEvals.forEach(q => {
                        if (q.mdRemarks && typeof q.mdRemarks === 'string' && q.mdRemarks.trim() !== '') remarks.push({ source: 'MD', text: q.mdRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                        if (q.hrdRemarks && typeof q.hrdRemarks === 'string' && q.hrdRemarks.trim() !== '') remarks.push({ source: 'HRD', text: q.hrdRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                        if (q.raRemarks && typeof q.raRemarks === 'string' && q.raRemarks.trim() !== '') remarks.push({ source: 'RA', text: q.raRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                    });

                    remarks.sort((a, b) => b.date.getTime() - a.date.getTime());

                    // Deduplicate by text/context to avoid clutter
                    const uniqueRemarks = [];
                    const seen = new Set();
                    for (const r of remarks) {
                        const key = r.source + r.text + r.context;
                        if (!seen.has(key)) {
                            seen.add(key);
                            uniqueRemarks.push(r);
                        }
                    }
                    setLatestRemarks(uniqueRemarks.slice(0, 5));
                } catch (remarkErr) {
                    console.error('Error parsing remarks:', remarkErr);
                }

            } catch (err) {
                console.error('Failed to load dashboard stats', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const scrollToActions = () => {
        if (actionCenterRef.current) {
            actionCenterRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    if (loading) {
        return (
            <div className="emp-dash-loading">
                <div className="emp-dash-spinner" />
                <p>Loading your workspace...</p>
            </div>
        );
    }

    return (
        <div className="emp-dash-page fade-in">

            {/* ── HERO HEADER ── */}
            <div className="emp-dash-hero">
                <div className="emp-dash-hero-left">
                    <div className="emp-dash-avatar">{getInitials(user?.name)}</div>
                    <div>
                        <h1 className="emp-dash-greeting">Welcome back, {user?.name || 'Employee'}!</h1>
                        <p className="emp-dash-subtitle">Here is your KRA performance overview for the current cycle.</p>
                    </div>
                </div>
                {actionItems.length > 0 && (
                    <div className="emp-dash-hero-right" onClick={scrollToActions}>
                        <div className="emp-dash-task-badge">
                            <FiBell className="emp-dash-task-icon" />
                            <span>{actionItems.length} Pending Task{actionItems.length > 1 ? 's' : ''}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── EXISTING STATS GRID ── */}
            <div className="emp-dash-stats-grid">
                <div className="emp-dash-stat-card">
                    <div className="emp-dash-stat-icon orange"><FiCalendar /></div>
                    <div className="emp-dash-stat-info">
                        <h4>Monthly Plans</h4>
                        <div className="emp-dash-stat-val">{stats.monthlyPlans}</div>
                    </div>
                </div>
                <div className="emp-dash-stat-card">
                    <div className="emp-dash-stat-icon green"><FiTrendingUp /></div>
                    <div className="emp-dash-stat-info">
                        <h4>Monthly Achievements</h4>
                        <div className="emp-dash-stat-val">{stats.monthlyAchievements}</div>
                    </div>
                </div>
                <div className="emp-dash-stat-card">
                    <div className="emp-dash-stat-icon blue"><FiBarChart2 /></div>
                    <div className="emp-dash-stat-info">
                        <h4>Quarterly Evals</h4>
                        <div className="emp-dash-stat-val">{stats.quarterlyEvals}</div>
                    </div>
                </div>
                <div className="emp-dash-stat-card">
                    <div className="emp-dash-stat-icon yellow"><FiTarget /></div>
                    <div className="emp-dash-stat-info">
                        <h4>Yearly Plans</h4>
                        <div className="emp-dash-stat-val">{stats.yearlyPlans}</div>
                    </div>
                </div>
            </div>

            {/* ── EXISTING QUICK LINKS CARDS ── */}
            <div className="emp-dash-quicklinks-grid">
                <Link to="/employee/monthly-plan" className="emp-dash-link-card">
                    <div className="emp-dash-link-icon orange"><FiCalendar /></div>
                    <h3>Monthly Plan</h3>
                    <p>Submit and view your monthly work plans and achievements</p>
                    <span className="emp-dash-link-cta">Go to Monthly Plan <FiChevronRight /></span>
                </Link>
                <Link to="/employee/quarterly-evaluation" className="emp-dash-link-card">
                    <div className="emp-dash-link-icon blue"><FiBarChart2 /></div>
                    <h3>Quarterly Evaluation</h3>
                    <p>View quarterly evaluation remarks from your reporting authority</p>
                    <span className="emp-dash-link-cta">View Evaluations <FiChevronRight /></span>
                </Link>
                <Link to="/employee/yearly-plan" className="emp-dash-link-card">
                    <div className="emp-dash-link-icon yellow"><FiTarget /></div>
                    <h3>Yearly Plan</h3>
                    <p>Submit and track your yearly plan and appraisals</p>
                    <span className="emp-dash-link-cta">Go to Yearly Plan <FiChevronRight /></span>
                </Link>
            </div>

            {/* ── MAIN WORKFLOW GRID ── */}
            <div className="emp-dash-main-grid">

                {/* LEFT COLUMN: Actions & Activity */}
                <div className="emp-dash-col-main">

                    {/* ACTION CENTER */}
                    <div className="emp-dash-section" ref={actionCenterRef}>
                        <div className="emp-dash-section-header">
                            <div className="emp-dash-section-icon"><FiList /></div>
                            <h2>Action Center</h2>
                        </div>
                        {actionItems.length === 0 ? (
                            <div className="emp-dash-empty">
                                <FiCheckCircle className="emp-dash-empty-icon" />
                                <p>You are all caught up! No pending tasks.</p>
                            </div>
                        ) : (
                            <div className="emp-dash-action-list">
                                {actionItems.map(item => (
                                    <div key={item.id} className={`emp-dash-action-item emp-dash-action--${item.type}`}>
                                        <div className="emp-dash-action-content">
                                            <div className="emp-dash-action-icon">
                                                {item.type === 'danger' ? <FiAlertCircle /> : <FiClock />}
                                            </div>
                                            <div>
                                                <h4>{item.title}</h4>
                                                <p>{item.desc}</p>
                                            </div>
                                        </div>
                                        <button className={`btn ${item.type === 'danger' || item.type === 'primary' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => navigate(item.link)}>
                                            {item.btnText}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* RECENT ACTIVITY */}
                    <div className="emp-dash-section">
                        <div className="emp-dash-section-header">
                            <div className="emp-dash-section-icon blue"><FiActivity /></div>
                            <h2>Recent Activity</h2>
                        </div>
                        <div className="emp-dash-timeline">
                            {recentActivity.length === 0 ? (
                                <p className="emp-dash-muted">No recent activity found.</p>
                            ) : (
                                recentActivity.map((act, i) => (
                                    <div key={i} className="emp-dash-timeline-item">
                                        <div className="emp-dash-timeline-icon">{act.icon}</div>
                                        <div className="emp-dash-timeline-content">
                                            <strong>{act.type}</strong>
                                            <p>{act.desc}</p>
                                            <span>{getRelativeTime(act.date)}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Deadlines & Remarks */}
                <div className="emp-dash-col-side">

                    {/* DEADLINES */}
                    <div className="emp-dash-section">
                        <div className="emp-dash-section-header">
                            <div className="emp-dash-section-icon yellow"><FiClock /></div>
                            <h2>Upcoming Deadlines</h2>
                        </div>
                        <div className="emp-dash-deadlines">
                            {deadlines.length === 0 ? (
                                <p className="emp-dash-muted">No immediate deadlines.</p>
                            ) : (
                                deadlines.map((dl, i) => (
                                    <div key={i} className={`emp-dash-dl-card ${dl.critical ? 'emp-dash-dl--critical' : ''}`}>
                                        <div className="emp-dash-dl-info">
                                            <strong>{dl.title}</strong>
                                            <span>{formatDate(dl.date)}</span>
                                        </div>
                                        <div className="emp-dash-dl-days">
                                            {dl.days === 0 ? 'Today' : `${dl.days} day${dl.days > 1 ? 's' : ''}`}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* LATEST REMARKS */}
                    <div className="emp-dash-section">
                        <div className="emp-dash-section-header">
                            <div className="emp-dash-section-icon purple"><FiMessageSquare /></div>
                            <h2>Latest Remarks</h2>
                        </div>
                        <div className="emp-dash-remarks-list">
                            {latestRemarks.length === 0 ? (
                                <p className="emp-dash-muted">No remarks available yet.</p>
                            ) : (
                                latestRemarks.map((rem, i) => (
                                    <div key={i} className="emp-dash-remark-card">
                                        <div className="emp-dash-remark-head">
                                            <span className={`emp-dash-remark-source source-${rem.source.toLowerCase()}`}>
                                                {rem.source}
                                            </span>
                                            <span className="emp-dash-remark-date">{formatExactTime(rem.date)}</span>
                                        </div>
                                        <p className="emp-dash-remark-text">"{rem.text}"</p>
                                        <div className="emp-dash-remark-context">{rem.context}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default EmployeeDashboard;
