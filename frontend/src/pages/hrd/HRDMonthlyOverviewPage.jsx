import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiFileText, FiTrendingUp, FiCheckCircle, FiX, FiCalendar,
    FiClock, FiSearch, FiFilter, FiChevronLeft, FiChevronRight,
    FiAlertCircle, FiMessageSquare, FiChevronDown, FiArrowUp, FiArrowDown,
    FiStar, FiXCircle, FiShield, FiEye
} from 'react-icons/fi';
import '../md/MDMonthlyOverview.css';
import '../ra/RAEmployeeDetail.css';
/* ─── helpers ─────────────────────────────────────── */
const currentYear  = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
const MONTHS = [
    { v: '01', l: 'January' }, { v: '02', l: 'February' }, { v: '03', l: 'March' },
    { v: '04', l: 'April' },   { v: '05', l: 'May' },      { v: '06', l: 'June' },
    { v: '07', l: 'July' },    { v: '08', l: 'August' },   { v: '09', l: 'September' },
    { v: '10', l: 'October' }, { v: '11', l: 'November' }, { v: '12', l: 'December' },
];

function fmtMonth(m) {
    if (!m) return '—';
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function scoreColor(s) {
    if (s == null) return 'var(--text-muted)';
    if (s >= 8) return '#22C55E';
    if (s >= 6) return '#F97316';
    if (s >= 4) return '#EAB308';
    return '#EF4444';
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

const PAGE_SIZE = 10;

/* ─── component ──────────────────────────────────── */
const HRDMonthlyOverviewPage = () => {
    const [plans,   setPlans]   = useState([]);
    const [loading, setLoading] = useState(true);

    /* filters */
    const [filterYear,   setFilterYear]   = useState(String(currentYear));
    const [filterMonth,  setFilterMonth]  = useState(currentMonth);
    const [filterStatus, setFilterStatus] = useState('');
    const [searchQ,      setSearchQ]      = useState('');
    const [sortOrder,    setSortOrder]    = useState('latest');
    const [page,         setPage]         = useState(1);

    /* detail modal */
    const [selected, setSelected] = useState(null);



    /* ── fetch ── */
    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            // Note: If filterMonth is empty, it will not pass the 'month' parameter
            // meaning the backend will return ALL plans.
            // But if filterMonth is set to eg '03', it passes '2026-03'.
            // Ensure filterMonth has a default value so it restricts to current month.
            const params = {
                year: filterYear,
                month: filterMonth ? `${filterYear}-${filterMonth}` : undefined,
                status: filterStatus || undefined,
                sort: sortOrder,
                page,
                limit: PAGE_SIZE,
                q: searchQ || undefined,
            };
            const res = await api.get('/hrd/monthly-plans', { params });
            const all = Array.isArray(res.data) ? res.data : [];
            setPlans(all);
        } catch {
            toast.error('Failed to load monthly plans');
        } finally {
            setLoading(false);
        }
    }, [filterYear, filterMonth, filterStatus, sortOrder, page, searchQ]);

    useEffect(() => { fetchPlans(); }, [fetchPlans]);
    useEffect(() => { setPage(1); }, [filterYear, filterMonth, filterStatus, sortOrder, searchQ]);

    /* ── derived: sort + search + paginate ── */
    const processed = (() => {
        let list = [...plans];

        if (searchQ.trim()) {
            const q = searchQ.toLowerCase();
            list = list.filter(p =>
                p.employeeId?.name?.toLowerCase().includes(q) ||
                p.employeeId?.employeeCode?.toLowerCase().includes(q)
            );
        }

        if (filterStatus) {
            list = list.filter(p => {
                if (filterStatus === 'EVALUATED') return p.evaluationStatus === 'EVALUATED';
                if (filterStatus === 'REJECTED')  return p.status === 'REJECTED';
                if (filterStatus === 'PENDING')   return p.evaluationStatus !== 'EVALUATED' && p.status !== 'REJECTED';
                return true;
            });
        }

        list.sort((a, b) => {
            const da = new Date(a.submittedAt).getTime();
            const db = new Date(b.submittedAt).getTime();
            return sortOrder === 'latest' ? db - da : da - db;
        });

        return list;
    })();

    const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
    const pageSlice  = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const getStatusInfo = (plan) => {
        if (plan.status === 'REJECTED')            return { label: 'Rejected by MD',        cls: 'rejected' };
        if (plan.evaluationStatus === 'EVALUATED') return { label: 'Evaluated',             cls: 'evaluated' };
        if (plan.hasAchievement)                   return { label: 'Achievement Submitted', cls: 'achievement' };
        if (plan.status === 'APPROVED' || plan.status === 'ACHIEVEMENT_PENDING' || plan.status === 'EVALUATION_PENDING') return { label: 'Plan Approved', cls: 'achievement' };
        return                                            { label: 'Plan Submitted',        cls: 'submitted' };
    };

    const stats = {
        total:       processed.length,
        evaluated:   processed.filter(p => p.evaluationStatus === 'EVALUATED').length,
        achievement: processed.filter(p => p.hasAchievement).length,
        rejected:    processed.filter(p => p.status === 'REJECTED').length,
    };



    /* ══════════════════════════════════════════════════
       DETAIL MODAL
    ══════════════════════════════════════════════════ */
    const renderDetail = () => {
        if (!selected) return null;
        const plan       = selected;
        // In HRD backend, populated plan has achievementDetails, etc directly.
        // Let's mock the "ach" object that getEffectivePlanAch expects:
        // getEffectivePlanAch(ach, length) expects ach.planAchievements or ach.achievementDetails.
        // We can just pass `plan` since it has plan.achievementDetails.
        const ev         = { remarks: plan.evaluationRemarks, score: plan.evaluationScore, evaluatedAt: plan.evaluatedAt };
        const isEval     = plan.evaluationStatus === 'EVALUATED';
        const ach        = plan.hasAchievement ? { 
            status: plan.achievementStatus || 'SUBMITTED', // assuming not DRAFT if hasAchievement
            achievementDetails: plan.achievementDetails, 
            planAchievements: plan.planAchievements, // if any
            additionalAchievement: plan.additionalAchievement, // if any
            submittedAt: plan.achievementDate
        } : null;
        const isRejected = plan.status === 'REJECTED';
        const chipStyle  = getMonthChipStyle(plan.month);
        const planItemsList = getPlanItems(plan);

        // Derive achievement data
        const effectivePlanAch = getEffectivePlanAch(ach, planItemsList.length);
        const hasStructuredAch = !!effectivePlanAch;

        // Additional achievements
        let additionalItems = parseAdditionalAch(plan.additionalAchievement || '');
        if (additionalItems.length === 0 && plan.achievementDetails) {
            const addlMatch = plan.achievementDetails.match(/Additional:\s*([\s\S]+)/i);
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

        return (
            <div className="mp-overlay" onClick={() => setSelected(null)}>
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
                        <button className="dmod-close" onClick={() => setSelected(null)}>
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
                                    Achievement not submitted yet.
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
                        <button className="dmod-btn-close" onClick={() => setSelected(null)}>Close</button>
                    </div>

                </div>
            </div>
        );
    };

    /* ══════════════════════════════════════════════════
       RENDER
    ══════════════════════════════════════════════════ */
    return (
        <div className="fade-in">
            <div className="page-header" style={{ marginBottom: '16px' }}>
                <div>
                    <h1>Monthly Plan Overview</h1>
                    <p>Review all employee monthly plans, achievements, and RA evaluation scores.</p>
                </div>
            </div>

            {/* Stats row - Using MD KPI Tiles */}
            <div className="md-kpi-grid">
                <div className="md-kpi-tile blue">
                    <div className="md-kpi-label"><FiFileText /> Total Submissions</div>
                    <div className="md-kpi-value">{stats.total}</div>
                </div>
                <div className="md-kpi-tile green">
                    <div className="md-kpi-label"><FiTrendingUp /> Has Achievements</div>
                    <div className="md-kpi-value">{stats.achievement}</div>
                </div>
                <div className="md-kpi-tile purple">
                    <div className="md-kpi-label"><FiCheckCircle /> Evaluated</div>
                    <div className="md-kpi-value">{stats.evaluated}</div>
                </div>
                <div className="md-kpi-tile red">
                    <div className="md-kpi-label"><FiAlertCircle /> Rejected</div>
                    <div className="md-kpi-value">{stats.rejected}</div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="mmo-filter-bar">
                <div className="mmo-search-wrap">
                    <FiSearch className="mmo-search-icon" />
                    <input
                        type="text"
                        className="mmo-search-input"
                        placeholder="Search employee name or code..."
                        value={searchQ}
                        onChange={e => setSearchQ(e.target.value)}
                    />
                    {searchQ && <button className="mmo-search-clear" onClick={() => setSearchQ('')}><FiX /></button>}
                </div>

                <div className="mmo-filter-controls">
                    <div className="mmo-filter-group">
                        <FiCalendar />
                        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiFilter />
                        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                            <option value="">All Months</option>
                            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiChevronDown />
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                            <option value="">All Status</option>
                            <option value="PENDING">Pending Evaluation</option>
                            <option value="EVALUATED">Evaluated</option>
                            <option value="REJECTED">Rejected</option>
                        </select>
                    </div>

                    <button
                        className={`mmo-sort-btn ${sortOrder === 'latest' ? 'active' : ''}`}
                        onClick={() => setSortOrder(s => s === 'latest' ? 'oldest' : 'latest')}
                        title={sortOrder === 'latest' ? 'Showing: Latest first' : 'Showing: Oldest first'}
                    >
                        {sortOrder === 'latest' ? <><FiArrowDown /> Latest</> : <><FiArrowUp /> Oldest</>}
                    </button>
                </div>
            </div>

            {/* Result meta */}
            <div className="mmo-result-meta">
                {loading ? 'Loading...' : `${processed.length} plans found`}
                {(filterMonth || filterStatus || searchQ) && (
                    <button className="mmo-clear-filters" onClick={() => { setFilterMonth(currentMonth); setFilterStatus(''); setSearchQ(''); setSortOrder('latest'); }}>
                        <FiX /> Clear filters
                    </button>
                )}
                <span className="mmo-reject-hint"><FiAlertCircle /> Click a row to securely view comprehensive tracking details.</span>
            </div>

            {/* Table */}
            {loading ? (
                <div className="mmo-loading">
                    <div className="spinner" />
                    <p>Loading monthly plans...</p>
                </div>
            ) : pageSlice.length === 0 ? (
                <div className="mmo-empty">
                    <div className="mmo-empty-icon"><FiFileText /></div>
                    <h3>No plans found</h3>
                    <p>Try adjusting your filters</p>
                </div>
            ) : (
                <>
                    <div className="mmo-table-card">
                        <table className="mmo-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Employee</th>
                                    <th>Month</th>
                                    <th>Plan Preview</th>
                                    <th>Progress</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                    <th>Submitted</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageSlice.map((plan, idx) => {
                                    const st = getStatusInfo(plan);
                                    const isEval     = plan.evaluationStatus === 'EVALUATED';
                                    const isRejected = plan.status === 'REJECTED';
                                    return (
                                        <tr key={plan._id} className={`mmo-row ${isRejected ? 'mmo-row-rejected' : ''}`} onClick={() => setSelected(plan)}>
                                            <td className="mmo-cell-num">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                                            <td>
                                                <div className="mmo-emp-cell">
                                                    <div className="mmo-avatar">{getInitials(plan.employeeId?.name)}</div>
                                                    <div>
                                                        <div className="mmo-emp-name">{plan.employeeId?.name || '—'}</div>
                                                        <div className="mmo-emp-code">{plan.employeeId?.employeeCode}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="mmo-cell-month">{plan.month}</td>
                                            <td>
                                                <div className="mmo-plan-preview">{plan.planDetails}</div>
                                            </td>
                                            <td>
                                                <div className="mmo-progress">
                                                    <div className="mmo-pdot done" title="Plan submitted" />
                                                    <div className={`mmo-pline ${plan.hasAchievement ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${plan.hasAchievement ? 'done' : ''}`} title="Achievement" />
                                                    <div className={`mmo-pline ${isEval ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${isEval ? 'done evaluated' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`mmo-status-badge ${st.cls}`}>{st.label}</span>
                                            </td>
                                            <td>
                                                {isEval && plan.evaluationScore != null ? (
                                                    <span className="mmo-score" style={{ color: scoreColor(plan.evaluationScore) }}>
                                                        <FiStar style={{ fontSize: '0.625rem' }} /> {plan.evaluationScore}/10
                                                    </span>
                                                ) : <span className="mmo-no-score">—</span>}
                                            </td>
                                            <td className="mmo-cell-date">{fmtDate(plan.submittedAt)}</td>
                                            <td>
                                                <button 
                                                    className="mmo-page-btn" 
                                                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                                    onClick={(e) => { e.stopPropagation(); setSelected(plan); }}
                                                >
                                                    <FiEye /> View
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="mmo-pagination">
                            <button className="mmo-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                <FiChevronLeft /> Prev
                            </button>
                            <div className="mmo-page-numbers">
                                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
                                    <button
                                        key={p}
                                        className={`mmo-page-num ${p === page ? 'active' : ''}`}
                                        onClick={() => setPage(p)}
                                    >{p}</button>
                                ))}
                            </div>
                            <button className="mmo-page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                Next <FiChevronRight />
                            </button>
                        </div>
                    )}
                </>
            )}

            {renderDetail()}
        </div>
    );
};

export default HRDMonthlyOverviewPage;
