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
import './RAEmployeeDetail.css';
// FISCAL YEAR FIX — shared fiscal utilities
import { getCurrentFiscalYear, getFiscalYearShort } from '../../utils/fiscalUtils';

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
function getProgressTokens(p) {
    const v = Math.min(100, Math.max(0, p || 0));
    if (v === 100) return { label: 'Completed', ringColor: '#3B6D11', barColor: '#3B6D11', badgeBg: '#EAF3DE', badgeText: '#27500A', borderColor: '#3B6D11', pctClass: 'pp-green', markerActive: 4 };
    if (v >= 75)  return { label: 'Almost done', ringColor: '#BA7517', barColor: '#BA7517', badgeBg: '#FAEEDA', badgeText: '#633806', borderColor: '#BA7517', pctClass: 'pp-amber', markerActive: 3 };
    if (v >= 50)  return { label: 'Halfway', ringColor: '#E85523', barColor: '#E85523', badgeBg: '#FFF0EB', badgeText: '#993C1D', borderColor: '#E85523', pctClass: 'pp-orange', markerActive: 2 };
    if (v >= 25)  return { label: 'Just started', ringColor: '#BA7517', barColor: '#BA7517', badgeBg: '#FAEEDA', badgeText: '#633806', borderColor: '#BA7517', pctClass: 'pp-amber', markerActive: 1 };
    return { label: 'Not started', ringColor: '#A32D2D', barColor: '#A32D2D', badgeBg: '#FCEBEB', badgeText: '#791F1F', borderColor: '#A32D2D', pctClass: 'pp-red', markerActive: 0 };
}
function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.length > 0)
        return plan.planItems.map(p => typeof p === 'string' ? p : p.itemText).filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}
