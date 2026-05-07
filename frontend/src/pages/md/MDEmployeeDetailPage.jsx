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
    FiInfo, FiThumbsUp, FiXCircle
} from 'react-icons/fi';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import './MDEmployeeDetail.css';
import '../ra/RAEmployeeDetail.css';
import { getCurrentFiscalYear, getFiscalYearShort } from '../../utils/fiscalUtils';

/* ════════════════════════════════════════════════════
   PURE HELPERS
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
    if (Array.isArray(plan.planItems) && plan.planItems.filter(Boolean).length > 0)
        return plan.planItems.filter(Boolean);
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
        <div className="med-kpi-card">
            <div className="med-kpi-top">
                <div className="med-kpi-icon" style={{ background: `${color}15`, color }}>{icon}</div>
                {trend && (
                    <span className={`med-kpi-trend med-kpi-trend--${trend}`}>
                        {trend === 'up' ? <FiTrendingUp /> : trend === 'down' ? <FiTrendingDown /> : <FiActivity />}
                    </span>
                )}
            </div>
            <div className="med-kpi-value" style={{ color: value === '—' ? 'var(--text-muted)' : undefined }}>{value}</div>
            <div className="med-kpi-label">{label}</div>
            {sub && <div className="med-kpi-sub">{sub}</div>}
        </div>
    );
}

/* ════════════════════════════════════════════════════
   INSIGHT PILL
════════════════════════════════════════════════════ */
function InsightPill({ icon, text, variant }) {
    return (
        <div className={`med-insight-pill med-insight-pill--${variant}`}>
            <span className="med-insight-pill-icon">{icon}</span>
            <span className="med-insight-pill-text">{text}</span>
        </div>
    );
}

