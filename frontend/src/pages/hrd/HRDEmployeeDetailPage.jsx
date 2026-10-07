import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import './HRDEmployeeDetail.css';
import '../ra/RAEmployeeDetail.css';
import './HRDPlanModal.css';
import { getCurrentFiscalYear } from '../../utils/fiscalUtils';

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
    if (!year || !month || isNaN(year) || isNaN(month)) return m;
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
function shortYear(m) {
    if (!m) return '';
    return m.split('-')[0].slice(2);
}
function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.length > 0)
        return plan.planItems.map(p => typeof p === 'string' ? p : p.itemText).filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}

/* Legacy rows stored progress as one text blob ("Plan 1 [50%]: …").
   We still split it per plan, but any "[NN%]" marker is discarded —
   percentages are no longer part of the product. */
function parseLegacyPlanAch(legacyText, planCount) {
    const result = Array.from({ length: planCount }, () => ({ achievementDetails: '' }));
    if (!legacyText) return result;
    let currentIdx = -1;
    legacyText.split('\n').forEach(line => {
        const header = line.match(/^Plan\s+(\d+)\s*(?:\[\d+%\])?\s*:\s*(.*)/i);
        if (header) {
            const idx = parseInt(header[1]) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].achievementDetails = header[2].trim();
            }
        } else if (currentIdx >= 0 && line.trim() && !/^Additional:/i.test(line)) {
            result[currentIdx].achievementDetails += (result[currentIdx].achievementDetails ? ' ' : '') + line.trim();
        }
    });
    return result;
}

/* Returns [{ achievementDetails }] aligned to plan order, or null when the
   employee has not reported anything usable yet. */
function getEffectivePlanAch(ach, planCount) {
    if (!ach) return null;
    const hasText = list => list.some(a => (a.achievementDetails || '').trim());
    const pa = ach.planAchievements;
    if (Array.isArray(pa) && pa.length > 0 && hasText(pa)) {
        return pa.map(a => ({ achievementDetails: a.achievementDetails || '' }));
    }
    if (ach.achievementDetails) {
        const parsed = parseLegacyPlanAch(ach.achievementDetails, planCount);
        if (hasText(parsed)) return parsed;
    }
    return null;
}

/* Additional (unplanned) work → [{ text }]. Accepts the JSON array form, the
   legacy "Additional: …" suffix, or plain text. Stored percentages ignored. */
function parseAdditionalAch(raw) {
    if (!raw) return [];
    const toItems = arr => arr
        .map(a => ({ text: (typeof a === 'string' ? a : a?.text || '').trim() }))
        .filter(a => a.text);
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return toItems(parsed);
    } catch { /* not JSON — fall through */ }
    const match = raw.match(/Additional:\s*([\s\S]+)/i);
    if (match) {
        const captured = match[1].trim();
        try {
            const parsed = JSON.parse(captured);
            if (Array.isArray(parsed)) return toItems(parsed);
        } catch { /* plain text */ }
        return captured ? [{ text: captured }] : [];
    }
    return toItems(raw.split('\n').filter(l => l.trim() && !/^Additional:/i.test(l.trim())));
}

/* Additional work: prefer the dedicated field; fall back to an
   "Additional: …" suffix inside the legacy details text. Never treats the
   plain details text as additional work. */
function getAdditionalItems(additionalRaw, detailsRaw) {
    const direct = parseAdditionalAch(additionalRaw || '');
    if (direct.length > 0) return direct;
    const m = (detailsRaw || '').match(/Additional:\s*([\s\S]+)/i);
    return m ? parseAdditionalAch(`Additional: ${m[1]}`) : [];
}

/* Legacy free-text progress: hide "[NN%]" markers and the machine-readable
   "Additional: …" suffix (shown separately as extras). */
function stripLegacyMarkup(text) {
    return (text || '')
        .replace(/\s*Additional:[\s\S]*$/i, '')
        .replace(/\s*\[\d+%\]/g, '')
        .trim();
}

const MONTH_PALETTES = [
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#FCEBEB', color: '#791F1F' },
    { bg: '#EEEDFE', color: '#3C3489' }, { bg: '#E1F5EE', color: '#085041' },
    { bg: '#FAECE7', color: '#712B13' }, { bg: '#FFF0EB', color: '#993C1D' },
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#EEEDFE', color: '#3C3489' },
];
function getMonthChipStyle(monthStr) {
    if (!monthStr) return MONTH_PALETTES[0];
    const m = parseInt(monthStr.split('-')[1]) - 1;
    return MONTH_PALETTES[m] || MONTH_PALETTES[0];
}
function KPICard({ label, value, sub, icon, trend, color }) {
    return (
        <div className="hed-kpi-card">
            <div className="hed-kpi-top">
                <div className="hed-kpi-icon" style={{ background: `${color}15`, color }}>{icon}</div>
                {trend && (
                    <span className={`hed-kpi-trend hed-kpi-trend--${trend}`}>
                        {trend === 'up' ? <FiTrendingUp /> : trend === 'down' ? <FiTrendingDown /> : <FiActivity />}
                    </span>
                )}
            </div>
            <div className="hed-kpi-value" style={{ color: value === '—' ? 'var(--text-muted)' : undefined }}>{value}</div>
            <div className="hed-kpi-label">{label}</div>
            {sub && <div className="hed-kpi-sub">{sub}</div>}
        </div>
    );
}

/* ════════════════════════════════════════════════════
   INSIGHT PILL
════════════════════════════════════════════════════ */
function InsightPill({ icon, text, variant }) {
    return (
        <div className={`hed-insight-pill hed-insight-pill--${variant}`}>
            <span className="hed-insight-pill-icon">{icon}</span>
            <span className="hed-insight-pill-text">{text}</span>
        </div>
    );
}