function parseLegacyPlanAch(legacyText, planCount) {
    const result = Array.from({ length: planCount }, () => ({ achievementDetails: '', progress: 0 }));
    if (!legacyText) return result;
    const lines = legacyText.split('\n');
    let currentIdx = -1;
    lines.forEach(line => {
        const withPct = line.match(/^Plan\s+(\d+)\s*\[(\d+)%\]:\s*(.*)/i);
        const withoutPct = !withPct && line.match(/^Plan\s+(\d+):\s*(.*)/i);
        if (withPct) {
            const idx = parseInt(withPct[1]) - 1;
            if (idx >= 0 && idx < planCount) { currentIdx = idx; result[idx].progress = Math.min(100, parseInt(withPct[2]) || 0); result[idx].achievementDetails = withPct[3].trim(); }
        } else if (withoutPct) {
            const idx = parseInt(withoutPct[1]) - 1;
            if (idx >= 0 && idx < planCount) { currentIdx = idx; result[idx].achievementDetails = withoutPct[2].trim(); }
        } else if (currentIdx >= 0 && line.trim() && !line.match(/^Additional:/i)) {
            result[currentIdx].achievementDetails += (result[currentIdx].achievementDetails ? ' ' : '') + line.trim();
        }
    });
    return result;
}
function getEffectivePlanAch(ach, planCount) {
    if (!ach) return null;
    const pa = ach.planAchievements;
    if (Array.isArray(pa) && pa.length > 0) {
        const hasRealData = pa.some(a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0);
        if (hasRealData) return pa;
    }
    if (ach.achievementDetails) {
        const parsed = parseLegacyPlanAch(ach.achievementDetails, planCount);
        const hasParsedData = parsed.some(a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0);
        if (hasParsedData) return parsed;
    }
    return null;
}
function parseAdditionalAch(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(a => (a.text || '').trim());
    } catch { /* fall through */ }
    const match = raw.match(/Additional:\s*([\s\S]+)/i);
    if (match) {
        try {
            const p = JSON.parse(match[1].trim());
            if (Array.isArray(p)) return p.filter(a => (a.text || '').trim());
        } catch { /* fall through */ }
        return [{ text: match[1].trim(), progress: 100 }];
    }
    return raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('Additional:')).map(t => ({ text: t.trim(), progress: 100 }));
}
const MONTH_PALETTES_RA = [
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#FCEBEB', color: '#791F1F' },
    { bg: '#EEEDFE', color: '#3C3489' }, { bg: '#E1F5EE', color: '#085041' },
    { bg: '#FAECE7', color: '#712B13' }, { bg: '#FFF0EB', color: '#993C1D' },
    { bg: '#E6F1FB', color: '#0C447C' }, { bg: '#EAF3DE', color: '#27500A' },
    { bg: '#FAEEDA', color: '#633806' }, { bg: '#EEEDFE', color: '#3C3489' },
];
function getMonthChipStyle(monthStr) {
    if (!monthStr) return MONTH_PALETTES_RA[0];
    const m = parseInt(monthStr.split('-')[1]) - 1;
    return MONTH_PALETTES_RA[m] || MONTH_PALETTES_RA[0];
}
function CircularProgressMod({ progress, size = 46 }) {
    const p = Math.min(100, Math.max(0, progress || 0));
    const r = (size - 6) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (p / 100) * circ;
    const tk = getProgressTokens(p);
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-default)" strokeWidth={4.5} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={tk.ringColor} strokeWidth={4.5}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.35s ease' }} />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle"
                style={{
                    transform: `rotate(90deg)`,
                    transformOrigin: `${size / 2}px ${size / 2}px`,
                    fontSize: 9.5, fontWeight: 700,
                    fill: 'var(--text-primary)', fontFamily: 'inherit'
                }}>
                {p}%
            </text>
        </svg>
    );
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
    
    const data = payload[0].payload;
    let title = formatMonth(label) || label;
    
    if (data.quarter) {
        const dateStr = data.updatedAt || data.generatedAt || data.createdAt;
        title = dateStr ? `Updated: ${new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : data.quarter;
    }
    
    return (
        <div className="red-chart-tooltip">
            <div className="red-chart-tooltip-label">{title}</div>
            {payload.map((p, i) => (
                <div key={i} className="red-chart-tooltip-row">
                    <span className="red-chart-tooltip-dot" style={{ background: p.color || p.fill }} />
                    <span>{p.name}:</span>
                    <strong style={{ color: getScoreColor(p.value) }}>
                        {Number(p.value)}/10
                    </strong>
                </div>
            ))}
        </div>
    );
}
const GO_LIVE_FY = '2026-27';
const GO_LIVE_FY_START = 2026;
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
    // FISCAL YEAR FIX — default to current fiscal year ("YYYY-YY") instead of calendar year
    const [filterYear, setFilterYear] = useState(getCurrentFiscalYear());

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
        deadlineExtensions: rawDeadlineExtensions,
    } = data;
    // Defensive: API may return null/undefined if the field is new and the
    // backend hasn't been redeployed yet — default to empty array.
    const deadlineExtensions = Array.isArray(rawDeadlineExtensions) ? rawDeadlineExtensions : [];

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

    /* ── FISCAL YEAR FIX — Build FY labels from actual data
       FY format: "YYYY-YY" e.g. "2025-26"
       A month string "YYYY-MM" belongs to FY starting in YYYY if MM >= 04,
       or to FY starting in YYYY-1 if MM <= 03.
    ── */
    function monthToFY(monthStr) {
        if (!monthStr) return null;
        const [y, m] = monthStr.split('-').map(Number);
        const startYear = m >= 4 ? y : y - 1;
        return `${startYear}-${String(startYear + 1).slice(-2)}`;
    }
    function quarterToFY(quarterStr) {
        // quarterStr: "Q1-2025" — label year IS the FY start year for Q1-Q3
        // Q4-YYYY: FY start year is YYYY (Q4=Jan-Mar of YYYY+1, but labelled with YYYY)
        if (!quarterStr) return null;
        const match = quarterStr.match(/^Q(\d)-(\d{4})$/);
        if (!match) return null;
        const startYear = parseInt(match[2], 10);
        return `${startYear}-${String(startYear + 1).slice(-2)}`;
    }

    // ── Build FY dropdown: go-live FY → current FY only ──
const nowFY      = getCurrentFiscalYear();                    // e.g. "2026-27"
const nowFYStart = parseInt(nowFY.split('-')[0], 10);         // e.g. 2026

const fySet = new Set();

// Generate every FY from go-live up to current — no past, no future
for (let s = GO_LIVE_FY_START; s <= nowFYStart; s++) {
    fySet.add(`${s}-${String(s + 1).slice(-2)}`);
}

// Also include FYs from actual employee data,
// but only if they fall within the allowed window
const isAllowedFY = (fy) => {
    if (!fy) return false;
    const start = parseInt(fy.split('-')[0], 10);
    return start >= GO_LIVE_FY_START && start <= nowFYStart;
};

monthlyPlans.forEach(p => { const fy = monthToFY(p.month); if (isAllowedFY(fy)) fySet.add(fy); });
quarterlyEvaluations.forEach(q => { const fy = quarterToFY(q.quarter); if (isAllowedFY(fy)) fySet.add(fy); });
yearlyPlans.forEach(y => { if (isAllowedFY(y.financialYear)) fySet.add(y.financialYear); });
yearlyReports.forEach(y => { if (isAllowedFY(y.financialYear)) fySet.add(y.financialYear); });

// Sort descending so current FY is always at the top
const availableYears = Array.from(fySet).sort((a, b) =>
    parseInt(b.split('-')[0]) - parseInt(a.split('-')[0])
);

    /* ── FISCAL YEAR FIX — filter months by FY range (Apr startYear – Mar startYear+1)
       A month "YYYY-MM" is in FY "YYYY-YY" when:
         (year == startYear && month >= 4) OR (year == startYear+1 && month <= 3)
    ── */
    function monthInFY(monthStr, fy) {
        if (!monthStr || !fy) return false;
        const [y, m] = monthStr.split('-').map(Number);
        const startYear = parseInt(fy.split('-')[0], 10);
        return (y === startYear && m >= 4) || (y === startYear + 1 && m <= 3);
    }
    function quarterInFY(quarterStr, fy) {
        // Q label year == FY start year for all quarters
        if (!quarterStr || !fy) return false;
        const match = quarterStr.match(/^Q\d-(\d{4})$/);
        if (!match) return false;
        return parseInt(match[1], 10) === parseInt(fy.split('-')[0], 10);
    }

    const filteredMonths    = unifiedMonths.filter(m => monthInFY(m.month, filterYear));
    const filteredQuarterly = quarterlyEvaluations.filter(q => quarterInFY(q.quarter, filterYear));
    const fyMatch           = fy => fy === filterYear;
    const filteredYearlyPlans   = yearlyPlans.filter(y => fyMatch(y.financialYear));
    const filteredYearlyReports = yearlyReports.filter(y => fyMatch(y.financialYear));
    const filteredEvals = monthlyEvaluations.filter(e => monthInFY(e.month, filterYear));

    /* ── FY-scoped deadline extensions (matches same FY filter as monthly/quarterly) ── */
    const filteredExtensions = deadlineExtensions
        .filter(e => {
            // Convert (year, month) int fields to a "YYYY-MM" string for monthToFY()
            const fy = monthToFY(`${e.year}-${String(e.month).padStart(2, '0')}`);
            return fy === filterYear;
        })
        // Client-side sort DESC — defensive: API sends newest-first but we don't rely on it
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    /* ── Stats ── */
    // NOTE: Sequelize returns DECIMAL columns as strings, so we must parseFloat()
    // before any arithmetic. Without it, (0 + "9.00") = "09.00" (string concat)
    // and the subsequent division produces NaN.
    const evaluatedEvals = filteredEvals.filter(e => e.status === 'EVALUATED' && parseFloat(e.score) > 0);
    const avgScore = evaluatedEvals.length > 0
        ? Number((evaluatedEvals.reduce((s, e) => s + parseFloat(e.score), 0) / evaluatedEvals.length).toFixed(1))
        : '—';

    /* ── KPI derived ── */
    const bestEval  = evaluatedEvals.length > 0 ? evaluatedEvals.reduce((b, e) => parseFloat(e.score) > parseFloat(b.score) ? e : b, evaluatedEvals[0]) : null;
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
        const abs  = Math.abs(scoreTrend).toFixed(1);
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
        { key: 'overview',    label: 'Analytics',         icon: <FiBarChart2 /> },
        { key: 'monthly',     label: 'Monthly Reviews',   icon: <FiCalendar />, count: filteredMonths.length },
        { key: 'quarterly',   label: 'Quarterly',         icon: <FiTarget />,   count: filteredQuarterly.length },
        { key: 'yearly',      label: 'Yearly',            icon: <FiAward />,    count: filteredYearlyPlans.length + filteredYearlyReports.length },
        { key: 'extensions',  label: 'Extension History', icon: <FiClock />,    count: filteredExtensions.length },
    ];

    /* ── Status badge helper — UNCHANGED ── */
    const getStatusBadge = plan => {
        if (plan.status === 'REJECTED') return <span className="red-badge red-badge--rejected">Rejected by RA</span>;
        if (plan.isEval)                return <span className="red-badge red-badge--evaluated">Evaluated</span>;
        if (plan.hasAchievement)        return <span className="red-badge red-badge--achievement">Progress Submitted</span>;
        return <span className="red-badge red-badge--submitted">Plan Submitted</span>;
    };

    /* ════════════════════════════════════════════════════
       MONTHLY REVIEW MODAL — New design matching MonthlyPlanPage
       Shows each plan linked with its achievement, progress ring/bar
    ════════════════════════════════════════════════════ */
    const renderDetailModal = () => {
        if (!selectedMonthDetail) return null;
        const plan       = selectedMonthDetail;
        const ev         = plan.evaluation;
        const isEval     = plan.isEval;
        const ach        = plan.achievement;
        const isRejected = plan.status === 'REJECTED';
        const chipStyle  = getMonthChipStyle(plan.month);
        const planItemsList = getPlanItems(plan);

        // Derive achievement data
        const effectivePlanAch = getEffectivePlanAch(ach, planItemsList.length);
        const hasStructuredAch = !!effectivePlanAch;

        // Additional achievements
        let additionalItems = parseAdditionalAch(ach?.additionalAchievement || '');
        if (additionalItems.length === 0 && ach?.achievementDetails) {
            const addlMatch = ach.achievementDetails.match(/Additional:\s*([\s\S]+)/i);
            if (addlMatch) {
                const captured = addlMatch[1].trim();
                try {
                    const parsed = JSON.parse(captured);
                    additionalItems = Array.isArray(parsed) ? parsed.filter(a => (a.text || '').trim()) : [{ text: captured, progress: 100 }];
                } catch { additionalItems = [{ text: captured, progress: 100 }]; }
            }
        }

        // Overall progress
        const achOverall = hasStructuredAch
            ? Math.round(effectivePlanAch.reduce((s, a) => s + Math.min(100, a.progress || 0), 0) / effectivePlanAch.length)
            : null;
        const achCompleted = hasStructuredAch
            ? effectivePlanAch.filter(a => (a.progress || 0) >= 100).length : 0;

        // Stepper
        const stepperPlan = 'done';
        const stepperAch  = plan.hasAchievement ? 'done' : 'active';
        const stepperEval = isEval ? 'done' : plan.hasAchievement ? 'active' : 'idle';
        const line1 = plan.hasAchievement ? 'filled' : 'empty';
        const line2 = isEval ? 'filled' : 'empty';

        // Status pill
        const stLabel = isRejected ? 'Rejected' : isEval ? 'Evaluated' : plan.hasAchievement ? 'Progress added' : 'Plan submitted';
        const stCls   = isRejected ? 'sp-rejected' : isEval ? 'sp-eval' : plan.hasAchievement ? 'sp-ach' : 'sp-plan';

        return createPortal(
            <div className="mp-overlay" onClick={() => setSelectedMonthDetail(null)}>
                <div className="dmod dmod--wide" onClick={e => e.stopPropagation()}>

                    {/* ── HEADER ── */}
                    <div className="dmod-hdr">
                        <div className="dmod-hdr-left">
                            <div className="dmod-month-chip" style={{ background: chipStyle.bg, color: chipStyle.color }}>
                                <span className="dmod-mc-mon">{shortMonth(plan.month).toUpperCase()}</span>
                                <span className="dmod-mc-yr">{shortYear(plan.month)}</span>
                            </div>
                            <div>
                                <div className="dmod-title">{formatMonth(plan.month)}</div>
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
                        <button className="dmod-close" onClick={() => setSelectedMonthDetail(null)}>
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
                            <div className="red-status-banner red-status-banner--rejected" style={{ marginBottom: 12 }}>
                                <FiAlertCircle /> This plan was rejected by the Reporting Authority (RA)
                            </div>
                        )}

                        {/* Overall progress bar — only when achievement exists & structured */}
                        {ach && ach.status !== 'DRAFT' && achOverall !== null && (
                            <div className="dmod-op-bar">
                                <div className="dmod-op-row">
                                    <span className="dmod-op-lbl">Overall progress</span>
                                    <span className="dmod-op-val">
                                        {achCompleted}/{effectivePlanAch.length} plans done
                                        <span> · {achOverall}%</span>
                                    </span>
                                </div>
                                <div className="dmod-pt">
                                    <div className="dmod-pf" style={{ width: `${achOverall}%` }} />
                                </div>
                                <div className="dmod-ts-row">
                                    <span className="dmod-ts-item">
                                        <FiFileText size={10} />
                                        Plan submitted {formatDateShort(plan.submittedAt)}
                                    </span>
                                    {ach?.submittedAt && (
                                        <span className="dmod-ts-item">
                                            <FiTrendingUp size={10} />
                                            Progress submitted {formatDateShort(ach.submittedAt)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Plans & Achievements section */}
                        <div>
                            <div className="dmod-sec-lbl">
                                <FiFileText size={13} />
                                {ach && ach.status !== 'DRAFT' ? 'Plans & progress' : 'Plan details'}
                                <span className="dmod-sec-count-pill">{planItemsList.length} plan{planItemsList.length !== 1 ? 's' : ''}</span>
                            </div>

                            {/* Case A — no achievement yet: simple plan list */}
                            {(!ach || ach.status === 'DRAFT') && (
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

                            {/* Case B — achievement submitted with structured per-plan data */}
                            {ach && ach.status !== 'DRAFT' && hasStructuredAch && (
                                <div className="dmod-plan-list">
                                    {planItemsList.map((planText, i) => {
                                        const pa = effectivePlanAch[i] || { achievementDetails: '', progress: 0 };
                                        const p = Math.min(100, pa.progress || 0);
                                        const tk = getProgressTokens(p);
                                        const pStatusLabel = p === 100 ? 'Completed' : p > 0 ? 'In progress' : 'Not started';
                                        const pStatusCls = p === 100 ? 'dmod-pstatus--done' : p > 0 ? 'dmod-pstatus--partial' : 'dmod-pstatus--none';
                                        return (
                                            <div key={i} className="dmod-pcard-wrap">
                                                <div className="dmod-pcard" style={{ borderLeftColor: tk.borderColor }}>
                                                    <div className="dmod-ptop">
                                                        <div className="dmod-pring-wrap">
                                                            <span className="dmod-plan-idx-pill" style={{ background: tk.badgeBg, color: tk.badgeText }}>{i + 1}</span>
                                                            <CircularProgressMod progress={p} size={44} />
                                                        </div>
                                                        <div className="dmod-pinfo">
                                                            <div className="dmod-pname-row">
                                                                <span className="dmod-pname">Plan {i + 1}</span>
                                                                <span className={`dmod-pstatus ${pStatusCls}`}>{pStatusLabel}</span>
                                                            </div>
                                                            <div className="dmod-pdesc">{planText}</div>
                                                        </div>
                                                    </div>
                                                    <div className="dmod-prog-section">
                                                        <div className="dmod-prog-labels">
                                                            <span className="dmod-prog-title">Progress</span>
                                                            <span className={`dmod-prog-pct ${tk.pctClass}`}>
                                                                {p}% {p === 100 ? '— Done' : p > 0 ? '— In progress' : '— Not started'}
                                                            </span>
                                                        </div>
                                                        <div className="dmod-prog-bar">
                                                            <div className="dmod-pb-fill" style={{ width: `${p}%`, background: tk.barColor }} />
                                                        </div>
                                                        <div className="dmod-prog-markers">
                                                            {[0, 25, 50, 75].map((m, mi) => (
                                                                <span key={m} style={p >= m && mi <= tk.markerActive ? { color: tk.barColor, fontWeight: 600 } : {}}>{m}%</span>
                                                            ))}
                                                            <span style={p === 100 ? { color: tk.barColor, fontWeight: 600 } : {}}>Done</span>
                                                        </div>
                                                    </div>
                                                    <div className="dmod-ach-section">
                                                        <div className="dmod-ach-lbl">
                                                            <FiTrendingUp size={11} /> Progress details
                                                        </div>
                                                        {pa.achievementDetails
                                                            ? <div className="dmod-ach-text">{pa.achievementDetails}</div>
                                                            : <div className="dmod-ach-empty">No details provided</div>
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Case C — achievement submitted but fully legacy text only */}
                            {ach && ach.status !== 'DRAFT' && !hasStructuredAch && ach.achievementDetails && (
                                <div className="dmod-legacy-ach">
                                    <div className="dmod-ach-lbl"><FiTrendingUp size={11} /> Progress Details</div>
                                    <div className="dmod-ach-text">{ach.achievementDetails}</div>
                                </div>
                            )}
                        </div>

                        {/* No achievement yet block */}
                        {(!ach || ach.status === 'DRAFT') && (
                            <div className="dmod-no-ach-block">
                                <div className="dmod-no-ach-icon"><FiTrendingUp size={16} /></div>
                                <div className="dmod-no-ach-text">
                                    {ach?.status === 'DRAFT'
                                        ? 'Achievement draft saved — not yet submitted.'
                                        : 'Achievement not submitted yet.'}
                                </div>
                            </div>
                        )}

                        {/* Additional achievements */}
                        {additionalItems.length > 0 && (
                            <div className="dmod-extras-card">
                                <div className="dmod-extras-hdr">
                                    <div className="dmod-extras-title"><FiStar size={13} /> Additional work done with progress</div>
                                    <span className="dmod-extras-badge">{additionalItems.length} extra{additionalItems.length !== 1 ? 's' : ''}</span>
                                </div>
                                {additionalItems.map((item, i) => {
                                    const text = typeof item === 'string' ? item : (item.text || '');
                                    const iprog = typeof item === 'string' ? 100 : Math.min(100, item.progress || 100);
                                    const tk = getProgressTokens(iprog);
                                    return (
                                        <div key={i} className="dmod-extra-item">
                                            <div className="dmod-extra-num">{i + 1}</div>
                                            <div className="dmod-extra-content">
                                                <div className="dmod-extra-text">{text}</div>
                                                <div className="dmod-extra-prog-row">
                                                    <div className="dmod-extra-bar">
                                                        <div className="dmod-extra-bar-fill" style={{ width: `${iprog}%`, background: tk.barColor }} />
                                                    </div>
                                                    <span className="dmod-extra-pct-lbl" style={{ color: tk.badgeText }}>{iprog}% — {tk.label}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
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
                                            <div className="dmod-ra-score">Score: <strong>{Number(ev.score)}/10</strong></div>
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
                                <div className="dmod-score-chip">{Number(ev.score)}/10</div>
                            )}
                        </div>

                        {/* ⏱ Deadline Extension block — read-only, amber accent
                             Renders only if there is an extension for this specific
                             month + type combination. No edit/delete affordance. */}
                        {(() => {
                            const [py, pm] = (plan.month || '').split('-').map(Number);
                            // Match on month, year, AND type to avoid cross-type false positives
                            const planTypeKey = plan.missingType || 'plan'; // fallback
                            const extRecords = filteredExtensions.filter(e =>
                                e.year === py && e.month === pm
                            );
                            if (extRecords.length === 0) return null;
                            return extRecords.map((ext, idx) => (
                                <div key={ext.id || idx} className="dmod-ext-box">
                                    <div className="dmod-ext-header">
                                        <FiClock size={12} />
                                        <span className="dmod-ext-title">
                                            DEADLINE EXTENDED
                                            <span className="dmod-ext-type-pill">
                                                {ext.type === 'PLAN' ? 'Plan' : 'Progress'}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="dmod-ext-row">
                                        <span className="dmod-ext-label">Original:</span>
                                        <span className="dmod-ext-val">
                                            {formatDateShort(ext.oldDeadline)}
                                        </span>
                                        <span className="dmod-ext-arrow">→</span>
                                        <span className="dmod-ext-val dmod-ext-val--new">
                                            {formatDateShort(ext.newDeadline)}
                                        </span>
                                    </div>
                                    <div className="dmod-ext-row dmod-ext-row--meta">
                                        <span>
                                            By: <strong>{ext.extendedBy?.name || 'RA'}</strong> (RA)
                                        </span>
                                        <span className="dmod-ext-dot">·</span>
                                        <span>{formatDateShort(ext.createdAt)}</span>
                                    </div>
                                    <div className="dmod-ext-reason">
                                        &ldquo;{ext.reason}&rdquo;
                                    </div>
                                </div>
                            ));
                        })()}

                        {/* RA rejection reason */}
                        {isRejected && (plan.raRemarks || plan.mdRemarks) && (
                            <div className="red-modal-section red-modal-section--danger" style={{ marginTop: 12 }}>
                                <div className="red-modal-section-hd">
                                    <div className="red-modal-section-icon red-modal-section-icon--danger"><FiAlertCircle /></div>
                                    <span>RA Rejection Reason</span>
                                </div>
                                <div className="red-modal-section-body">
                                    <p className="red-modal-text red-modal-text--danger">{plan.raRemarks || plan.mdRemarks}</p>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* ── FOOTER ── */}
                    <div className="dmod-footer">
                        <span className="dmod-ftr-state">
                            {isEval ? 'Evaluated' : plan.hasAchievement ? 'Awaiting RA review' : 'Progress pending'}
                        </span>
                        <button className="dmod-btn-close" onClick={() => setSelectedMonthDetail(null)}>Close</button>
                    </div>

                </div>
            </div>,
            document.body
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
                                    <FiCheckCircle /> {completionRate}% completion (FY {filterYear})
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
                    value={bestEval ? `${Number(bestEval.score)}/10` : '—'}
                    sub={bestEval ? formatMonth(bestEval.month) : 'No evaluations'}
                    icon={<FiStar />} color="#22C55E" trend={bestEval ? 'up' : null}
                />
                <KPICard label="Worst Month"
                    value={worstEval ? `${Number(worstEval.score)}/10` : '—'}
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
                    sub={`FY ${filterYear} · ${filteredMonths.length} plans`}
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
                        {/* FISCAL YEAR FIX — options show "FY YYYY-YY" but value is "YYYY-YY" */}
                        {availableYears.map(fy => (
                            <option key={fy} value={fy}>FY {fy}</option>
                        ))}
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
                                <p className="red-chart-empty">No evaluations yet for FY {filterYear}</p>
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
                                <p className="red-chart-empty">No quarterly evaluations for FY {filterYear}</p>
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
                            <p>No monthly reviews found for FY {filterYear} (Apr {filterYear.split('-')[0]} – Mar {parseInt(filterYear.split('-')[0]) + 1})</p>
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
                                        <tr key={plan.id} className="red-table-row"
                                            onClick={() => setSelectedMonthDetail(plan)}>
                                            <td>
                                                <div className="red-month-cell">
                                                    <div className="red-month-badge">{shortMonth(plan.month)}</div>
                                                    <div>
                                                        <strong>{formatMonth(plan.month)}</strong>
                                                        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                                            {getStatusBadge(plan)}
                                                            {/* ⏱ Extended chip — non-interactive pointer only */}
                                                            {filteredExtensions.some(e => {
                                                                const [py, pm] = plan.month.split('-').map(Number);
                                                                return e.year === py && e.month === pm;
                                                            }) && (
                                                                <span className="red-ext-badge">
                                                                    <FiClock size={9} /> Extended
                                                                </span>
                                                            )}
                                                        </div>
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
                                                        {Number(plan.evaluation.score)}/10
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
                            <p>No quarterly evaluations found for FY {filterYear}</p>
                        </div>
                    ) : filteredQuarterly.map(qe => (
                        <div key={qe.id} className="red-qtr-card" style={{ '--qclr': getScoreColor(qe.averageScore) }}>
                            <div className="red-qtr-inner">
                                <div className="red-qtr-head">
                                    <span className="red-qtr-label"><FiBarChart2 /> {qe.quarter?.replace('-', ' ')}</span>
                                    <span className="red-qtr-score" style={{ color: getScoreColor(qe.averageScore) }}>
                                        {qe.averageScore != null ? Number(qe.averageScore) : '—'}<span>/10</span>
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
                            <p>No yearly data found for FY {filterYear}</p>
                        </div>
                    ) : (
                        <>
                            {/* ── Yearly Plans ── */}
                            {filteredYearlyPlans.length > 0 && (
                                <div className="red-yearly-section">
                                    <h3 className="red-yearly-section-title"><FiFileText /> Yearly Plans</h3>
                                    {filteredYearlyPlans.map(yp => {
                                        const statusCls = {
                                            APPROVED: 'evaluated', REJECTED: 'rejected',
                                            PENDING: 'submitted', SUBMITTED: 'submitted', EDITED: 'achievement',
                                        }[yp.status] || 'submitted';
                                        const kras = Array.isArray(yp.kras) ? [...yp.kras].sort((a,b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0)) : [];
                                        return (
                                            <div key={yp.id} className="red-yearly-card">
                                                <div className="red-yearly-card-header">
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span className="red-yearly-fy">FY {yp.financialYear}</span>
                                                        {yp.version && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{yp.version}</span>}
                                                    </div>
                                                    <span className={`red-badge red-badge--${statusCls}`}>
                                                        {yp.status?.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                                {/* KRA Table */}
                                                {kras.length > 0 ? (
                                                    <div className="red-yearly-kra-table-wrap">
                                                        <table className="red-yearly-kra-table">
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
                                                                    <tr key={kra.id || idx} className={idx % 2 === 0 ? 'red-kra-row--even' : 'red-kra-row--odd'}>
                                                                        <td><div className="red-kra-num-badge">{(kra.kraIndex ?? idx) + 1}</div></td>
                                                                        <td>{kra.description}</td>
                                                                        <td>{kra.target}</td>
                                                                        <td><span className="red-kra-timeline-badge">{kra.timeline}</span></td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <div className="red-yearly-content" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
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
                                <div className="red-yearly-section">
                                    <h3 className="red-yearly-section-title"><FiAward /> Appraisal Reports</h3>
                                    {filteredYearlyReports.map(yr => {
                                        const statusCls = {
                                            RA_EVALUATED: 'evaluated', HRD_EVALUATED: 'evaluated',
                                            MD_EVALUATED: 'evaluated', COMPLETED: 'evaluated',
                                            SUBMITTED: 'submitted', REJECTED: 'rejected',
                                        }[yr.status] || 'submitted';
                                        const kraAssessments = Array.isArray(yr.kraAssessments)
                                            ? [...yr.kraAssessments].sort((a,b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0))
                                            : [];
                                        // Workflow step
                                        const wfStep = { SUBMITTED: 1, RA_EVALUATED: 2, HRD_EVALUATED: 3, MD_EVALUATED: 4, COMPLETED: 5 }[yr.status] ?? 1;
                                        const wfSteps = ['Report Submitted', 'RA Evaluation', 'HRD Evaluation', 'MD Final', 'Completed'];
                                        return (
                                            <div key={yr.id} className="red-yearly-card">
                                                {/* Header */}
                                                <div className="red-yearly-card-header">
                                                    <span className="red-yearly-fy">FY {yr.financialYear}</span>
                                                    <span className={`red-badge red-badge--${statusCls}`}>
                                                        {yr.status?.replace(/_/g, ' ')}
                                                    </span>
                                                </div>

                                                {/* Workflow Stepper */}
                                                <div className="red-yearly-stepper">
                                                    {wfSteps.map((label, i) => {
                                                        const done = wfStep > i;
                                                        const active = wfStep === i;
                                                        return (
                                                            <div key={i} className="red-yearly-step">
                                                                {i > 0 && <div className={`red-yearly-step-line${done || active ? ' red-yearly-step-line--done' : ''}`} />}
                                                                <div className={`red-yearly-step-dot${done ? ' red-yearly-step-dot--done' : active ? ' red-yearly-step-dot--active' : ''}`}>
                                                                    {done ? <FiCheckCircle size={11} /> : <FiClock size={11} />}
                                                                </div>
                                                                <span className={`red-yearly-step-label${active ? ' red-yearly-step-label--active' : ''}`}>{label}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Score breakdown */}
                                                {(yr.raTotalScore != null || yr.hrdTotalScore != null || yr.mdFinalScore != null || yr.grandTotal != null) && (
                                                    <div className="red-yearly-scores">
                                                        {yr.raTotalScore != null && (
                                                            <div className="red-yearly-score-chip red-yearly-score-chip--ra">
                                                                <div className="red-yearly-score-label">RA Score</div>
                                                                <div className="red-yearly-score-val">{yr.raTotalScore}<span>/80</span></div>
                                                                <div className="red-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.raTotalScore/80)*100)}%`, background: '#f97316' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.hrdTotalScore != null && (
                                                            <div className="red-yearly-score-chip red-yearly-score-chip--hrd">
                                                                <div className="red-yearly-score-label">HRD Score</div>
                                                                <div className="red-yearly-score-val">{yr.hrdTotalScore}<span>/5</span></div>
                                                                <div className="red-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.hrdTotalScore/5)*100)}%`, background: '#0ea5e9' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.mdFinalScore != null && (
                                                            <div className="red-yearly-score-chip red-yearly-score-chip--md">
                                                                <div className="red-yearly-score-label">MD Score</div>
                                                                <div className="red-yearly-score-val">{yr.mdFinalScore}<span>/15</span></div>
                                                                <div className="red-yearly-score-bar"><div style={{ width: `${Math.min(100,(yr.mdFinalScore/15)*100)}%`, background: '#8b5cf6' }} /></div>
                                                            </div>
                                                        )}
                                                        {yr.grandTotal != null && (
                                                            <div className="red-yearly-score-chip red-yearly-score-chip--total">
                                                                <div className="red-yearly-score-label">Grand Total</div>
                                                                <div className="red-yearly-score-val">{yr.grandTotal}<span>/100</span></div>
                                                                <div className="red-yearly-score-bar"><div style={{ width: `${Math.min(100,yr.grandTotal)}%`, background: '#22c55e' }} /></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* KRA Assessment Cards */}
                                                {kraAssessments.length > 0 && (
                                                    <div className="red-yearly-kra-cards">
                                                        <div className="red-yearly-kra-cards-title"><FiTarget size={13} /> KRA Self-Assessment</div>
                                                        {kraAssessments.map((kra, idx) => (
                                                            <div key={kra.id || idx} className="red-yearly-kra-card">
                                                                <div className="red-yearly-kra-card-hdr">
                                                                    <div className="red-kra-num-badge">{(kra.kraIndex ?? idx) + 1}</div>
                                                                    <div className="red-yearly-kra-card-info">
                                                                        <div className="red-yearly-kra-card-desc">{kra.description}</div>
                                                                        <div className="red-yearly-kra-pills">
                                                                            {kra.target && <span className="red-kra-pill"><strong>Target:</strong> {kra.target}</span>}
                                                                            {kra.timeline && <span className="red-kra-pill red-kra-pill--timeline">{kra.timeline}</span>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="red-yearly-kra-card-body">
                                                                    <div className="red-yearly-kra-ach-label">Employee Achievement</div>
                                                                    <p className="red-yearly-kra-ach-text">
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

                                                {/* RA Remarks */}
                                                {yr.raRemarks && (
                                                    <div className="red-yearly-remarks">
                                                        <span><FiMessageSquare size={12} /> RA Remarks:</span>
                                                        <p>{yr.raRemarks}</p>
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
            {/* ════════════ EXTENSION HISTORY TAB ════════════ */}
            {activeTab === 'extensions' && (
                <div className="red-ext-tab-wrap">
                    {filteredExtensions.length === 0 ? (
                        <div className="red-empty-center">
                            <FiClock style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No deadline extensions recorded for FY {filterYear}.</p>
                        </div>
                    ) : (
                        <div className="red-table-card">
                            <div className="red-ext-tab-header">
                                <FiClock className="red-ext-tab-icon" />
                                <span>Deadline Extension Audit Trail</span>
                                <span className="red-insights-count">{filteredExtensions.length}</span>
                            </div>
                            <table className="red-table red-ext-table">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th>Type</th>
                                        <th>Original Deadline</th>
                                        <th>New Deadline</th>
                                        <th>Extended By</th>
                                        <th>Reason</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredExtensions.map((ext, idx) => (
                                        <tr key={ext.id || idx} className="red-ext-row">
                                            <td>
                                                <div className="red-month-cell">
                                                    <div className="red-month-badge">
                                                        {new Date(ext.year, ext.month - 1).toLocaleDateString('en-US', { month: 'short' })}
                                                    </div>
                                                    <strong>
                                                        {new Date(ext.year, ext.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                                    </strong>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`red-ext-type-chip red-ext-type-chip--${ext.type?.toLowerCase()}`}>
                                                    {ext.type === 'PLAN' ? '📋 Plan' : '🏆 Progress'}
                                                </span>
                                            </td>
                                            <td className="red-date-cell red-ext-old-date">
                                                {formatDateShort(ext.oldDeadline)}
                                            </td>
                                            <td className="red-date-cell">
                                                <span className="red-ext-new-date">
                                                    {formatDateShort(ext.newDeadline)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="red-ext-by">
                                                    {ext.extendedBy?.name || '—'}
                                                </span>
                                            </td>
                                            <td className="red-ext-reason-cell">
                                                <span className="red-ext-reason-text" title={ext.reason}>
                                                    {ext.reason}
                                                </span>
                                            </td>
                                            <td className="red-date-cell">
                                                {formatDateShort(ext.createdAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default RAEmployeeDetailPage;