/* ════════════════════════════════════════════════════
   CUSTOM RECHARTS TOOLTIP
════════════════════════════════════════════════════ */
function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    return (
        <div className="med-chart-tooltip">
            <div className="med-chart-tooltip-label">{formatMonth(label) || label}</div>
            {payload.map((p, i) => (
                <div key={i} className="med-chart-tooltip-row">
                    <span className="med-chart-tooltip-dot" style={{ background: p.color || p.fill }} />
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
const MDEmployeeDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedMonthDetail, setSelectedMonthDetail] = useState(null);
    const [filterYear, setFilterYear] = useState(getCurrentFiscalYear());

    // MD Rejection states
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectRemarks, setRejectRemarks] = useState('');
    const [rejecting, setRejecting] = useState(false);

    const fetchDetail = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/md/employee/${id}`);
            setData(res.data);
        } catch {
            toast.error('Failed to load employee detail');
            navigate('/md/employees');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDetail();
    }, [id, navigate]);

    const handleReject = async () => {
        if (!rejectTarget) return;
        setRejecting(true);
        try {
            await api.put(`/md/monthly-plan/${rejectTarget._id}/reject`, { mdRemarks: rejectRemarks });
            toast.success('Monthly plan rejected');
            setRejectTarget(null);
            setRejectRemarks('');
            fetchDetail();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Rejection failed');
        } finally {
            setRejecting(false);
        }
    };

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
                <button className="med-back-btn" onClick={() => navigate('/md/employees')}>
                    <FiArrowLeft /> Back to Directory
                </button>
                <div className="med-empty-center">Employee not found</div>
            </div>
        );
    }

    const {
        employee, monthlyPlans, monthlyAchievements,
        monthlyEvaluations, quarterlyEvaluations, yearlyPlans, yearlyReports,
    } = data;

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
    (yearlyPlans || []).forEach(y => { if (y.financialYear) fySet.add(y.financialYear); });
    (yearlyReports || []).forEach(y => { if (y.financialYear) fySet.add(y.financialYear); });

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
    const filteredYearlyPlans   = (yearlyPlans || []).filter(y => fyMatch(y.financialYear));
    const filteredYearlyReports = (yearlyReports || []).filter(y => fyMatch(y.financialYear));
    const filteredEvals = monthlyEvaluations.filter(e => monthInFY(e.month, filterYear));

    const evaluatedEvals = filteredEvals.filter(e => e.status === 'EVALUATED' && e.score > 0);
    const avgScore = evaluatedEvals.length > 0
        ? (evaluatedEvals.reduce((s, e) => s + e.score, 0) / evaluatedEvals.length).toFixed(1)
        : '—';

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
        insights.push({ icon: <FiThumbsUp />, variant: 'positive', text: `100% evaluation completion for FY ${filterYear} — all plans reviewed` });
    else if (completionRate < 50 && filteredMonths.length > 1)
        insights.push({ icon: <FiInfo />, variant: 'warning', text: `Only ${completionRate}% evaluated in FY ${filterYear} — ${filteredMonths.filter(m => !m.isEval).length} pending review` });

    const headerStatus = completionRate === 100 && filteredMonths.length > 0
        ? { label: 'On Track', cls: 'green' }
        : completionRate < 50 && filteredMonths.length > 1
            ? { label: 'Needs Attention', cls: 'amber' }
            : { label: 'Active', cls: 'blue' };

    const tabs = [
        { key: 'overview',  label: 'Analytics',      icon: <FiBarChart2 /> },
        { key: 'monthly',   label: 'Monthly Reviews', icon: <FiCalendar />, count: filteredMonths.length },
        { key: 'quarterly', label: 'Quarterly',       icon: <FiTarget />,   count: filteredQuarterly.length },
        { key: 'yearly',    label: 'Yearly',          icon: <FiAward />,    count: filteredYearlyPlans.length + filteredYearlyReports.length },
    ];

    const getStatusBadge = plan => {
        if (plan.status === 'REJECTED') return <span className="med-badge med-badge--rejected">Rejected by MD</span>;
        if (plan.isEval)                return <span className="med-badge med-badge--evaluated">Evaluated</span>;
        if (plan.hasAchievement)        return <span className="med-badge med-badge--achievement">Achievement Submitted</span>;
        return <span className="med-badge med-badge--submitted">Plan Submitted</span>;
    };

    /* ════════════════════════════════════════════════════
       MD REJECTION MODAL
    ════════════════════════════════════════════════════ */
    const renderRejectModal = () => {
        if (!rejectTarget) return null;
        return createPortal(
            <div className="med-overlay" onClick={() => setRejectTarget(null)}>
                <div className="med-modal" style={{ height: 'auto', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
                    <div className="med-modal-header">
                        <div className="med-modal-header-left">
                            <div className="med-modal-avatar" style={{ background: '#FEE2E2', color: '#DC2626' }}><FiAlertCircle /></div>
                            <div className="med-modal-header-info">
                                <h2 className="med-modal-name">Reject Monthly Plan</h2>
                                <p className="med-modal-sub">{employee.name} · {formatMonth(rejectTarget.month)}</p>
                            </div>
                        </div>
                        <button className="med-modal-close-btn" onClick={() => setRejectTarget(null)}><FiX /></button>
                    </div>

                    <div className="med-modal-body" style={{ padding: '20px' }}>
                        <div className="med-modal-section" style={{ borderLeftColor: '#E2E8F0', background: '#F8FAFC', padding: '15px', borderRadius: '8px' }}>
                            <div className="med-modal-section-hd" style={{ background: 'transparent', padding: '0 0 10px 0', border: 'none' }}>
                                <FiFileText style={{ color: '#64748B' }} />
                                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#475569' }}>Plan Preview</span>
                            </div>
                            <div className="med-modal-text">{rejectTarget.planDetails}</div>
                        </div>

                        <div style={{ marginTop: '20px' }}>
                            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '700', color: '#1E293B', marginBottom: '8px' }}>
                                <FiMessageSquare /> Rejection Remarks (Required)
                            </label>
                            <textarea
                                placeholder="Provide your reason for rejection so the employee can resubmit appropriately..."
                                value={rejectRemarks}
                                onChange={e => setRejectRemarks(e.target.value)}
                                rows={4}
                                autoFocus
                                style={{
                                    width: '100%', padding: '12px', border: '1px solid #CBD5E1',
                                    borderRadius: '8px', fontSize: '0.875rem', fontFamily: 'inherit',
                                    resize: 'vertical', minHeight: '100px', outline: 'none'
                                }}
                            />
                        </div>
                    </div>

                    <div className="med-modal-footer">
                        <button className="med-modal-footer-close" onClick={() => setRejectTarget(null)}>Cancel</button>
                        <button
                            className="med-detail-btn"
                            style={{ background: '#DC2626', color: 'white', borderColor: '#DC2626', padding: '8px 20px', borderRadius: '8px' }}
                            onClick={handleReject}
                            disabled={rejecting || !rejectRemarks.trim()}
                        >
                            <FiXCircle /> {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    /* ════════════════════════════════════════════════════
       MONTHLY REVIEW MODAL
    ════════════════════════════════════════════════════ */
    const renderDetailModal = () => {
        if (!selectedMonthDetail) return null;
        const plan       = selectedMonthDetail;
        const ev         = plan.evaluation;
        const isEval     = plan.isEval;
        const ach        = plan.achievement;
        const isRejected = plan.status === 'REJECTED';
        const canReject  = !isEval && !isRejected; // MD can reject if not evaluated and not already rejected

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
        const stLabel = isRejected ? 'Rejected' : isEval ? 'Evaluated' : plan.hasAchievement ? 'Achievement added' : 'Plan submitted';
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
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {canReject && (
                                <button
                                    style={{
                                        color: '#DC2626', borderColor: '#FECACA', background: '#FEF2F2',
                                        padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
                                        fontWeight: '600', display: 'flex', alignItems: 'center',
                                        gap: '6px', cursor: 'pointer', border: '1px solid #FECACA'
                                    }}
                                    className="dmod-btn-hover"
                                    onClick={() => { setSelectedMonthDetail(null); setRejectTarget(plan); setRejectRemarks(''); }}
                                >
                                    <FiXCircle /> Reject Plan
                                </button>
                            )}
                            <button className="dmod-close" onClick={() => setSelectedMonthDetail(null)}>
                                <FiX size={16} />
                            </button>
                        </div>
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
                            <span className={`dmod-slbl dmod-slbl--${stepperAch}`}>Achievement</span>
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
                                <FiAlertCircle /> This plan has been rejected by MD
                            </div>
                        )}
                        {isEval && (
                            <div className="med-status-banner" style={{ background: '#F0FDF4', color: '#16A34A', borderBottomColor: '#BBF7D0', marginBottom: 16 }}>
                                <FiCheckCircle /> Evaluated by RA — cannot be rejected
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
                                            Achievement submitted {formatDateShort(ach.submittedAt)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Plans & Achievements section */}
                        <div>
                            <div className="dmod-sec-lbl">
                                <FiFileText size={13} />
                                {ach && ach.status !== 'DRAFT' ? 'Plans & achievements' : 'Plan details'}
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
                                                            <FiTrendingUp size={11} /> Achievement details
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
                                    <div className="dmod-ach-lbl"><FiTrendingUp size={11} /> Achievement</div>
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
                                    <div className="dmod-extras-title"><FiStar size={13} /> Additional achievements</div>
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

                        {/* MD rejection remarks */}
                        {isRejected && plan.mdRemarks && (
                            <div className="red-modal-section red-modal-section--danger" style={{ marginTop: 12 }}>
                                <div className="red-modal-section-hd">
                                    <div className="red-modal-section-icon red-modal-section-icon--danger"><FiAlertCircle /></div>
                                    <span>MD Rejection Remarks</span>
                                </div>
                                <div className="red-modal-section-body">
                                    <p className="red-modal-text red-modal-text--danger">{plan.mdRemarks}</p>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* ── FOOTER ── */}
                    <div className="dmod-footer">
                        <span className="dmod-ftr-state">
                            {isEval ? 'Evaluated' : plan.hasAchievement ? 'Awaiting RA review' : 'Achievement pending'}
                        </span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {canReject && (
                                <button
                                    onClick={() => { setSelectedMonthDetail(null); setRejectTarget(plan); setRejectRemarks(''); }}
                                    style={{
                                        color: '#DC2626', background: 'transparent',
                                        padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
                                        fontWeight: '600', display: 'flex', alignItems: 'center', cursor: 'pointer', border: 'none'
                                    }}
                                >
                                    Reject
                                </button>
                            )}
                            <button className="dmod-btn-close" onClick={() => setSelectedMonthDetail(null)}>Close</button>
                        </div>
                    </div>

                </div>
            </div>,
            document.body
        );
    };

    /* ════════════════════════ RENDER ════════════════════════ */
    return (
        <div className="fade-in med-page">
            {renderDetailModal()}
            {renderRejectModal()}

            <button className="med-back-btn" onClick={() => navigate('/md/employees')}>
                <FiArrowLeft /> Back to Directory
            </button>

            <div className="med-profile-header">
                <div className="med-profile-left">
                    <div className="med-avatar">{getInitials(employee.name)}</div>
                    <div className="med-profile-info">
                        <h1 className="med-profile-name">{employee.name}</h1>
                        <div className="med-profile-meta">
                            <span><FiBriefcase /> {employee.department || 'No dept'}</span>
                            <span>#{employee.employeeCode}</span>
                            <span className="med-role-tag">{employee.role}</span>
                            {employee.reportingAuthorityId && <span><FiUser /> RA: {employee.reportingAuthorityId.name}</span>}
                        </div>
                        <div className="med-header-ctx">
                            <span className={`med-header-status med-header-status--${headerStatus.cls}`}>
                                <FiZap /> {headerStatus.label}
                            </span>
                            {lastEval && (
                                <span className="med-header-meta-item">
                                    <FiClock /> Last eval: {formatMonth(lastEval.month)}
                                </span>
                            )}
                            {filteredMonths.length > 0 && (
                                <span className="med-header-meta-item">
                                    <FiCheckCircle /> {completionRate}% completion ({filterYear})
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="med-header-stats">
                    <div className="med-header-stat">
                        <div className="med-header-stat-value">{unifiedMonths.length}</div>
                        <div className="med-header-stat-label">Monthly Plans</div>
                    </div>
                    <div className="med-header-stat-divider" />
                    <div className="med-header-stat">
                        <div className="med-header-stat-value"
                            style={{ color: avgScore !== '—' ? getScoreColor(parseFloat(avgScore)) : 'var(--text-muted)' }}>
                            {avgScore}
                        </div>
                        <div className="med-header-stat-label">Avg Score</div>
                    </div>
                    <div className="med-header-stat-divider" />
                    <div className="med-header-stat">
                        <div className="med-header-stat-value">{quarterlyEvaluations.length}</div>
                        <div className="med-header-stat-label">Quarterly</div>
                    </div>
                </div>
            </div>

            <div className="med-kpi-row">
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

            <div className="med-tabs-row">
                <div className="med-tab-rail">
                    {tabs.map(t => (
                        <button key={t.key}
                            className={`med-tab ${activeTab === t.key ? 'med-tab--active' : ''}`}
                            onClick={() => setActiveTab(t.key)}
                        >
                            <span className="med-tab-icon">{t.icon}</span>
                            {t.label}
                            {t.count != null && (
                                <span className={`med-tab-count ${activeTab === t.key ? 'med-tab-count--active' : ''}`}>
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="med-year-filter">
                    <FiFilter className="med-year-filter-icon" />
                    <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                        {availableYears.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
                    </select>
                </div>
            </div>

            {/* ════════════ ANALYTICS TAB ════════════ */}
            {activeTab === 'overview' && (
                <div className="med-overview-wrap">
                    {insights.length > 0 && (
                        <div className="med-insights-box">
                            <div className="med-insights-header">
                                <FiZap className="med-insights-icon" />
                                <span>Performance Insights</span>
                                <span className="med-insights-count">{insights.length}</span>
                            </div>
                            <div className="med-insights-list">
                                {insights.map((ins, i) => (
                                    <InsightPill key={i} icon={ins.icon} text={ins.text} variant={ins.variant} />
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="med-charts-grid">
                        <div className="med-chart-card">
                            <div className="med-chart-title"><FiBarChart2 /> Monthly Evaluation Trend</div>
                            <p className="med-chart-sub">Score progression over time — identifies growth and dip patterns</p>
                            {filteredEvals.filter(e => e.status === 'EVALUATED').length === 0 ? (
                                <p className="med-chart-empty">No evaluations yet for FY {filterYear}</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={260}>
                                    <AreaChart
                                        data={[...filteredEvals].filter(e => e.status === 'EVALUATED').reverse()}
                                        margin={{ top: 16, right: 16, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="medAreaGrad" x1="0" y1="0" x2="0" y2="1">
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
                                            stroke="#8B5CF6" strokeWidth={2.5} fill="url(#medAreaGrad)"
                                            dot={{ r: 5, fill: '#8B5CF6', strokeWidth: 2, stroke: '#fff' }}
                                            activeDot={{ r: 7, fill: '#8B5CF6', stroke: '#fff', strokeWidth: 2 }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                        <div className="med-chart-card">
                            <div className="med-chart-title"><FiTarget /> Quarterly Evaluation Scores</div>
                            <p className="med-chart-sub">Quarter-wise average — highlights sustained or volatile performance</p>
                            {filteredQuarterly.length === 0 ? (
                                <p className="med-chart-empty">No quarterly evaluations for FY {filterYear}</p>
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
                        <div className="med-empty-center">
                            <FiCalendar style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No monthly reviews found for FY {filterYear} (Apr {filterYear.split('-')[0]} – Mar {parseInt(filterYear.split('-')[0]) + 1})</p>
                        </div>
                    ) : (
                        <div className="med-table-card">
                            <table className="med-table">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th>Progress</th>
                                        <th>Score</th>
                                        <th>Submitted</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMonths.map(plan => (
                                        <tr key={plan._id} className="med-table-row"
                                            onClick={() => setSelectedMonthDetail(plan)}>
                                            <td>
                                                <div className="med-month-cell">
                                                    <div className="med-month-badge">{shortMonth(plan.month)}</div>
                                                    <div>
                                                        <strong>{formatMonth(plan.month)}</strong>
                                                        <div style={{ marginTop: 4 }}>{getStatusBadge(plan)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="med-stepper-mini">
                                                    <div className="med-step-dot-mini med-step-dot-mini--done" title="Plan" />
                                                    <div className={`med-step-line-mini ${plan.hasAchievement ? 'med-step-line-mini--done' : ''}`} />
                                                    <div className={`med-step-dot-mini ${plan.hasAchievement ? 'med-step-dot-mini--done' : ''}`} title="Achievement" />
                                                    <div className={`med-step-line-mini ${plan.isEval ? 'med-step-line-mini--done' : ''}`} />
                                                    <div className={`med-step-dot-mini ${plan.isEval ? 'med-step-dot-mini--done' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                {plan.isEval ? (
                                                    <span className="med-score-chip"
                                                        style={{ background: `${getScoreColor(plan.evaluation.score)}15`, color: getScoreColor(plan.evaluation.score) }}>
                                                        {plan.evaluation.score}/10
                                                    </span>
                                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                            </td>
                                            <td className="med-date-cell">{new Date(plan.submittedAt).toLocaleDateString()}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <button className="med-detail-btn"
                                                        onClick={e => { e.stopPropagation(); setSelectedMonthDetail(plan); }}>
                                                        <FiEye /> View
                                                    </button>
                                                    {!plan.isEval && plan.status !== 'REJECTED' && (
                                                        <button
                                                            className="med-detail-btn"
                                                            style={{ color: '#DC2626', borderColor: '#FECACA' }}
                                                            onClick={(e) => { e.stopPropagation(); setRejectTarget(plan); setRejectRemarks(''); }}
                                                            title="Reject this plan"
                                                        >
                                                            <FiXCircle /> 
                                                        </button>
                                                    )}
                                                </div>
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
                <div className="med-qtr-list">
                    {filteredQuarterly.length === 0 ? (
                        <div className="med-empty-center">
                            <FiTarget style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No quarterly evaluations found for FY {filterYear}</p>
                        </div>
                    ) : filteredQuarterly.map(qe => (
                        <div key={qe._id} className="med-qtr-card" style={{ '--qclr': getScoreColor(qe.averageScore) }}>
                            <div className="med-qtr-inner">
                                <div className="med-qtr-head">
                                    <span className="med-qtr-label"><FiBarChart2 /> {qe.quarter?.replace('-', ' ')}</span>
                                    <span className="med-qtr-score" style={{ color: getScoreColor(qe.averageScore) }}>
                                        {qe.averageScore?.toFixed(1)}<span>/10</span>
                                    </span>
                                </div>
                                <div className="med-qtr-bar-track">
                                    <div className="med-qtr-bar-fill"
                                        style={{ width: `${(qe.averageScore / 10) * 100}%`, background: getScoreColor(qe.averageScore) }} />
                                </div>
                                {qe.remarks && (
                                    <div className="med-qtr-remarks-block">
                                        <div className="med-qtr-remarks-label">RA Remarks</div>
                                        <div className="med-qtr-remarks-text">{qe.remarks}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ════════════ YEARLY TAB ════════════ */}
            {activeTab === 'yearly' && (
                <div className="med-yearly-list">
                    {filteredYearlyPlans.length === 0 && filteredYearlyReports.length === 0 ? (
                        <div className="med-empty-center">
                            <FiAward style={{ fontSize: '2.5rem', opacity: 0.2 }} />
                            <p>No yearly data found for this period</p>
                        </div>
                    ) : (
                        <>
                            {filteredYearlyPlans.length > 0 && (
                                <div className="med-yearly-section">
                                    <h3 className="med-yearly-section-title"><FiFileText /> Yearly Plans</h3>
                                    {filteredYearlyPlans.map(yp => (
                                        <div key={yp._id} className="med-yearly-card">
                                            <div className="med-yearly-card-header">
                                                <span className="med-yearly-fy">FY {yp.financialYear}</span>
                                                <span className={`med-badge med-badge--${yp.status?.toLowerCase()}`}>{yp.status}</span>
                                            </div>
                                            <div className="med-yearly-content">{yp.planAndObjectives}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {filteredYearlyReports.length > 0 && (
                                <div className="med-yearly-section">
                                    <h3 className="med-yearly-section-title"><FiAward /> Appraisal Reports</h3>
                                    {filteredYearlyReports.map(yr => (
                                        <div key={yr._id} className="med-yearly-card">
                                            <div className="med-yearly-card-header">
                                                <span className="med-yearly-fy">FY {yr.financialYear}</span>
                                                <span className={`med-badge med-badge--${yr.status?.toLowerCase()?.replace(/_/g, '-')}`}>{yr.status?.replace(/_/g, ' ')}</span>
                                            </div>
                                            <div className="med-yearly-content">{yr.workKRA}</div>
                                            {yr.grandTotal != null && (
                                                <div className="med-yearly-total">
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

export default MDEmployeeDetailPage;