/* ════════════════════════════════════════════════════
   CUSTOM RECHARTS TOOLTIP
════════════════════════════════════════════════════ */
function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
        <div className="hed-chart-tooltip">
            <div className="hed-chart-tooltip-label">{formatMonth(label) || label}</div>
            {payload.map((p, i) => (
                <div key={i} className="hed-chart-tooltip-row">
                    <span className="hed-chart-tooltip-dot" style={{ background: p.color || p.fill }} />
                    <span>{p.name}:</span>
                    <strong style={{ color: getScoreColor(p.value) }}>
                        {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}/10
                    </strong>
                </div>
            ))}
        </div>
    );
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════ */
const HRDEmployeeDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedMonthDetail, setSelectedMonthDetail] = useState(null);
    const [filterYear, setFilterYear] = useState(getCurrentFiscalYear());

    /* ── Fetch — UNCHANGED ── */
    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/hrd/employee/${id}`);
                setData(res.data);
            } catch {
                toast.error('Failed to load employee detail or unauthorized access');
                navigate('/hrd/employees');
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [id, navigate]);

    /* Close the monthly detail modal on Escape */
    useEffect(() => {
        if (!selectedMonthDetail) return;
        const onKeyDown = e => { if (e.key === 'Escape') setSelectedMonthDetail(null); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedMonthDetail]);

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
                <button className="hed-back-btn" onClick={() => navigate('/hrd/employees')}>
                    <FiArrowLeft /> Back to Directory
                </button>
                <div className="hed-empty-center">Employee not found</div>
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
                const planId = typeof a.monthlyPlanId === 'object' ? a.monthlyPlanId?.id : a.monthlyPlanId;
                return planId === plan.id;
            });
            const isEval = !!evaluation && evaluation.status === 'EVALUATED';
            const hasAch = !!achievement && achievement.status !== 'DRAFT';
            return { ...plan, evaluation, achievement, hasAchievement: hasAch, isEval };
        });

    /* ── FISCAL YEAR FIX ── */
    function monthToFY(monthStr) {
        if (!monthStr) return null;
        const [y, m] = monthStr.split('-').map(Number);
        const startYear = m >= 4 ? y : y - 1;
        return `${startYear}-${String(startYear + 1).slice(-2)}`;
    }
    function quarterToFY(quarterStr) {
        if (!quarterStr) return null;
        const match = quarterStr.match(/^Q(\d)-(\d{4})$/);
        if (!match) return null;
        const startYear = parseInt(match[2], 10);
        return `${startYear}-${String(startYear + 1).slice(-2)}`;
    }

    const fySet = new Set();
    const nowFY = getCurrentFiscalYear();
    const nowStart = parseInt(nowFY.split('-')[0], 10);
    for (let i = 0; i <= 3; i++) {
        const s = nowStart - i;
        fySet.add(`${s}-${String(s + 1).slice(-2)}`);
    }
    monthlyPlans.forEach(p => { const fy = monthToFY(p.month); if (fy) fySet.add(fy); });
    quarterlyEvaluations.forEach(q => { const fy = quarterToFY(q.quarter); if (fy) fySet.add(fy); });
    yearlyPlans.forEach(y => { if (y.financialYear) fySet.add(y.financialYear); });
    yearlyReports.forEach(y => { if (y.financialYear) fySet.add(y.financialYear); });

    const availableYears = Array.from(fySet).sort((a, b) =>
        parseInt(b.split('-')[0]) - parseInt(a.split('-')[0])
    );

    function monthInFY(monthStr, fy) {
        if (!monthStr || !fy) return false;
        const [y, m] = monthStr.split('-').map(Number);
        const startYear = parseInt(fy.split('-')[0], 10);
        return (y === startYear && m >= 4) || (y === startYear + 1 && m <= 3);
    }
    function quarterInFY(quarterStr, fy) {
        if (!quarterStr || !fy) return false;
        const match = quarterStr.match(/^Q\d-(\d{4})$/);
        if (!match) return false;
        return parseInt(match[1], 10) === parseInt(fy.split('-')[0], 10);
    }

    const filteredMonths = unifiedMonths.filter(m => monthInFY(m.month, filterYear));
    const filteredQuarterly = quarterlyEvaluations.filter(q => quarterInFY(q.quarter, filterYear));
    const fyMatch = fy => fy === filterYear;
    const filteredYearlyPlans = yearlyPlans.filter(y => fyMatch(y.financialYear));
    const filteredYearlyReports = yearlyReports.filter(y => fyMatch(y.financialYear));
    const filteredEvals = monthlyEvaluations.filter(e => monthInFY(e.month, filterYear));

    /* ── Stats ── */
    // NOTE: Sequelize returns DECIMAL columns as strings, so we must parseFloat()
    // before any arithmetic. Without it, (0 + "9.00") = "09.00" (string concat)
    // and the subsequent division produces NaN.
    const evaluatedEvals = filteredEvals.filter(e => e.status === 'EVALUATED' && parseFloat(e.score) > 0);
    const avgScore = evaluatedEvals.length > 0
        ? Number((evaluatedEvals.reduce((s, e) => s + parseFloat(e.score), 0) / evaluatedEvals.length).toFixed(1))
        : '—';

    /* ── KPI derived ── */
    const bestEval = evaluatedEvals.length > 0 ? evaluatedEvals.reduce((b, e) => parseFloat(e.score) > parseFloat(b.score) ? e : b, evaluatedEvals[0]) : null;
    const worstEval = evaluatedEvals.length > 0 ? evaluatedEvals.reduce((w, e) => parseFloat(e.score) < parseFloat(w.score) ? e : w, evaluatedEvals[0]) : null;
    const completionRate = filteredMonths.length > 0
        ? Math.round((filteredMonths.filter(m => m.isEval).length / filteredMonths.length) * 100) : 0;
    const lastEval = evaluatedEvals.length > 0
        ? [...evaluatedEvals].sort((a, b) => b.month.localeCompare(a.month))[0] : null;
    const sortedEvalsByMonth = [...evaluatedEvals].sort((a, b) => a.month.localeCompare(b.month));
    const scoreTrend = sortedEvalsByMonth.length >= 2
        ? parseFloat(sortedEvalsByMonth[sortedEvalsByMonth.length - 1].score) - parseFloat(sortedEvalsByMonth[sortedEvalsByMonth.length - 2].score)
        : null;

    /* ── Insight pills ── */
    const insights = [];
    if (scoreTrend !== null) {
        const abs = Math.abs(scoreTrend).toFixed(1);
        const prev = sortedEvalsByMonth[sortedEvalsByMonth.length - 2];
        const curr = sortedEvalsByMonth[sortedEvalsByMonth.length - 1];
        if (scoreTrend > 0)
            insights.push({ icon: <FiTrendingUp />, variant: 'positive', text: `Performance improved by +${abs} pts from ${shortMonth(prev.month)} → ${shortMonth(curr.month)}` });
        else if (scoreTrend < 0)
            insights.push({ icon: <FiTrendingDown />, variant: 'concern', text: `Performance dropped by −${abs} pts from ${shortMonth(prev.month)} → ${shortMonth(curr.month)}` });
        else
            insights.push({ icon: <FiActivity />, variant: 'neutral', text: `Score remained stable at ${Number(curr.score)}/10 — consistent performance` });
    }
    if (worstEval && parseFloat(worstEval.score) < 5)
        insights.push({ icon: <FiAlertTriangle />, variant: 'warning', text: `Lowest score in ${formatMonth(worstEval.month)} (${Number(worstEval.score)}/10) — may need follow-up` });
    if (bestEval && parseFloat(bestEval.score) >= 8)
        insights.push({ icon: <FiStar />, variant: 'positive', text: `Best performance in ${formatMonth(bestEval.month)} with ${Number(bestEval.score)}/10 — ${getScoreLabel(parseFloat(bestEval.score))} rating` });
    if (completionRate === 100 && filteredMonths.length > 0)
        insights.push({ icon: <FiThumbsUp />, variant: 'positive', text: `100% evaluation completion for FY ${filterYear} — all plans reviewed` });
    else if (completionRate < 50 && filteredMonths.length > 1)
        insights.push({ icon: <FiInfo />, variant: 'warning', text: `Only ${completionRate}% evaluated in FY ${filterYear} — ${filteredMonths.filter(m => !m.isEval).length} pending review` });
    if (evaluatedEvals.length >= 3) {
        const last3 = [...evaluatedEvals].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
        if (last3.every(e => Math.abs(parseFloat(e.score) - parseFloat(avgScore)) <= 1.5))
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
        { key: 'overview', label: 'Analytics', icon: <FiBarChart2 /> },
        { key: 'monthly', label: 'Monthly Reviews', icon: <FiCalendar />, count: filteredMonths.length },
        { key: 'quarterly', label: 'Quarterly', icon: <FiTarget />, count: filteredQuarterly.length },
        { key: 'yearly', label: 'Yearly', icon: <FiAward />, count: filteredYearlyPlans.length + filteredYearlyReports.length },
    ];

    /* ── Status badge helper — UNCHANGED ── */
    const getStatusBadge = plan => {
        if (plan.status === 'REJECTED') return <span className="hed-badge hed-badge--rejected">Rejected by RA</span>;
        if (plan.isEval) return <span className="hed-badge hed-badge--evaluated">Evaluated</span>;
        if (plan.hasAchievement) return <span className="hed-badge hed-badge--achievement">Progress Submitted</span>;
        return <span className="hed-badge hed-badge--submitted">Plan Submitted</span>;
    };

    /* ════════════════════════════════════════════════════
       MONTHLY REVIEW MODAL 
    ════════════════════════════════════════════════════ */
    const renderDetailModal = () => {
        if (!selectedMonthDetail) return null;
        const plan = selectedMonthDetail;
        const ev = plan.evaluation;
        const isEval = plan.isEval;
        const ach = plan.achievement;
        const isRejected = plan.status === 'REJECTED';
        const chipStyle = getMonthChipStyle(plan.month);
        const planItemsList = getPlanItems(plan);

        // Derive achievement data
        const effectivePlanAch = getEffectivePlanAch(ach, planItemsList.length);
        const hasStructuredAch = !!effectivePlanAch;

        // Additional work (text only)
        const additionalItems = getAdditionalItems(ach?.additionalAchievement, ach?.achievementDetails);
        const progressSubmitted = !!ach && ach.status !== 'DRAFT';
        const close = () => setSelectedMonthDetail(null);

        // Stepper
        const stepperPlan = 'done';
        const stepperAch = plan.hasAchievement ? 'done' : 'active';
        const stepperEval = isEval ? 'done' : plan.hasAchievement ? 'active' : 'idle';
        const line1 = plan.hasAchievement ? 'filled' : 'empty';
        const line2 = isEval ? 'filled' : 'empty';

        // Status pill
        const stLabel = isRejected ? 'Rejected' : isEval ? 'Evaluated' : plan.hasAchievement ? 'Progress added' : 'Plan submitted';
        const stCls = isRejected ? 'sp-rejected' : isEval ? 'sp-eval' : plan.hasAchievement ? 'sp-ach' : 'sp-plan';

        return createPortal(
            <div className="mp-overlay" onClick={close}>
                <div
                    className="dmod dmod--wide"
                    onClick={e => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="dmod-title"
                >

                    {/* ── HEADER ── */}
                    <div className="dmod-hdr">
                        <div className="dmod-hdr-left">
                            <div className="dmod-month-chip" style={{ background: chipStyle.bg, color: chipStyle.color }}>
                                <span className="dmod-mc-mon">{shortMonth(plan.month).toUpperCase()}</span>
                                <span className="dmod-mc-yr">{shortYear(plan.month)}</span>
                            </div>
                            <div>
                                <div className="dmod-title" id="dmod-title">{formatMonth(plan.month)}</div>
                                <div className="dmod-meta">
                                    <FiClock size={11} />
                                    <span>Submitted {formatDateShort(plan.submittedAt)}</span>
                                    <span className="dmod-meta-sep" />
                                    <span>{planItemsList.length} plan{planItemsList.length !== 1 ? 's' : ''}</span>
                                    <span className="dmod-meta-sep" />
                                    <span className={`dmod-status-pill ${stCls}`}>{stLabel}</span>
                                </div>
                            </div>
                        </div>
                        <button className="dmod-close" onClick={close} aria-label="Close details">
                            <FiX size={16} />
                        </button>
                    </div>

                    {/* ── STEPPER ── */}
                    <div className="dmod-stepper">
                        <div className="dmod-step">
                            <div className={`dmod-snum dmod-snum--${stepperPlan}`}>
                                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                            <span className={`dmod-slbl dmod-slbl--${stepperPlan}`}>Plan</span>
                        </div>
                        <div className={`dmod-sline dmod-sline--${line1}`} />
                        <div className="dmod-step">
                            <div className={`dmod-snum dmod-snum--${stepperAch}`}>
                                {stepperAch === 'done'
                                    ? <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                                    : <FiTrendingUp size={12} />}
                            </div>
                            <span className={`dmod-slbl dmod-slbl--${stepperAch}`}>Progress</span>
                        </div>
                        <div className={`dmod-sline dmod-sline--${line2}`} />
                        <div className="dmod-step">
                            <div className={`dmod-snum dmod-snum--${stepperEval}`}>
                                {stepperEval === 'done'
                                    ? <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                                    : <FiCheckCircle size={12} />}
                            </div>
                            <span className={`dmod-slbl dmod-slbl--${stepperEval}`}>Evaluated</span>
                        </div>
                    </div>

                    {/* ── BODY ── */}
                    <div className="dmod-body">

                        {/* MD rejection banner */}
                        {isRejected && (
                            <div className="red-status-banner red-status-banner--rejected hpm-banner">
                                <FiAlertCircle /> This plan was rejected by the Reporting Authority (RA)
                            </div>
                        )}

                        {/* Submission timeline (dates only — no progress metrics) */}
                        {progressSubmitted && (
                            <div className="hpm-timeline">
                                <span className="hpm-timeline-item">
                                    <FiFileText size={12} /> Plan submitted {formatDateShort(plan.submittedAt)}
                                </span>
                                {ach.submittedAt && (
                                    <span className="hpm-timeline-item">
                                        <FiTrendingUp size={12} /> Progress submitted {formatDateShort(ach.submittedAt)}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Plans & Achievements section */}
                        <div>
                            <div className="dmod-sec-lbl">
                                <FiFileText size={13} />
                                {progressSubmitted ? 'Plans & Progress' : 'Plan details'}
                                <span className="dmod-sec-count-pill">{planItemsList.length} plan{planItemsList.length !== 1 ? 's' : ''}</span>
                            </div>

                            {/* Case A — no progress yet: plain plan list */}
                            {!progressSubmitted && (
                                <div className="dmod-plan-list">
                                    {planItemsList.map((p, i) => (
                                        <div key={i} className="dmod-plan-simple-item">
                                            <div className="dmod-plan-simple-wrap">
                                                <span className="dmod-plan-idx-pill">{i + 1}</span>
                                                <div className="dmod-pinfo">
                                                    <div className="dmod-pname-row">
                                                        <span className="dmod-pname">Plan {i + 1}</span>
                                                        <span className="dmod-pstatus dmod-pstatus--idle">Pending</span>
                                                    </div>
                                                    <div className="dmod-pdesc">{p}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Case B — progress submitted, per-plan details */}
                            {progressSubmitted && hasStructuredAch && (
                                <div className="dmod-plan-list">
                                    {planItemsList.map((planText, i) => {
                                        const details = (effectivePlanAch[i]?.achievementDetails || '').trim();
                                        const updated = !!details;
                                        return (
                                            <div key={i} className="dmod-pcard-wrap">
                                                <div className={`dmod-pcard hpm-pcard ${updated ? 'hpm-pcard--updated' : 'hpm-pcard--pending'}`}>
                                                    <div className="dmod-ptop">
                                                        <span className="dmod-plan-idx-pill">{i + 1}</span>
                                                        <div className="dmod-pinfo">
                                                            <div className="dmod-pname-row">
                                                                <span className="dmod-pname">Plan {i + 1}</span>
                                                                <span className={`dmod-pstatus ${updated ? 'dmod-pstatus--done' : 'dmod-pstatus--idle'}`}>
                                                                    {updated ? 'Progress added' : 'No update'}
                                                                </span>
                                                            </div>
                                                            <div className="dmod-pdesc">{planText}</div>
                                                        </div>
                                                    </div>
                                                    <div className="dmod-ach-section">
                                                        <div className="dmod-ach-lbl">
                                                            <FiTrendingUp size={11} /> Progress details
                                                        </div>
                                                        {updated
                                                            ? <div className="dmod-ach-text">{details}</div>
                                                            : <div className="dmod-ach-empty">No details provided</div>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Case C — achievement submitted but fully legacy text only */}
                            {progressSubmitted && !hasStructuredAch && ach.achievementDetails && (
                                <div className="dmod-legacy-ach">
                                    <div className="dmod-ach-lbl"><FiTrendingUp size={11} /> Progress details</div>
                                    <div className="dmod-ach-text">{stripLegacyMarkup(ach.achievementDetails)}</div>
                                </div>
                            )}
                        </div>

                        {/* No achievement yet block */}
                        {!progressSubmitted && (
                            <div className="dmod-no-ach-block">
                                <div className="dmod-no-ach-icon"><FiTrendingUp size={16} /></div>
                                <div className="dmod-no-ach-text">
                                    {ach?.status === 'DRAFT'
                                        ? 'Progress draft saved — not yet submitted.'
                                        : 'Progress not submitted yet.'}
                                </div>
                            </div>
                        )}

                        {/* Additional achievements */}
                        {additionalItems.length > 0 && (
                            <div className="dmod-extras-card">
                                <div className="dmod-extras-hdr">
                                    <div className="dmod-extras-title"><FiStar size={13} /> Additional work</div>
                                    <span className="dmod-extras-badge">{additionalItems.length} extra{additionalItems.length !== 1 ? 's' : ''}</span>
                                </div>
                                {additionalItems.map((item, i) => (
                                    <div key={i} className="dmod-extra-item">
                                        <div className="dmod-extra-num">{i + 1}</div>
                                        <div className="dmod-extra-content">
                                            <div className="dmod-extra-text">{item.text}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* RA evaluation section */}
                        <div className="dmod-ra-box">
                            <div className="dmod-ra-icon"><FiMessageSquare size={13} color="#185FA5" /></div>
                            <div className="dmod-ra-info">
                                <div className="dmod-ra-lbl">RA evaluation</div>
                                {isEval ? (
                                    <div>
                                        <div className="dmod-ra-done">{ev.remarks || 'Evaluation completed.'}</div>
                                        {ev.score != null && (
                                            <div className="dmod-ra-score">Score: <strong>{ev.score}/10</strong></div>
                                        )}
                                        {ev.evaluatedAt && (
                                            <div className="dmod-ra-date">
                                                <FiClock size={10} /> Evaluated {formatDateShort(ev.evaluatedAt)}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="dmod-ra-pending">Awaiting evaluation</div>
                                )}
                            </div>
                            {isEval && ev.score != null && (
                                <div className="dmod-score-chip">{ev.score}/10</div>
                            )}
                        </div>

                        {/* RA rejection reason */}
                        {isRejected && plan.raRemarks && (
                            <div className="red-modal-section red-modal-section--danger hpm-reject-section">
                                <div className="red-modal-section-hd">
                                    <div className="red-modal-section-icon red-modal-section-icon--danger"><FiAlertCircle /></div>
                                    <span>RA Rejection Reason</span>
                                </div>
                                <div className="red-modal-section-body">
                                    <p className="red-modal-text red-modal-text--danger">{plan.raRemarks}</p>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* ── FOOTER ── */}
                    <div className="dmod-footer">
                        <span className="dmod-ftr-state">
                            {isEval ? 'Evaluated' : plan.hasAchievement ? 'Awaiting RA review' : 'Progress pending'}
                        </span>
                        <button className="dmod-btn-close" onClick={close}>Close</button>
                    </div>

                </div>
            </div>,
            document.body
        );
    };

    /* ════════════════════════ RENDER ════════════════════════ */
    return (
        <div className="fade-in hed-page">
            {renderDetailModal()}

            {/* ── Back Button ── */}
            <button className="hed-back-btn" onClick={() => navigate('/hrd/employees')}>
                <FiArrowLeft /> Back to Directory
            </button>

            {/* ── PROFILE HEADER ── */}
            <div className="hed-profile-header">
                <div className="hed-profile-left">
                    <div className="hed-avatar">{getInitials(employee.name)}</div>
                    <div className="hed-profile-info">
                        <h1 className="hed-profile-name">{employee.name}</h1>
                        <div className="hed-profile-meta">
                            <span><FiBriefcase /> {employee.department || 'No dept'}</span>
                            <span>#{employee.employeeCode}</span>
                            <span className="hed-role-tag">{employee.role}</span>
                            {employee.reportingAuthority ? (
                                <span><FiUser /> RA: {employee.reportingAuthority.name}</span>
                            ) : employee.reportingAuthorityId ? (
                                <span><FiUser /> RA Assigned</span>
                            ) : null}
                        </div>
                        <div className="hed-header-ctx">
                            <span className={`hed-header-status hed-header-status--${headerStatus.cls}`}>
                                <FiZap /> {headerStatus.label}
                            </span>
                            {lastEval && (
                                <span className="hed-header-meta-item">
                                    <FiClock /> Last eval: {formatMonth(lastEval.month)}
                                </span>
                            )}
                            {filteredMonths.length > 0 && (
                                <span className="hed-header-meta-item">
                                    <FiCheckCircle /> {completionRate}% completion (FY {filterYear})
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="hed-header-stats">
                    <div className="hed-header-stat">
                        <div className="hed-header-stat-value">{unifiedMonths.length}</div>
                        <div className="hed-header-stat-label">Monthly Plans</div>
                    </div>
                    <div className="hed-header-stat-divider" />
                    <div className="hed-header-stat">
                        <div className="hed-header-stat-value"
                            style={{ color: avgScore !== '—' ? getScoreColor(parseFloat(avgScore)) : 'var(--text-muted)' }}>
                            {avgScore}
                        </div>
                        <div className="hed-header-stat-label">Avg Score</div>
                    </div>
                    <div className="hed-header-stat-divider" />
                    <div className="hed-header-stat">
                        <div className="hed-header-stat-value">{quarterlyEvaluations.length}</div>
                        <div className="hed-header-stat-label">Quarterly</div>
                    </div>
                </div>
            </div>

            {/* ── KPI SUMMARY ROW ── */}
            <div className="hed-kpi-row">
                <KPICard label="Avg Score"
                    value={avgScore !== '—' ? `${avgScore}/10` : '—'}
                    sub={avgScore !== '—' ? getScoreLabel(parseFloat(avgScore)) : 'No data yet'}
                    icon={<FiBarChart2 />} color="#8B5CF6"
                    trend={scoreTrend !== null ? (scoreTrend > 0 ? 'up' : scoreTrend < 0 ? 'down' : 'neutral') : null}
                />
                <KPICard label="Best Month"
                    value={bestEval ? `${Number(bestEval.score)}/10` : '—'}
                    sub={bestEval ? formatMonth(bestEval.month) : 'No evaluations'}
                    icon={<FiStar />} color="#22C55E" trend={bestEval ? 'up' : null}
                />
                <KPICard label="Worst Month"
                    value={worstEval ? `${Number(worstEval.score)}/10` : '—'}
                    sub={worstEval ? formatMonth(worstEval.month) : 'No evaluations'}
                    icon={<FiAlertTriangle />}
                    color={worstEval ? getScoreColor(parseFloat(worstEval.score)) : '#94A3B8'}
                    trend={worstEval && parseFloat(worstEval.score) < 5 ? 'down' : null}
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
                    sub={`FY ${filterYear} · ${filteredMonths.length} plans`}
                    icon={<FiAward />} color="#F97316" trend={null}
                />
            </div>

            {/* ── TABS + YEAR FILTER ── */}
            <div className="hed-tabs-row">
                <div className="hed-tab-rail">
                    {tabs.map(t => (
                        <button key={t.key}
                            className={`hed-tab ${activeTab === t.key ? 'hed-tab--active' : ''}`}
                            onClick={() => setActiveTab(t.key)}
                        >
                            <span className="hed-tab-icon">{t.icon}</span>
                            {t.label}
                            {t.count != null && (
                                <span className={`hed-tab-count ${activeTab === t.key ? 'hed-tab-count--active' : ''}`}>
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="hed-year-filter">
                    <FiFilter className="hed-year-filter-icon" />
                    <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                        {availableYears.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
                    </select>
                </div>
            </div>

            {/* ════════════ ANALYTICS TAB ════════════ */}
            {activeTab === 'overview' && (
                <div className="hed-overview-wrap">
                    {insights.length > 0 && (
                        <div className="hed-insights-box">
                            <div className="hed-insights-header">
                                <FiZap className="hed-insights-icon" />
                                <span>Performance Insights</span>
                                <span className="hed-insights-count">{insights.length}</span>
                            </div>
                            <div className="hed-insights-list">
                                {insights.map((ins, i) => (
                                    <InsightPill key={i} icon={ins.icon} text={ins.text} variant={ins.variant} />
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="hed-charts-grid">
                        <div className="hed-chart-card">
                            <div className="hed-chart-title"><FiBarChart2 /> Monthly Evaluation Trend</div>
                            <p className="hed-chart-sub">Score progression over time — identifies growth and dip patterns</p>
                            {filteredEvals.filter(e => e.status === 'EVALUATED').length === 0 ? (
                                <p className="hed-chart-empty">No evaluations yet for FY {filterYear}</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <AreaChart
                                        data={[...filteredEvals].filter(e => e.status === 'EVALUATED').reverse()}
                                        margin={{ top: 16, right: 16, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="redAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} />
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
                        <div className="hed-chart-card">
                            <div className="hed-chart-title"><FiTarget /> Quarterly Evaluation Scores</div>
                            <p className="hed-chart-sub">Quarter-wise average — highlights sustained or volatile performance</p>
                            {filteredQuarterly.length === 0 ? (
                                <p className="hed-chart-empty">No quarterly evaluations for FY {filterYear}</p>
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
                                                <Cell key={`cell-${i}`} fill={getScoreColor(parseFloat(entry.averageScore))} />
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
                        <div className="hed-empty-center">
                            <FiCalendar style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No monthly reviews found for FY {filterYear} (Apr {filterYear.split('-')[0]} – Mar {parseInt(filterYear.split('-')[0]) + 1})</p>
                        </div>
                    ) : (
                        <div className="hed-table-card">
                            <table className="hed-table">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th>Stage</th>
                                        <th>Score</th>
                                        <th>Submitted</th>
                                        <th>Detail</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMonths.map(plan => (
                                        <tr
                                            key={plan.id}
                                            className="hed-table-row"
                                            onClick={() => setSelectedMonthDetail(plan)}
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`View ${formatMonth(plan.month)} details`}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMonthDetail(plan); }
                                            }}
                                        >
                                            <td>
                                                <div className="hed-month-cell">
                                                    <div className="hed-month-badge">{shortMonth(plan.month)}</div>
                                                    <div>
                                                        <strong>{formatMonth(plan.month)}</strong>
                                                        <div style={{ marginTop: 4 }}>{getStatusBadge(plan)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="hed-stepper-mini">
                                                    <div className="hed-step-dot-mini hed-step-dot-mini--done" title="Plan" />
                                                    <div className={`hed-step-line-mini ${plan.hasAchievement ? 'hed-step-line-mini--done' : ''}`} />
                                                    <div className={`hed-step-dot-mini ${plan.hasAchievement ? 'hed-step-dot-mini--done' : ''}`} title="Progress submitted" />
                                                    <div className={`hed-step-line-mini ${plan.isEval ? 'hed-step-line-mini--done' : ''}`} />
                                                    <div className={`hed-step-dot-mini ${plan.isEval ? 'hed-step-dot-mini--done' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                {plan.isEval ? (
                                                    <span className="hed-score-chip"
                                                        style={{ background: `${getScoreColor(parseFloat(plan.evaluation.score))}15`, color: getScoreColor(parseFloat(plan.evaluation.score)) }}>
                                                        {Number(plan.evaluation.score)}/10
                                                    </span>
                                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                            </td>
                                            <td className="hed-date-cell">{formatDateShort(plan.submittedAt)}</td>
                                            <td>
                                                <button className="hed-detail-btn"
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
                <div className="hed-qtr-list">
                    {filteredQuarterly.length === 0 ? (
                        <div className="hed-empty-center">
                            <FiTarget style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No quarterly evaluations found for FY {filterYear}</p>
                        </div>
                    ) : filteredQuarterly.map(qe => (
                        <div key={qe.id} className="hed-qtr-card" style={{ '--qclr': getScoreColor(parseFloat(qe.averageScore)) }}>
                            <div className="hed-qtr-inner">
                                <div className="hed-qtr-head">
                                    <span className="hed-qtr-label"><FiBarChart2 /> {qe.quarter?.replace('-', ' ')}</span>
                                    <span className="hed-qtr-score" style={{ color: getScoreColor(parseFloat(qe.averageScore)) }}>
                                        {Number(parseFloat(qe.averageScore).toFixed(1))}<span>/10</span>
                                    </span>
                                </div>
                                <div className="hed-qtr-bar-track">
                                    <div className="hed-qtr-bar-fill"
                                        style={{ width: `${(parseFloat(qe.averageScore) / 10) * 100}%`, background: getScoreColor(parseFloat(qe.averageScore)) }} />
                                </div>
                                {qe.remarks && (
                                    <div className="hed-qtr-remarks-block">
                                        <div className="hed-qtr-remarks-label">Your Remarks</div>
                                        <div className="hed-qtr-remarks-text">{qe.remarks}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ════════════ YEARLY TAB ════════════ */}
            {activeTab === 'yearly' && (
                <div className="hed-yearly-list">
                    {filteredYearlyPlans.length === 0 && filteredYearlyReports.length === 0 ? (
                        <div className="hed-empty-center">
                            <FiAward style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No yearly data found for FY {filterYear}</p>
                        </div>
                    ) : (
                        <>
                            {/* ── Yearly Plans ── */}
                            {filteredYearlyPlans.length > 0 && (
                                <div className="hed-yearly-section">
                                    <h3 className="hed-yearly-section-title"><FiFileText /> Yearly Plans</h3>
                                    {filteredYearlyPlans.map(yp => {
                                        const statusCls = {
                                            APPROVED: 'evaluated', REJECTED: 'rejected',
                                            PENDING: 'submitted', SUBMITTED: 'submitted', EDITED: 'achievement',
                                        }[yp.status] || 'submitted';
                                        const kras = Array.isArray(yp.kras) ? [...yp.kras].sort((a,b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0)) : [];
                                        return (
                                            <div key={yp.id} className="hed-yearly-card">
                                                <div className="hed-yearly-card-header">
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span className="hed-yearly-fy">FY {yp.financialYear}</span>
                                                        {yp.version && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{yp.version}</span>}
                                                    </div>
                                                    <span className={`hed-badge hed-badge--${statusCls}`}>
                                                        {yp.status?.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                                {kras.length > 0 ? (
                                                    <div className="hed-yearly-kra-table-wrap">
                                                        <table className="hed-yearly-kra-table">
                                                            <thead>
                                                                <tr>
                                                                    <th>#</th>
                                                                    <th>KRA Description</th>
                                                                    <th>Target / Measurable Outcome</th>
                                                                    <th>Timeline</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {kras.map((kra, idx) => (
                                                                    <tr key={kra.id || idx} className={idx % 2 === 0 ? 'hed-kra-row--even' : 'hed-kra-row--odd'}>
                                                                        <td><div className="hed-kra-num-badge">{(kra.kraIndex ?? idx) + 1}</div></td>
                                                                        <td>{kra.description}</td>
                                                                        <td>{kra.target}</td>
                                                                        <td><span className="hed-kra-timeline-badge">{kra.timeline}</span></td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <div className="hed-yearly-content" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                                        No KRA data available for this plan.
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* ── Appraisal Reports ── */}
                            {filteredYearlyReports.length > 0 && (
                                <div className="hed-yearly-section">
                                    <h3 className="hed-yearly-section-title"><FiAward /> Appraisal Reports</h3>
                                    {filteredYearlyReports.map(yr => {
                                        const statusCls = {
                                            RA_EVALUATED: 'evaluated', HRD_EVALUATED: 'evaluated',
                                            MD_EVALUATED: 'evaluated', COMPLETED: 'evaluated',
                                            SUBMITTED: 'submitted', REJECTED: 'rejected',
                                        }[yr.status] || 'submitted';
                                        const kraAssessments = Array.isArray(yr.kraAssessments)
                                            ? [...yr.kraAssessments].sort((a,b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0))
                                            : [];
                                        const wfStep = { SUBMITTED: 1, RA_EVALUATED: 2, HRD_EVALUATED: 3, MD_EVALUATED: 4, COMPLETED: 5 }[yr.status] ?? 1;
                                        const wfSteps = ['Report Submitted', 'RA Evaluation', 'HRD Evaluation', 'MD Final', 'Completed'];
                                        return (
                                            <div key={yr.id} className="hed-yearly-card">
                                                <div className="hed-yearly-card-header">
                                                    <span className="hed-yearly-fy">FY {yr.financialYear}</span>
                                                    <span className={`hed-badge hed-badge--${statusCls}`}>
                                                        {yr.status?.replace(/_/g, ' ')}
                                                    </span>
                                                </div>

                                                {/* Workflow Stepper */}
                                                <div className="hed-yearly-stepper">
                                                    {wfSteps.map((label, i) => {
                                                        const done = wfStep > i;
                                                        const active = wfStep === i;
                                                        return (
                                                            <div key={i} className="hed-yearly-step">
                                                                {i > 0 && <div className={`hed-yearly-step-line${done || active ? ' hed-yearly-step-line--done' : ''}`} />}
                                                                <div className={`hed-yearly-step-dot${done ? ' hed-yearly-step-dot--done' : active ? ' hed-yearly-step-dot--active' : ''}`}>
                                                                    {done ? <FiCheckCircle size={11} /> : <FiClock size={11} />}
                                                                </div>
                                                                <span className={`hed-yearly-step-label${active ? ' hed-yearly-step-label--active' : ''}`}>{label}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Score breakdown */}
                                                {(yr.raTotalScore != null || yr.hrdTotalScore != null || yr.mdFinalScore != null || yr.grandTotal != null) && (
                                                    <div className="hed-yearly-scores">
                                                        {yr.raTotalScore != null && (
                                                            <div className="hed-yearly-score-chip hed-yearly-score-chip--ra">
                                                                <div className="hed-yearly-score-label">RA Score</div>
                                                                <div className="hed-yearly-score-val">{yr.raTotalScore}<span>/80</span></div>
                                                                <div className="hed-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.raTotalScore/80)*100)}%`, background: '#f97316' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.hrdTotalScore != null && (
                                                            <div className="hed-yearly-score-chip hed-yearly-score-chip--hrd">
                                                                <div className="hed-yearly-score-label">HRD Score</div>
                                                                <div className="hed-yearly-score-val">{yr.hrdTotalScore}<span>/5</span></div>
                                                                <div className="hed-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.hrdTotalScore/5)*100)}%`, background: '#0ea5e9' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.mdFinalScore != null && (
                                                            <div className="hed-yearly-score-chip hed-yearly-score-chip--md">
                                                                <div className="hed-yearly-score-label">MD Score</div>
                                                                <div className="hed-yearly-score-val">{yr.mdFinalScore}<span>/15</span></div>
                                                                <div className="hed-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.mdFinalScore/15)*100)}%`, background: '#8b5cf6' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.grandTotal != null && (
                                                            <div className="hed-yearly-score-chip hed-yearly-score-chip--total">
                                                                <div className="hed-yearly-score-label">Grand Total</div>
                                                                <div className="hed-yearly-score-val">{yr.grandTotal}<span>/100</span></div>
                                                                <div className="hed-yearly-score-bar"><div style={{ width: `${Math.min(100,yr.grandTotal)}%`, background: '#22c55e' }} /></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* KRA Assessment Cards */}
                                                {kraAssessments.length > 0 && (
                                                    <div className="hed-yearly-kra-cards">
                                                        <div className="hed-yearly-kra-cards-title"><FiTarget size={13} /> KRA Self-Assessment</div>
                                                        {kraAssessments.map((kra, idx) => (
                                                            <div key={kra.id || idx} className="hed-yearly-kra-card">
                                                                <div className="hed-yearly-kra-card-hdr">
                                                                    <div className="hed-kra-num-badge">{(kra.kraIndex ?? idx) + 1}</div>
                                                                    <div className="hed-yearly-kra-card-info">
                                                                        <div className="hed-yearly-kra-card-desc">{kra.description}</div>
                                                                        <div className="hed-yearly-kra-pills">
                                                                            {kra.target && <span className="hed-kra-pill"><strong>Target:</strong> {kra.target}</span>}
                                                                            {kra.timeline && <span className="hed-kra-pill hed-kra-pill--timeline">{kra.timeline}</span>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="hed-yearly-kra-card-body">
                                                                    <div className="hed-yearly-kra-ach-label">Employee Achievement</div>
                                                                    <p className="hed-yearly-kra-ach-text">
                                                                        {kra.achievement && kra.achievement.trim()
                                                                            ? kra.achievement
                                                                            : <em style={{ color: 'var(--text-muted)' }}>No achievement text submitted for this KRA.</em>
                                                                        }
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* HRD Remarks */}
                                                {yr.hrdRemarks && (
                                                    <div className="hed-yearly-remarks">
                                                        <span><FiMessageSquare size={12} /> HRD Remarks:</span>
                                                        <p>{yr.hrdRemarks}</p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default HRDEmployeeDetailPage;