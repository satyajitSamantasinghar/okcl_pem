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
// FISCAL YEAR FIX — shared fiscal utility
import { getFiscalYearShort } from '../../utils/fiscalUtils';
// CENTRALIZED DEADLINE CONFIG — single source of truth via DeadlineContext
import { useDeadlines } from '../../context/DeadlineContext';

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

// EXTENSION AWARENESS — parses a "YYYY-MM-DD" DATEONLY string (as returned by
// GET /employee/my-deadline-context) into a local end-of-day Date. Mirrors
// parseDateOnlyEndOfDay() in DeadlineContext.jsx so both sides agree on what
// "the deadline" means down to the millisecond.
const parseDateOnlyEndOfDay = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 23, 59, 59, 999);
};

// ACTION CENTER — due-by chip for a given deadline Date, relative to a
// reference Date (pass `now` from fetchData so every chip in the same pass
// is computed against the same instant).
const getDueChip = (deadlineDate, referenceDate) => {
    if (!deadlineDate) return null;
    const ref = referenceDate || new Date();
    const diffDays = Math.floor((deadlineDate.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: 'danger' };
    if (diffDays === 0) return { label: 'Due today', tone: 'warning' };
    if (diffDays <= 2) return { label: `Due in ${diffDays}d`, tone: 'warning' };
    return { label: `Due in ${diffDays}d`, tone: 'neutral' };
};

const EmployeeDashboard = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const actionCenterRef = useRef(null);
    // CENTRALIZED DEADLINE CONFIG — plan & achievement days from .env via API
    const { getPlanDeadline, getAchievementWindowStart, getAchievementDeadline, isLoading: isConfigLoading } = useDeadlines();

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
        if (isConfigLoading) return; // Wait for config to load so deadlines are correct
        const fetchData = async () => {
            try {
                const now = new Date();
                const currentMonthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                const [
                    plansRes, achievementsRes, yearlyRes, quarterlyRes, evalsRes, appraisalRes,
                    planDeadlineCtxRes, achDeadlineCtxRes
                ] = await Promise.all([
                    api.get('/employee/monthly-plans'),
                    api.get('/employee/monthly-achievements'),
                    api.get('/employee/yearly-plans'),
                    // asEmployee=true: when the logged-in user is an RA, return quarterly
                    // evaluations given TO them (by their RA/MD), not ones they gave to others.
                    // For plain EMPLOYEE users this param is ignored by the backend.
                    api.get('/ra/quarterly-evaluations', { params: { asEmployee: 'true' } }),
                    // selfView=true: return monthly evaluations where this user IS the
                    // employee being evaluated, not the RA who evaluated others.
                    api.get('/ra/monthly-evaluations', { params: { limit: 100, selfView: 'true' } }),
                    api.get('/employee/yearly-appraisal-reports').catch(() => ({ data: [] })),
                    // EXTENSION AWARENESS — own-user counterpart of the RA's
                    // /ra/extend-deadline/context endpoint (GET /employee/my-deadline-context).
                    // Scoped server-side to req.user.userId, so any employee can check their
                    // OWN effective deadline without RA credentials. Falls back to null on any
                    // error so the dashboard degrades gracefully to the BASE deadline.
                    api.get('/employee/my-deadline-context', {
                        params: { month: now.getMonth() + 1, year: now.getFullYear(), type: 'PLAN' }
                    }).catch(() => null),
                    api.get('/employee/my-deadline-context', {
                        params: { month: now.getMonth() + 1, year: now.getFullYear(), type: 'ACHIEVEMENT' }
                    }).catch(() => null),
                ]);

                const plans = plansRes.data || [];
                const achievements = achievementsRes.data || [];
                const yearly = yearlyRes.data || [];
                const evals = evalsRes.data?.data || [];
                const appraisals = appraisalRes.data || [];
                const planCtx = planDeadlineCtxRes?.data || null;
                const achCtx = achDeadlineCtxRes?.data || null;

                setStats({
                    monthlyPlans: plans.length,
                    monthlyAchievements: achievements.length,
                    yearlyPlans: yearly.length,
                    quarterlyEvals: quarterlyRes.data?.totalRecords || 0,
                });

                // FISCAL YEAR FIX — was: getMonth() >= 3 ? year : year-1
                // Using getFiscalYearShort() from fiscalUtils for consistency
                const currentFinancialYear = getFiscalYearShort(now);

                // --- 1. Resolve EFFECTIVE (extension-aware) deadlines for the current month ---
                // Monthly Plan — falls back to the BASE config deadline if the context call failed.
                const planDeadline = planCtx
                    ? parseDateOnlyEndOfDay(planCtx.effectiveDeadline)
                    : getPlanDeadline(currentMonthString);
                const planIsExtended = !!planCtx?.isExtended;
                const planOriginalDeadline = planIsExtended && planCtx?.baseDeadline
                    ? parseDateOnlyEndOfDay(planCtx.baseDeadline)
                    : null;
                const planExtensionReason = planIsExtended ? (planCtx?.reason || null) : null;
                const planExtendedAt = planIsExtended ? (planCtx?.extendedAt || null) : null;
                // BUG FIX: Use Math.floor so that when the deadline IS today (fraction < 1 day remaining)
                // it correctly resolves to 0 ("Today") instead of 1. Math.ceil incorrectly rounded
                // 0.54 days → 1, hiding the "Today" display and skewing urgency checks.
                const planDiff = planDeadline
                    ? Math.floor((planDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    : 999;

                // Achievement window: bounded on both sides —
                // getAchievementWindowStart() = opens (BASE — window-open is never extended),
                // effective achievement deadline = closes (extension-aware).
                const achStart = getAchievementWindowStart(currentMonthString);
                const achDeadline = achCtx
                    ? parseDateOnlyEndOfDay(achCtx.effectiveDeadline)
                    : getAchievementDeadline(currentMonthString);
                const achIsExtended = !!achCtx?.isExtended;
                const achOriginalDeadline = achIsExtended && achCtx?.baseDeadline
                    ? parseDateOnlyEndOfDay(achCtx.baseDeadline)
                    : null;
                const achExtensionReason = achIsExtended ? (achCtx?.reason || null) : null;
                const achExtendedAt = achIsExtended ? (achCtx?.extendedAt || null) : null;
                const windowNotYetOpen = achStart && now < achStart;

                // BUG FIX: Same Math.floor fix — deadline on last day of month with "last" config
                // was yielding achDiff=1 all day, so the "Today" badge never appeared.
                const achDiff = achDeadline
                    ? Math.floor((achDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    : 999;
                const achStartDiff = achStart
                    ? Math.floor((achStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    : 999;

                const currMonthDisplay = new Date(now.getFullYear(), now.getMonth()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                // Yearly Plan / Appraisal deadlines have no extension mechanism —
                // DeadlineExtension only covers type PLAN/ACHIEVEMENT (see raController.js
                // extendDeadline validation) — so these stay BASE-only, as before.
                const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
                const fyEndYear = fyStartYear + 1;
                const yearlyPlanDeadline = new Date(fyStartYear, 3, 30, 23, 59, 59);

                // --- 2. Compute Action Items ---
                const actions = [];
                const activities = [];
                const remarks = [];

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
                        btnText: 'Submit Now',
                        dueChip: getDueChip(planDeadline, now),
                        isExtended: planIsExtended,
                    });
                }

                // Track actions for all plans (rejections or missing achievements)
                plans.forEach(plan => {
                    const monthParts = plan.month.split('-');
                    const monthDisplay = new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    const isCurrentMonth = plan.month === currentMonthString;

                    if (plan.status === 'REJECTED') {
                        // Other-month due-by context uses the BASE deadline (synchronous,
                        // no extra network round-trip per historical plan). The current
                        // month reuses the already-fetched EFFECTIVE deadline above.
                        const baseDl = isCurrentMonth ? planDeadline : getPlanDeadline(plan.month);
                        actions.push({
                            id: `resubmit_plan_${plan.id}`,
                            type: 'danger',
                            title: `Resubmit Monthly Plan`,
                            desc: `Your plan for ${monthDisplay} was rejected by your Reporting Authority (RA).`,
                            link: '/employee/monthly-plan',
                            btnText: 'Resubmit',
                            dueChip: getDueChip(baseDl, now),
                            isExtended: isCurrentMonth && planIsExtended,
                        });
                    } else if (['PENDING', 'APPROVED', 'RA_EVALUATED'].includes(plan.status)) {
                        // Check if achievement submitted
                        const achievement = achievements.find(a => a.monthlyPlanId?.id === plan.id || a.monthlyPlanId === plan.id);
                        if (!achievement || achievement.status === 'DRAFT') {
                            const achDl = isCurrentMonth ? achDeadline : getAchievementDeadline(plan.month);
                            actions.push({
                                id: `submit_ach_${plan.id}`,
                                type: 'primary',
                                title: `Submit Monthly Progress`,
                                desc: `Pending progress submission for ${monthDisplay}.`,
                                link: '/employee/monthly-plan',
                                btnText: 'Submit Progress',
                                dueChip: getDueChip(achDl, now),
                                isExtended: isCurrentMonth && achIsExtended,
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
                        btnText: 'Submit Yearly Plan',
                        dueChip: getDueChip(yearlyPlanDeadline, now),
                    });
                }

                setActionItems(actions);

                // --- 3. Compute Upcoming Deadlines (all active types, extension-aware) ---
                const dls = [];

                if (!currentPlan && planDiff >= -10) { // Limit showing overdue deadlines to a reasonable amount
                    dls.push({
                        title: `Monthly Plan (${currMonthDisplay})`,
                        date: planDeadline,
                        days: planDiff,
                        critical: planDiff <= 2,
                        isExtended: planIsExtended,
                        originalDate: planOriginalDeadline,
                        extensionReason: planExtensionReason,
                        extendedAt: planExtendedAt,
                    });
                }

                // BUG FIX: The original condition required `currentPlan &&` — meaning the achievement
                // deadline was NEVER shown when the current month had no submitted plan (even if other
                // months had pending achievements). Fix: check if ANY approved/pending plan is missing
                // an achievement, and show the deadline whenever the window is open.
                const anyPlanNeedsAchievement = plans.some(plan => {
                    if (!['PENDING', 'APPROVED', 'RA_EVALUATED'].includes(plan.status)) return false;
                    const hasAch = achievements.some(
                        a => a.monthlyPlanId?.id === plan.id || a.monthlyPlanId === plan.id
                    );
                    return !hasAch;
                });
                // Also show if current month's plan exists and its achievement is missing
                const hasCurrentAchievement = currentPlan
                    ? achievements.some(a => a.monthlyPlanId?.id === currentPlan.id || a.monthlyPlanId === currentPlan.id)
                    : false;
                const needsAchievementDeadline = anyPlanNeedsAchievement || (currentPlan && !hasCurrentAchievement);

                if (needsAchievementDeadline && windowNotYetOpen && achStartDiff >= 0) {
                    dls.push({
                        title: `Monthly Progress Window Opens (${currMonthDisplay})`,
                        date: achStart,
                        days: achStartDiff,
                        critical: false
                    });
                } else if (needsAchievementDeadline && achDiff >= -10) {
                    dls.push({
                        title: `Monthly Progress(${currMonthDisplay})`,
                        date: achDeadline,
                        days: achDiff,
                        critical: achDiff <= 3,
                        isExtended: achIsExtended,
                        originalDate: achOriginalDeadline,
                        extensionReason: achExtensionReason,
                        extendedAt: achExtendedAt,
                    });
                }

                // Yearly Plan Deadline: 30 April of FY start year
                const yearlyPlanDiff = Math.ceil((yearlyPlanDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                if (!currentYearly && yearlyPlanDiff >= -30) {
                    dls.push({
                        title: `Yearly Plan (FY ${currentFinancialYear})`,
                        date: yearlyPlanDeadline,
                        days: yearlyPlanDiff,
                        critical: yearlyPlanDiff <= 7
                    });
                }

                // Yearly Appraisal Report Deadline: 30 April of FY end year
                const yearlyAppraisalDeadline = new Date(fyEndYear, 3, 30, 23, 59, 59);
                const yearlyAppraisalDiff = Math.ceil((yearlyAppraisalDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                
                const hasAppraisal = appraisals.some(a => a.financialYear === currentFinancialYear && a.status !== 'DRAFT');
                
                // Show appraisal deadline if within a reasonable window (e.g. from March 1st of endYear to April 30th)
                const yearlyAppraisalWindowOpen = new Date(fyEndYear, 2, 1, 0, 0, 0); // 1st March
                const daysUntilWindowOpen = Math.ceil((yearlyAppraisalWindowOpen.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                if (!hasAppraisal && yearlyAppraisalDiff >= -30 && daysUntilWindowOpen <= 30) {
                    dls.push({
                        title: `Yearly Appraisal (FY ${currentFinancialYear})`,
                        date: yearlyAppraisalDeadline,
                        days: yearlyAppraisalDiff,
                        critical: yearlyAppraisalDiff <= 7
                    });
                }

                setDeadlines(dls.sort((a, b) => a.days - b.days));

                // --- 4. Compute Recent Activity ---
                plans.forEach(p => activities.push({
                    type: 'Plan ' + p.status,
                    desc: `Monthly Plan for ${p.month}`,
                    date: new Date(p.submittedAt || p.createdAt || Date.now()),
                    icon: <FiCalendar />
                }));
                achievements.forEach(a => activities.push({
                    type: 'Monthly Progress ' + a.status,
                    desc: `Monthly Progress submitted`,
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

                // --- 5. Compute Latest Remarks (color-coded by type; includes extension events) ---
                try {
                    plans.forEach(p => {
                        // Show raRemarks (new rejection reason) — fall back to mdRemarks for old data
                        const rejectionRemark = p.raRemarks || p.mdRemarks;
                        if (rejectionRemark && typeof rejectionRemark === 'string' && rejectionRemark.trim() !== '') {
                            const monthParts = p.month ? p.month.split('-') : [];
                            const mDisp = monthParts.length === 2 ? new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown Month';
                            remarks.push({ source: 'RA', type: 'rejection', text: rejectionRemark, context: `Plan ${mDisp} (Rejection Reason)`, date: new Date(p.updatedAt || p.submittedAt || p.createdAt || Date.now()) });
                        }
                    });

                    evals.forEach(ev => {
                        if (ev.remarks && typeof ev.remarks === 'string' && ev.remarks.trim() !== '') {
                            const monthParts = ev.month ? ev.month.split('-') : [];
                            const mDisp = monthParts.length === 2 ? new Date(monthParts[0], parseInt(monthParts[1]) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown Month';
                            remarks.push({ source: 'RA', type: 'evaluation', text: ev.remarks, context: `Evaluation ${mDisp}`, date: new Date(ev.updatedAt || ev.createdAt || Date.now()) });
                        }
                    });

                    const qEvals = Array.isArray(quarterlyRes.data) ? quarterlyRes.data : (quarterlyRes.data?.data || []);
                    qEvals.forEach(q => {
                        if (q.mdRemarks && typeof q.mdRemarks === 'string' && q.mdRemarks.trim() !== '') remarks.push({ source: 'MD', type: 'evaluation', text: q.mdRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                        if (q.hrdRemarks && typeof q.hrdRemarks === 'string' && q.hrdRemarks.trim() !== '') remarks.push({ source: 'HRD', type: 'evaluation', text: q.hrdRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                        if (q.raRemarks && typeof q.raRemarks === 'string' && q.raRemarks.trim() !== '') remarks.push({ source: 'RA', type: 'evaluation', text: q.raRemarks, context: `Q-Eval FY ${q.financialYear || ''}`, date: new Date(q.updatedAt || q.createdAt || Date.now()) });
                    });

                    // SURFACE EXTENSION EVENTS — the same signal that already powers the
                    // in-system Notification row on the backend (raController.js
                    // extendDeadline → Notification.create when notifyEmployee=true) is
                    // rendered here as a distinct, color-coded "SYSTEM" remark so the
                    // employee sees it in-context without hunting through other pages.
                    if (planIsExtended && planExtendedAt) {
                        remarks.push({
                            source: 'RA',
                            type: 'extension',
                            text: planExtensionReason || 'Your Reporting Authority extended this deadline.',
                            context: `Plan ${currMonthDisplay} — Deadline Extended`,
                            date: new Date(planExtendedAt),
                        });
                    }
                    if (achIsExtended && achExtendedAt) {
                        remarks.push({
                            source: 'RA',
                            type: 'extension',
                            text: achExtensionReason || 'Your Reporting Authority extended this deadline.',
                            context: `Monthly Progress ${currMonthDisplay} — Deadline Extended`,
                            date: new Date(achExtendedAt),
                        });
                    }

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
    }, [isConfigLoading]);

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
                        <h4>Monthly Progress</h4>
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
                    <p>Submit and view your monthly work plans and progress</p>
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
                                                {(item.dueChip || item.isExtended) && (
                                                    <div className="emp-dash-action-chips">
                                                        {item.dueChip && (
                                                            <span className={`emp-dash-action-chip chip--${item.dueChip.tone}`}>
                                                                {item.dueChip.label}
                                                            </span>
                                                        )}
                                                        {item.isExtended && (
                                                            <span className="emp-dash-action-chip chip--extended">Extended</span>
                                                        )}
                                                    </div>
                                                )}
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
                                    <div key={i} className={`emp-dash-dl-card ${dl.critical ? 'emp-dash-dl--critical' : ''} ${dl.isExtended ? 'emp-dash-dl--extended' : ''}`}>
                                        <div className="emp-dash-dl-info">
                                            <div className="emp-dash-dl-title-row">
                                                <strong>{dl.title}</strong>
                                                {dl.isExtended && (
                                                    <span
                                                        className="emp-dash-dl-extended-badge"
                                                        tabIndex={0}
                                                        data-tooltip={
                                                            dl.extensionReason
                                                                ? `Extended on ${formatDate(dl.extendedAt)} — "${dl.extensionReason}"`
                                                                : 'Deadline extended by your Reporting Authority'
                                                        }
                                                    >
                                                        Extended
                                                    </span>
                                                )}
                                            </div>
                                            {dl.isExtended && dl.originalDate ? (
                                                <span>
                                                    <span className="emp-dash-dl-original">{formatDate(dl.originalDate)}</span>{' '}
                                                    <span className="emp-dash-dl-effective">→ {formatDate(dl.date)}</span>
                                                </span>
                                            ) : (
                                                <span>{formatDate(dl.date)}</span>
                                            )}
                                        </div>
                                        <div className={`emp-dash-dl-days ${dl.days < 0 ? 'overdue' : ''}`}>
                                            {dl.days === 0
                                                ? 'Today'
                                                : dl.days < 0
                                                    ? `${Math.abs(dl.days)} day${Math.abs(dl.days) > 1 ? 's' : ''} overdue`
                                                    : `${dl.days} day${dl.days > 1 ? 's' : ''}`}
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
                                    <div key={i} className={`emp-dash-remark-card ${rem.type ? `remark--${rem.type}` : ''}`}>
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