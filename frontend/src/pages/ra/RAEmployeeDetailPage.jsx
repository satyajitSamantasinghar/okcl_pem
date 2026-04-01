import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiCalendar, FiBarChart2, FiFileText, FiUser,
    FiCheckCircle, FiTrendingUp, FiEye, FiClock, FiMessageSquare,
    FiX, FiAlertCircle, FiBriefcase, FiTarget, FiAward, FiFilter,
    FiTrendingDown, FiZap, FiActivity, FiStar, FiAlertTriangle,
    FiInfo, FiThumbsUp,
} from 'react-icons/fi';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import './RAEmployeeDetail.css';

/* ════════════════════════════════════════════════════
   PURE HELPERS — UNCHANGED
════════════════════════════════════════════════════ */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}
function formatMonth(m) {
    if (!m) return '';
    const [year, month] = m.split('-');
    return new Date(year, parseInt(month) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function shortMonth(m) {
    if (!m) return '';
    const [, month] = m.split('-');
    return new Date(2024, parseInt(month) - 1).toLocaleDateString('en-US', { month: 'short' });
}
function getScoreColor(score) {
    if (score >= 8) return '#22C55E';
    if (score >= 6) return '#F97316';
    if (score >= 4) return '#EAB308';
    return '#EF4444';
}
function getScoreLabel(score) {
    if (score >= 8) return 'Excellent';
    if (score >= 6) return 'Good';
    if (score >= 4) return 'Average';
    return 'Below Avg';
}

/* ════════════════════════════════════════════════════
   KPI CARD
════════════════════════════════════════════════════ */
function KPICard({ label, value, sub, icon, trend, color }) {
    return (
        <div className="red-kpi-card">
            <div className="red-kpi-top">
                <div className="red-kpi-icon" style={{ background: `${color}15`, color }}>{icon}</div>
                {trend && (
                    <span className={`red-kpi-trend red-kpi-trend--${trend}`}>
                        {trend === 'up' ? <FiTrendingUp /> : trend === 'down' ? <FiTrendingDown /> : <FiActivity />}
                    </span>
                )}
            </div>
            <div className="red-kpi-value" style={{ color: value === '—' ? 'var(--text-muted)' : undefined }}>{value}</div>
            <div className="red-kpi-label">{label}</div>
            {sub && <div className="red-kpi-sub">{sub}</div>}
        </div>
    );
}

/* ════════════════════════════════════════════════════
   INSIGHT PILL
════════════════════════════════════════════════════ */
function InsightPill({ icon, text, variant }) {
    return (
        <div className={`red-insight-pill red-insight-pill--${variant}`}>
            <span className="red-insight-pill-icon">{icon}</span>
            <span className="red-insight-pill-text">{text}</span>
        </div>
    );
}

/* ════════════════════════════════════════════════════
   CUSTOM RECHARTS TOOLTIP
════════════════════════════════════════════════════ */
function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
        <div className="red-chart-tooltip">
            <div className="red-chart-tooltip-label">{formatMonth(label) || label}</div>
            {payload.map((p, i) => (
                <div key={i} className="red-chart-tooltip-row">
                    <span className="red-chart-tooltip-dot" style={{ background: p.color || p.fill }} />
                    <span>{p.name}:</span>
                    <strong style={{ color: getScoreColor(p.value) }}>{p.value}/10</strong>
                </div>
            ))}
        </div>
    );
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════ */
const RAEmployeeDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedMonthDetail, setSelectedMonthDetail] = useState(null);
    const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));

    /* ── Fetch — UNCHANGED ── */
    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/ra/employee/${id}`);
                setData(res.data);
            } catch {
                toast.error('Failed to load employee detail or unauthorized access');
                navigate('/ra/employees');
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [id, navigate]);

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading employee details...</p>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="fade-in">
                <button className="red-back-btn" onClick={() => navigate('/ra/employees')}>
                    <FiArrowLeft /> Back to Directory
                </button>
                <div className="red-empty-center">Employee not found</div>
            </div>
        );
    }

    const {
        employee, monthlyPlans, monthlyAchievements,
        monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports,
    } = data;

    /* ── Unified monthly list — UNCHANGED ── */
    const unifiedMonths = monthlyPlans
        .filter(p => p.status !== 'DRAFT')
        .map(plan => {
            const evaluation = monthlyEvaluations.find(e => e.month === plan.month);
            const achievement = monthlyAchievements?.find(a => {
                const planId = typeof a.monthlyPlanId === 'object' ? a.monthlyPlanId?._id : a.monthlyPlanId;
                return planId === plan._id;
            });
            const isEval = !!evaluation && evaluation.status === 'EVALUATED';
            const hasAch = !!achievement && achievement.status !== 'DRAFT';
            return { ...plan, evaluation, achievement, hasAchievement: hasAch, isEval };
        });

    /* ── Year filter — UNCHANGED ── */
    const currentYear = new Date().getFullYear();
    const availableYearsSet = new Set(Array.from({ length: 12 }, (_, i) => String(currentYear + 2 - i)));
    monthlyPlans.forEach(p => { if (p.month) availableYearsSet.add(p.month.substring(0, 4)); });
    quarterlyEvaluations.forEach(q => { if (q.quarter) availableYearsSet.add(q.quarter.split('-')[1]); });
    yearlyPlans.forEach(y => { if (y.financialYear) availableYearsSet.add(y.financialYear.substring(0, 4)); });
    const availableYears = Array.from(availableYearsSet).sort((a, b) => b - a);

    const filteredMonths    = unifiedMonths.filter(m => m.month && m.month.startsWith(filterYear));
    const filteredQuarterly = quarterlyEvaluations.filter(q => q.quarter && q.quarter.includes(filterYear));
    const shortFilterYear   = filterYear.substring(2);
    const fyMatch = fy => fy && (fy.startsWith(filterYear) || fy.endsWith(`-${shortFilterYear}`));
    const filteredYearlyPlans   = yearlyPlans.filter(y => fyMatch(y.financialYear));
    const filteredYearlyReports = yearlyReports.filter(y => fyMatch(y.financialYear));
    const filteredEvals = monthlyEvaluations.filter(e => e.month && e.month.startsWith(filterYear));

    /* ── Stats — UNCHANGED ── */
    const evaluatedEvals = filteredEvals.filter(e => e.status === 'EVALUATED' && e.score > 0);
    const avgScore = evaluatedEvals.length > 0
        ? (evaluatedEvals.reduce((s, e) => s + e.score, 0) / evaluatedEvals.length).toFixed(1)
        : '—';

    /* ── KPI derived ── */
    const bestEval  = evaluatedEvals.length > 0 ? evaluatedEvals.reduce((b, e) => e.score > b.score ? e : b, evaluatedEvals[0]) : null;
    const worstEval = evaluatedEvals.length > 0 ? evaluatedEvals.reduce((w, e) => e.score < w.score ? e : w, evaluatedEvals[0]) : null;
    const completionRate = filteredMonths.length > 0
        ? Math.round((filteredMonths.filter(m => m.isEval).length / filteredMonths.length) * 100) : 0;
    const lastEval = evaluatedEvals.length > 0
        ? [...evaluatedEvals].sort((a, b) => b.month.localeCompare(a.month))[0] : null;
    const sortedEvalsByMonth = [...evaluatedEvals].sort((a, b) => a.month.localeCompare(b.month));
    const scoreTrend = sortedEvalsByMonth.length >= 2
        ? sortedEvalsByMonth[sortedEvalsByMonth.length - 1].score - sortedEvalsByMonth[sortedEvalsByMonth.length - 2].score
        : null;

    /* ── Insight pills ── */
    const insights = [];
    if (scoreTrend !== null) {
        const abs  = Math.abs(scoreTrend).toFixed(1);
        const prev = sortedEvalsByMonth[sortedEvalsByMonth.length - 2];
        const curr = sortedEvalsByMonth[sortedEvalsByMonth.length - 1];
        if (scoreTrend > 0)
            insights.push({ icon: <FiTrendingUp />, variant: 'positive', text: `Performance improved by +${abs} pts from ${shortMonth(prev.month)} → ${shortMonth(curr.month)}` });
        else if (scoreTrend < 0)
            insights.push({ icon: <FiTrendingDown />, variant: 'concern', text: `Performance dropped by −${abs} pts from ${shortMonth(prev.month)} → ${shortMonth(curr.month)}` });
        else
            insights.push({ icon: <FiActivity />, variant: 'neutral', text: `Score remained stable at ${curr.score}/10 — consistent performance` });
    }
    if (worstEval && worstEval.score < 5)
        insights.push({ icon: <FiAlertTriangle />, variant: 'warning', text: `Lowest score in ${formatMonth(worstEval.month)} (${worstEval.score}/10) — may need follow-up` });
    if (bestEval && bestEval.score >= 8)
        insights.push({ icon: <FiStar />, variant: 'positive', text: `Best performance in ${formatMonth(bestEval.month)} with ${bestEval.score}/10 — ${getScoreLabel(bestEval.score)} rating` });
    if (completionRate === 100 && filteredMonths.length > 0)
        insights.push({ icon: <FiThumbsUp />, variant: 'positive', text: `100% evaluation completion for ${filterYear} — all plans reviewed` });
    else if (completionRate < 50 && filteredMonths.length > 1)
        insights.push({ icon: <FiInfo />, variant: 'warning', text: `Only ${completionRate}% evaluated in ${filterYear} — ${filteredMonths.filter(m => !m.isEval).length} pending review` });
    if (evaluatedEvals.length >= 3) {
        const last3 = [...evaluatedEvals].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
        if (last3.every(e => Math.abs(e.score - parseFloat(avgScore)) <= 1.5))
            insights.push({ icon: <FiCheckCircle />, variant: 'positive', text: `Consistent scores across the last 3 months — reliable performance pattern` });
    }

    /* ── Header status ── */
    const headerStatus = completionRate === 100 && filteredMonths.length > 0
        ? { label: 'On Track', cls: 'green' }
        : completionRate < 50 && filteredMonths.length > 1
            ? { label: 'Needs Attention', cls: 'amber' }
            : { label: 'Active', cls: 'blue' };

    /* ── Tabs ── */
    const tabs = [
        { key: 'overview',  label: 'Analytics',      icon: <FiBarChart2 /> },
        { key: 'monthly',   label: 'Monthly Reviews', icon: <FiCalendar />, count: filteredMonths.length },
        { key: 'quarterly', label: 'Quarterly',       icon: <FiTarget />,   count: filteredQuarterly.length },
        { key: 'yearly',    label: 'Yearly',          icon: <FiAward />,    count: filteredYearlyPlans.length + filteredYearlyReports.length },
    ];

    /* ── Status badge helper — UNCHANGED ── */
    const getStatusBadge = plan => {
        if (plan.status === 'REJECTED') return <span className="red-badge red-badge--rejected">Rejected by MD</span>;
        if (plan.isEval)                return <span className="red-badge red-badge--evaluated">Evaluated</span>;
        if (plan.hasAchievement)        return <span className="red-badge red-badge--achievement">Achievement Submitted</span>;
        return <span className="red-badge red-badge--submitted">Plan Submitted</span>;
    };

    /* ════════════════════════════════════════════════════
       MONTHLY REVIEW MODAL
       Purpose: RA views plan details, achievement, and
       their own evaluation (score + remarks) for a month.
       Read-only. No action buttons except Close.
    ════════════════════════════════════════════════════ */
    const renderDetailModal = () => {
        if (!selectedMonthDetail) return null;
        const plan       = selectedMonthDetail;
        const ev         = plan.evaluation;
        const isEval     = plan.isEval;
        const ach        = plan.achievement;
        const isRejected = plan.status === 'REJECTED';

        const modalStatusCls = isRejected ? 'rejected'
            : isEval ? 'evaluated'
            : plan.hasAchievement ? 'achievement'
            : 'submitted';
        const modalStatusLabel = isRejected ? 'Rejected'
            : isEval ? 'Evaluated'
            : plan.hasAchievement ? 'Achievement Submitted'
            : 'Plan Submitted';

        /* 3-step progress */
        const steps = [
            { label: 'Plan Submitted', icon: <FiFileText />,    done: true },
            { label: 'Achievement',    icon: <FiTrendingUp />,  done: plan.hasAchievement },
            { label: 'Evaluated',      icon: <FiCheckCircle />, done: isEval },
        ];

        return (
            /* Overlay — stops propagation inside modal */
            <div className="red-overlay" onClick={() => setSelectedMonthDetail(null)}>
                <div className="red-modal" onClick={e => e.stopPropagation()}>

                    {/* ── HEADER (fixed, never scrolls) ── */}
                    <div className="red-modal-header">
                        <div className="red-modal-header-left">
                            <div className="red-modal-avatar">{getInitials(employee.name)}</div>
                            <div className="red-modal-header-info">
                                <div className="red-modal-title-row">
                                    <h2 className="red-modal-name">Monthly Review</h2>
                                    <span className={`red-badge red-badge--${modalStatusCls}`}>
                                        {modalStatusLabel}
                                    </span>
                                </div>
                                <p className="red-modal-sub">
                                    {employee.name}&nbsp;·&nbsp;{employee.employeeCode}&nbsp;·&nbsp;{formatMonth(plan.month)}
                                </p>
                            </div>
                        </div>
                        <button
                            className="red-modal-close-btn"
                            onClick={() => setSelectedMonthDetail(null)}
                            aria-label="Close"
                        >
                            <FiX />
                        </button>
                    </div>

                    {/* ── PROGRESS STEPPER (fixed, never scrolls) ── */}
                    <div className="red-modal-stepper">
                        {steps.map((step, i) => (
                            <div key={i} className="red-modal-stepper-item">
                                <div className={`red-modal-step-node ${step.done ? 'red-modal-step-node--done' : ''}`}>
                                    {step.icon}
                                </div>
                                <span className={`red-modal-step-label ${step.done ? 'red-modal-step-label--done' : ''}`}>
                                    {step.label}
                                </span>
                                {i < steps.length - 1 && (
                                    <div className={`red-modal-step-connector ${steps[i + 1].done ? 'red-modal-step-connector--done' : ''}`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* MD rejection banner */}
                    {isRejected && (
                        <div className="red-status-banner red-status-banner--rejected">
                            <FiAlertCircle /> This plan has been rejected by MD
                        </div>
                    )}

                    {/* ── SCROLLABLE BODY ── */}
                    <div className="red-modal-body">

                        {/* ── SECTION 1: Monthly Plan ── */}
                        <div className="red-modal-section">
                            <div className="red-modal-section-hd">
                                <div className="red-modal-section-icon red-modal-section-icon--blue">
                                    <FiFileText />
                                </div>
                                <span>Monthly Plan</span>
                                <span className="red-modal-section-meta-inline">
                                    <FiClock />
                                    Submitted&nbsp;
                                    {new Date(plan.submittedAt).toLocaleDateString('en-US', {
                                        day: 'numeric', month: 'short', year: 'numeric',
                                    })}
                                </span>
                            </div>
                            <div className="red-modal-section-body">
                                {plan.planDetails
                                    ? <p className="red-modal-text">{plan.planDetails}</p>
                                    : <p className="red-modal-empty-text">No plan details provided.</p>
                                }
                            </div>
                        </div>

                        {/* ── SECTION 2: Achievement ── */}
                        <div className="red-modal-section">
                            <div className="red-modal-section-hd">
                                <div className="red-modal-section-icon red-modal-section-icon--green">
                                    <FiTrendingUp />
                                </div>
                                <span>Achievement</span>
                                {plan.hasAchievement && ach && (
                                    <span className="red-modal-section-meta-inline">
                                        <FiClock />
                                        Submitted&nbsp;
                                        {new Date(ach.submittedAt).toLocaleDateString('en-US', {
                                            day: 'numeric', month: 'short', year: 'numeric',
                                        })}
                                    </span>
                                )}
                            </div>
                            <div className="red-modal-section-body">
                                {plan.hasAchievement && ach
                                    ? <p className="red-modal-text">{ach.achievementDetails || '—'}</p>
                                    : <div className="red-modal-not-submitted">
                                        <FiClock /> Achievement not yet submitted
                                    </div>
                                }
                            </div>
                        </div>

                        {/* ── SECTION 3: RA Evaluation ── */}
                        <div className="red-modal-section red-modal-section--last">
                            <div className="red-modal-section-hd">
                                <div className="red-modal-section-icon red-modal-section-icon--orange">
                                    <FiMessageSquare />
                                </div>
                                <span>RA Evaluation</span>
                            </div>
                            <div className="red-modal-section-body">
                                {isEval ? (
                                    <>
                                        {/* Score row */}
                                        <div className="red-eval-score-row">
                                            {/* Big score circle */}
                                            <div
                                                className="red-eval-score-circle"
                                                style={{ borderColor: getScoreColor(ev.score), color: getScoreColor(ev.score) }}
                                            >
                                                <span className="red-eval-score-num">{ev.score}</span>
                                                <span className="red-eval-score-denom">/10</span>
                                            </div>

                                            {/* Progress + label */}
                                            <div className="red-eval-score-detail">
                                                <div className="red-eval-label-row">
                                                    <span
                                                        className="red-eval-label-chip"
                                                        style={{
                                                            background: `${getScoreColor(ev.score)}18`,
                                                            color: getScoreColor(ev.score),
                                                        }}
                                                    >
                                                        {getScoreLabel(ev.score)}
                                                    </span>
                                                    <span className="red-eval-pct">{ev.score * 10}% of max</span>
                                                </div>
                                                <div className="red-eval-bar-track">
                                                    <div
                                                        className="red-eval-bar-fill"
                                                        style={{
                                                            width: `${ev.score * 10}%`,
                                                            background: getScoreColor(ev.score),
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Remarks */}
                                        <div className="red-eval-remarks-wrap">
                                            <div className="red-eval-remarks-label">
                                                <FiMessageSquare /> Remarks
                                            </div>
                                            {ev.remarks
                                                ? <p className="red-eval-remarks-text">{ev.remarks}</p>
                                                : <p className="red-modal-empty-text" style={{ margin: 0 }}>No remarks provided.</p>
                                            }
                                        </div>
                                    </>
                                ) : (
                                    <div className="red-modal-not-submitted">
                                        <FiClock /> This month has not been evaluated yet.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* MD rejection remarks */}
                        {isRejected && plan.mdRemarks && (
                            <div className="red-modal-section red-modal-section--danger red-modal-section--last">
                                <div className="red-modal-section-hd">
                                    <div className="red-modal-section-icon red-modal-section-icon--danger">
                                        <FiAlertCircle />
                                    </div>
                                    <span>MD Rejection Remarks</span>
                                </div>
                                <div className="red-modal-section-body">
                                    <p className="red-modal-text red-modal-text--danger">{plan.mdRemarks}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── FOOTER — Close only (read-only modal) ── */}
                    <div className="red-modal-footer">
                        <span className="red-modal-footer-hint">
                            <FiEye /> Read-only view of {formatMonth(plan.month)}
                        </span>
                        <button
                            className="red-modal-footer-close"
                            onClick={() => setSelectedMonthDetail(null)}
                        >
                            Close
                        </button>
                    </div>

                </div>
            </div>
        );
    };

    /* ════════════════════════ RENDER ════════════════════════ */
    return (
        <div className="fade-in red-page">
            {renderDetailModal()}

            {/* ── Back Button ── */}
            <button className="red-back-btn" onClick={() => navigate('/ra/employees')}>
                <FiArrowLeft /> Back to Directory
            </button>

            {/* ── PROFILE HEADER ── */}
            <div className="red-profile-header">
                <div className="red-profile-left">
                    <div className="red-avatar">{getInitials(employee.name)}</div>
                    <div className="red-profile-info">
                        <h1 className="red-profile-name">{employee.name}</h1>
                        <div className="red-profile-meta">
                            <span><FiBriefcase /> {employee.department || 'No dept'}</span>
                            <span>#{employee.employeeCode}</span>
                            <span className="red-role-tag">{employee.role}</span>
                            {employee.reportingAuthorityId && <span><FiUser /> RA: You</span>}
                        </div>
                        <div className="red-header-ctx">
                            <span className={`red-header-status red-header-status--${headerStatus.cls}`}>
                                <FiZap /> {headerStatus.label}
                            </span>
                            {lastEval && (
                                <span className="red-header-meta-item">
                                    <FiClock /> Last eval: {formatMonth(lastEval.month)}
                                </span>
                            )}
                            {filteredMonths.length > 0 && (
                                <span className="red-header-meta-item">
                                    <FiCheckCircle /> {completionRate}% completion ({filterYear})
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="red-header-stats">
                    <div className="red-header-stat">
                        <div className="red-header-stat-value">{unifiedMonths.length}</div>
                        <div className="red-header-stat-label">Monthly Plans</div>
                    </div>
                    <div className="red-header-stat-divider" />
                    <div className="red-header-stat">
                        <div className="red-header-stat-value"
                            style={{ color: avgScore !== '—' ? getScoreColor(parseFloat(avgScore)) : 'var(--text-muted)' }}>
                            {avgScore}
                        </div>
                        <div className="red-header-stat-label">Avg Score</div>
                    </div>
                    <div className="red-header-stat-divider" />
                    <div className="red-header-stat">
                        <div className="red-header-stat-value">{quarterlyEvaluations.length}</div>
                        <div className="red-header-stat-label">Quarterly</div>
                    </div>
                </div>
            </div>

            {/* ── KPI SUMMARY ROW ── */}
            <div className="red-kpi-row">
                <KPICard label="Avg Score"
                    value={avgScore !== '—' ? `${avgScore}/10` : '—'}
                    sub={avgScore !== '—' ? getScoreLabel(parseFloat(avgScore)) : 'No data yet'}
                    icon={<FiBarChart2 />} color="#8B5CF6"
                    trend={scoreTrend !== null ? (scoreTrend > 0 ? 'up' : scoreTrend < 0 ? 'down' : 'neutral') : null}
                />
                <KPICard label="Best Month"
                    value={bestEval ? `${bestEval.score}/10` : '—'}
                    sub={bestEval ? formatMonth(bestEval.month) : 'No evaluations'}
                    icon={<FiStar />} color="#22C55E" trend={bestEval ? 'up' : null}
                />
                <KPICard label="Worst Month"
                    value={worstEval ? `${worstEval.score}/10` : '—'}
                    sub={worstEval ? formatMonth(worstEval.month) : 'No evaluations'}
                    icon={<FiAlertTriangle />}
                    color={worstEval ? getScoreColor(worstEval.score) : '#94A3B8'}
                    trend={worstEval && worstEval.score < 5 ? 'down' : null}
                />
                <KPICard label="Completion Rate"
                    value={filteredMonths.length > 0 ? `${completionRate}%` : '—'}
                    sub={`${filteredMonths.filter(m => m.isEval).length} of ${filteredMonths.length} evaluated`}
                    icon={<FiCheckCircle />}
                    color={completionRate >= 80 ? '#22C55E' : completionRate >= 50 ? '#F97316' : '#EF4444'}
                    trend={completionRate >= 80 ? 'up' : completionRate < 50 && filteredMonths.length > 0 ? 'down' : 'neutral'}
                />
                <KPICard label="Total Evaluations"
                    value={evaluatedEvals.length}
                    sub={`in ${filterYear} · ${filteredMonths.length} plans`}
                    icon={<FiAward />} color="#F97316" trend={null}
                />
            </div>

            {/* ── TABS + YEAR FILTER ── */}
            <div className="red-tabs-row">
                <div className="red-tab-rail">
                    {tabs.map(t => (
                        <button key={t.key}
                            className={`red-tab ${activeTab === t.key ? 'red-tab--active' : ''}`}
                            onClick={() => setActiveTab(t.key)}
                        >
                            <span className="red-tab-icon">{t.icon}</span>
                            {t.label}
                            {t.count != null && (
                                <span className={`red-tab-count ${activeTab === t.key ? 'red-tab-count--active' : ''}`}>
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="red-year-filter">
                    <FiFilter className="red-year-filter-icon" />
                    <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>
            </div>

            {/* ════════════ ANALYTICS TAB ════════════ */}
            {activeTab === 'overview' && (
                <div className="red-overview-wrap">
                    {insights.length > 0 && (
                        <div className="red-insights-box">
                            <div className="red-insights-header">
                                <FiZap className="red-insights-icon" />
                                <span>Performance Insights</span>
                                <span className="red-insights-count">{insights.length}</span>
                            </div>
                            <div className="red-insights-list">
                                {insights.map((ins, i) => (
                                    <InsightPill key={i} icon={ins.icon} text={ins.text} variant={ins.variant} />
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="red-charts-grid">
                        <div className="red-chart-card">
                            <div className="red-chart-title"><FiBarChart2 /> Monthly Evaluation Trend</div>
                            <p className="red-chart-sub">Score progression over time — identifies growth and dip patterns</p>
                            {filteredEvals.filter(e => e.status === 'EVALUATED').length === 0 ? (
                                <p className="red-chart-empty">No evaluations yet for {filterYear}</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <AreaChart
                                        data={[...filteredEvals].filter(e => e.status === 'EVALUATED').reverse()}
                                        margin={{ top: 16, right: 16, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="redAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                        <XAxis dataKey="month" tickFormatter={m => formatMonth(m).split(' ')[0]}
                                            tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]}
                                            tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="score" name="Score"
                                            stroke="#8B5CF6" strokeWidth={2.5} fill="url(#redAreaGrad)"
                                            dot={{ r: 5, fill: '#8B5CF6', strokeWidth: 2, stroke: '#fff' }}
                                            activeDot={{ r: 7, fill: '#8B5CF6', stroke: '#fff', strokeWidth: 2 }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                        <div className="red-chart-card">
                            <div className="red-chart-title"><FiTarget /> Quarterly Evaluation Scores</div>
                            <p className="red-chart-sub">Quarter-wise average — highlights sustained or volatile performance</p>
                            {filteredQuarterly.length === 0 ? (
                                <p className="red-chart-empty">No quarterly evaluations for {filterYear}</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={[...filteredQuarterly].reverse()}
                                        margin={{ top: 16, right: 16, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                        <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip content={<CustomTooltip />} />
                                        <Bar dataKey="averageScore" name="Avg Score" radius={[8, 8, 0, 0]} barSize={40}>
                                            {[...filteredQuarterly].reverse().map((entry, i) => (
                                                <Cell key={`cell-${i}`} fill={getScoreColor(entry.averageScore)} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════ MONTHLY REVIEWS TAB ════════════ */}
            {activeTab === 'monthly' && (
                <div>
                    {filteredMonths.length === 0 ? (
                        <div className="red-empty-center">
                            <FiCalendar style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No monthly reviews found for {filterYear}</p>
                        </div>
                    ) : (
                        <div className="red-table-card">
                            <table className="red-table">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th>Progress</th>
                                        <th>Score</th>
                                        <th>Submitted</th>
                                        <th>Detail</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMonths.map(plan => (
                                        <tr key={plan._id} className="red-table-row"
                                            onClick={() => setSelectedMonthDetail(plan)}>
                                            <td>
                                                <div className="red-month-cell">
                                                    <div className="red-month-badge">{shortMonth(plan.month)}</div>
                                                    <div>
                                                        <strong>{formatMonth(plan.month)}</strong>
                                                        <div style={{ marginTop: 4 }}>{getStatusBadge(plan)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="red-stepper-mini">
                                                    <div className="red-step-dot-mini red-step-dot-mini--done" title="Plan" />
                                                    <div className={`red-step-line-mini ${plan.hasAchievement ? 'red-step-line-mini--done' : ''}`} />
                                                    <div className={`red-step-dot-mini ${plan.hasAchievement ? 'red-step-dot-mini--done' : ''}`} title="Achievement" />
                                                    <div className={`red-step-line-mini ${plan.isEval ? 'red-step-line-mini--done' : ''}`} />
                                                    <div className={`red-step-dot-mini ${plan.isEval ? 'red-step-dot-mini--done' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                {plan.isEval ? (
                                                    <span className="red-score-chip"
                                                        style={{ background: `${getScoreColor(plan.evaluation.score)}15`, color: getScoreColor(plan.evaluation.score) }}>
                                                        {plan.evaluation.score}/10
                                                    </span>
                                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                            </td>
                                            <td className="red-date-cell">{new Date(plan.submittedAt).toLocaleDateString()}</td>
                                            <td>
                                                <button className="red-detail-btn"
                                                    onClick={e => { e.stopPropagation(); setSelectedMonthDetail(plan); }}>
                                                    <FiEye /> View
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ════════════ QUARTERLY TAB ════════════ */}
            {activeTab === 'quarterly' && (
                <div className="red-qtr-list">
                    {filteredQuarterly.length === 0 ? (
                        <div className="red-empty-center">
                            <FiTarget style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No quarterly evaluations found for {filterYear}</p>
                        </div>
                    ) : filteredQuarterly.map(qe => (
                        <div key={qe._id} className="red-qtr-card" style={{ '--qclr': getScoreColor(qe.averageScore) }}>
                            <div className="red-qtr-inner">
                                <div className="red-qtr-head">
                                    <span className="red-qtr-label"><FiBarChart2 /> {qe.quarter?.replace('-', ' ')}</span>
                                    <span className="red-qtr-score" style={{ color: getScoreColor(qe.averageScore) }}>
                                        {qe.averageScore?.toFixed(1)}<span>/10</span>
                                    </span>
                                </div>
                                <div className="red-qtr-bar-track">
                                    <div className="red-qtr-bar-fill"
                                        style={{ width: `${(qe.averageScore / 10) * 100}%`, background: getScoreColor(qe.averageScore) }} />
                                </div>
                                {qe.remarks && (
                                    <div className="red-qtr-remarks-block">
                                        <div className="red-qtr-remarks-label">Your Remarks</div>
                                        <div className="red-qtr-remarks-text">{qe.remarks}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ════════════ YEARLY TAB ════════════ */}
            {activeTab === 'yearly' && (
                <div className="red-yearly-list">
                    {filteredYearlyPlans.length === 0 && filteredYearlyReports.length === 0 ? (
                        <div className="red-empty-center">
                            <FiAward style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No yearly data found for this period</p>
                        </div>
                    ) : (
                        <>
                            {filteredYearlyPlans.length > 0 && (
                                <div className="red-yearly-section">
                                    <h3 className="red-yearly-section-title"><FiFileText /> Yearly Plans</h3>
                                    {filteredYearlyPlans.map(yp => (
                                        <div key={yp._id} className="red-yearly-card">
                                            <div className="red-yearly-card-header">
                                                <span className="red-yearly-fy">FY {yp.financialYear}</span>
                                                <span className={`red-badge red-badge--${yp.status?.toLowerCase()}`}>{yp.status}</span>
                                            </div>
                                            <div className="red-yearly-content">{yp.planAndObjectives}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {filteredYearlyReports.length > 0 && (
                                <div className="red-yearly-section">
                                    <h3 className="red-yearly-section-title"><FiAward /> Appraisal Reports</h3>
                                    {filteredYearlyReports.map(yr => (
                                        <div key={yr._id} className="red-yearly-card">
                                            <div className="red-yearly-card-header">
                                                <span className="red-yearly-fy">FY {yr.financialYear}</span>
                                                <span className={`red-badge red-badge--${yr.status?.toLowerCase()?.replace(/_/g, '-')}`}>
                                                    {yr.status?.replace(/_/g, ' ')}
                                                </span>
                                            </div>
                                            <div className="red-yearly-content">{yr.workKRA}</div>
                                            {yr.grandTotal != null && (
                                                <div className="red-yearly-total">
                                                    Grand Total: <strong>{yr.grandTotal}/100</strong>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default RAEmployeeDetailPage;