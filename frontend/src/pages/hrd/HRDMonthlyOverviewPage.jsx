import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiFileText, FiTrendingUp, FiCheckCircle, FiX, FiCalendar,
    FiClock, FiSearch, FiFilter, FiChevronLeft, FiChevronRight,
    FiAlertCircle, FiMessageSquare, FiChevronDown, FiArrowUp, FiArrowDown,
    FiStar, FiEye
} from 'react-icons/fi';
import '../md/MDMonthlyOverview.css';
import '../ra/RAEmployeeDetail.css';
import './HRDMonthlyOverview.css';
import './HRDPlanModal.css';

/* ─── constants & helpers ─────────────────────────── */
const currentYear  = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
const MONTHS = [
    { v: '01', l: 'January' }, { v: '02', l: 'February' }, { v: '03', l: 'March' },
    { v: '04', l: 'April' },   { v: '05', l: 'May' },      { v: '06', l: 'June' },
    { v: '07', l: 'July' },    { v: '08', l: 'August' },   { v: '09', l: 'September' },
    { v: '10', l: 'October' }, { v: '11', l: 'November' }, { v: '12', l: 'December' },
];

const PAGE_SIZE = 10;

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

/* Builds the visible page-number window (e.g. 1 … 4 5 6 … 12) so that every
   page stays reachable regardless of how many pages exist. */
function getPageWindow(current, total, span = 1) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total]);
    for (let p = current - span; p <= current + span; p++) {
        if (p > 1 && p < total) pages.add(p);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    const out = [];
    sorted.forEach((p, i) => {
        if (i > 0 && p - sorted[i - 1] > 1) out.push('gap-' + p);
        out.push(p);
    });
    return out;
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

const CheckIcon = () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const getStatusInfo = (plan) => {
    if (plan.status === 'REJECTED')            return { label: 'Rejected by RA',     cls: 'rejected' };
    if (plan.evaluationStatus === 'EVALUATED') return { label: 'Evaluated',          cls: 'evaluated' };
    if (plan.hasAchievement)                   return { label: 'Progress Submitted', cls: 'achievement' };
    if (['APPROVED', 'ACHIEVEMENT_PENDING', 'EVALUATION_PENDING'].includes(plan.status))
                                               return { label: 'Plan Approved',      cls: 'achievement' };
    return                                            { label: 'Plan Submitted',     cls: 'submitted' };
};

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

    /* close the detail modal on Escape */
    useEffect(() => {
        if (!selected) return;
        const onKeyDown = e => { if (e.key === 'Escape') setSelected(null); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selected]);

    /* ── fetch ──
       Only year / month / status are understood by the API. Search, sort and
       pagination are applied client-side below, so they must NOT trigger a
       refetch (previously every keystroke and page click hit the server). */
    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                year: filterYear,
                month: filterMonth ? `${filterYear}-${filterMonth}` : undefined,
                status: filterStatus || undefined,
            };
            const res = await api.get('/hrd/monthly-plans', { params });
            setPlans(Array.isArray(res.data) ? res.data : []);
        } catch {
            toast.error('Failed to load monthly plans');
        } finally {
            setLoading(false);
        }
    }, [filterYear, filterMonth, filterStatus]);

    useEffect(() => { fetchPlans(); }, [fetchPlans]);
    useEffect(() => { setPage(1); }, [filterYear, filterMonth, filterStatus, sortOrder, searchQ]);

    /* ── derived: search + status + sort ── */
    const processed = useMemo(() => {
        let list = [...plans];

        const q = searchQ.trim().toLowerCase();
        if (q) {
            list = list.filter(p =>
                p.employee?.name?.toLowerCase().includes(q) ||
                p.employee?.employeeCode?.toLowerCase().includes(q)
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
    }, [plans, searchQ, filterStatus, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
    const pageSlice  = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const stats = useMemo(() => ({
        total:       processed.length,
        evaluated:   processed.filter(p => p.evaluationStatus === 'EVALUATED').length,
        achievement: processed.filter(p => p.hasAchievement).length,
        rejected:    processed.filter(p => p.status === 'REJECTED').length,
    }), [processed]);

    const isFiltered =
        filterYear !== String(currentYear) || filterMonth !== currentMonth ||
        !!filterStatus || !!searchQ.trim() || sortOrder !== 'latest';

    const resetFilters = () => {
        setFilterYear(String(currentYear));
        setFilterMonth(currentMonth);
        setFilterStatus('');
        setSearchQ('');
        setSortOrder('latest');
    };

    /* ══════════════════════════════════════════════════
       DETAIL MODAL
    ══════════════════════════════════════════════════ */
    const renderDetail = () => {
        if (!selected) return null;
        const plan       = selected;
        const isEval     = plan.evaluationStatus === 'EVALUATED';
        const isRejected = plan.status === 'REJECTED';
        const ev         = { remarks: plan.evaluationRemarks, score: plan.evaluationScore, evaluatedAt: plan.evaluatedAt };

        // The list endpoint flattens the achievement onto the plan row; rebuild
        // the shape the helpers expect.
        const ach = plan.hasAchievement ? {
            status: plan.achievementStatus || 'SUBMITTED',
            achievementDetails: plan.achievementDetails,
            planAchievements: plan.planAchievements,
            submittedAt: plan.achievementDate,
        } : null;
        const progressSubmitted = !!ach && ach.status !== 'DRAFT';

        const chipStyle     = getMonthChipStyle(plan.month);
        const planItemsList = getPlanItems(plan);
        const planCount     = planItemsList.length;

        const effectivePlanAch = getEffectivePlanAch(ach, planCount);
        const hasStructuredAch = !!effectivePlanAch;
        const additionalItems  = getAdditionalItems(plan.additionalAchievement, plan.achievementDetails);

        // Stepper
        const stepperAch  = plan.hasAchievement ? 'done' : 'active';
        const stepperEval = isEval ? 'done' : plan.hasAchievement ? 'active' : 'idle';
        const line1 = plan.hasAchievement ? 'filled' : 'empty';
        const line2 = isEval ? 'filled' : 'empty';

        // Status pill
        const stLabel = isRejected ? 'Rejected' : isEval ? 'Evaluated' : plan.hasAchievement ? 'Progress added' : 'Plan submitted';
        const stCls   = isRejected ? 'sp-rejected' : isEval ? 'sp-eval' : plan.hasAchievement ? 'sp-ach' : 'sp-plan';

        const close = () => setSelected(null);

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
                                    <span>Submitted {fmtDate(plan.submittedAt)}</span>
                                    <span className="dmod-meta-sep" />
                                    <span>{planCount} plan{planCount !== 1 ? 's' : ''}</span>
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
                            <div className="dmod-snum dmod-snum--done"><CheckIcon /></div>
                            <span className="dmod-slbl dmod-slbl--done">Plan</span>
                        </div>
                        <div className={`dmod-sline dmod-sline--${line1}`} />
                        <div className="dmod-step">
                            <div className={`dmod-snum dmod-snum--${stepperAch}`}>
                                {stepperAch === 'done' ? <CheckIcon /> : <FiTrendingUp size={12} />}
                            </div>
                            <span className={`dmod-slbl dmod-slbl--${stepperAch}`}>Progress</span>
                        </div>
                        <div className={`dmod-sline dmod-sline--${line2}`} />
                        <div className="dmod-step">
                            <div className={`dmod-snum dmod-snum--${stepperEval}`}>
                                {stepperEval === 'done' ? <CheckIcon /> : <FiCheckCircle size={12} />}
                            </div>
                            <span className={`dmod-slbl dmod-slbl--${stepperEval}`}>Evaluated</span>
                        </div>
                    </div>

                    {/* ── BODY ── */}
                    <div className="dmod-body">

                        {/* RA rejection banner */}
                        {isRejected && (
                            <div className="red-status-banner red-status-banner--rejected hpm-banner">
                                <FiAlertCircle /> This plan was rejected by the Reporting Authority (RA)
                                {plan.raRemarks && (
                                    <span className="hpm-banner-reason">
                                        Reason: &ldquo;{plan.raRemarks}&rdquo;
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Submission timeline (dates only — no progress metrics) */}
                        {progressSubmitted && (
                            <div className="hpm-timeline">
                                <span className="hpm-timeline-item">
                                    <FiFileText size={12} /> Plan submitted {fmtDate(plan.submittedAt)}
                                </span>
                                {ach.submittedAt && (
                                    <span className="hpm-timeline-item">
                                        <FiTrendingUp size={12} /> Progress submitted {fmtDate(ach.submittedAt)}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Plans & progress */}
                        <div>
                            <div className="dmod-sec-lbl">
                                <FiFileText size={13} />
                                {progressSubmitted ? 'Plans & Progress' : 'Plan details'}
                                <span className="dmod-sec-count-pill">{planCount} plan{planCount !== 1 ? 's' : ''}</span>
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

                            {/* Case C — progress submitted, unstructured legacy text only */}
                            {progressSubmitted && !hasStructuredAch && ach.achievementDetails && (
                                <div className="dmod-legacy-ach">
                                    <div className="dmod-ach-lbl"><FiTrendingUp size={11} /> Progress details</div>
                                    <div className="dmod-ach-text">{stripLegacyMarkup(ach.achievementDetails)}</div>
                                </div>
                            )}
                        </div>

                        {/* Progress not submitted */}
                        {!progressSubmitted && (
                            <div className="dmod-no-ach-block">
                                <div className="dmod-no-ach-icon"><FiTrendingUp size={16} /></div>
                                <div className="dmod-no-ach-text">Progress not submitted yet.</div>
                            </div>
                        )}

                        {/* Additional work */}
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

                        {/* RA evaluation */}
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
                                                <FiClock size={10} /> Evaluated {fmtDate(ev.evaluatedAt)}
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

                        {/* RA rejection remarks */}
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

    /* ══════════════════════════════════════════════════
       RENDER
    ══════════════════════════════════════════════════ */
    return (
        <div className="fade-in">
            <div className="page-header hmo-page-header">
                <div>
                    <h1>Monthly Plan Overview</h1>
                    <p>Review all employee monthly plans, progress, and RA evaluation scores.</p>
                </div>
            </div>

            {/* Stats row — KPI Cards
                Color language matches the status badges below: violet = in
                progress, green = complete, so "Evaluated" (the finished
                state) is green and "Progress submitted" (an interim state)
                is violet. All visual styling lives in CSS
                (.mmo-kpi-card--*); this block only supplies the data. */}
            {(() => {
                const total = stats.total || 1; // avoid div/0
                const achPct  = Math.round((stats.achievement / total) * 100);
                const evalPct = Math.round((stats.evaluated   / total) * 100);
                const rejPct  = Math.round((stats.rejected    / total) * 100);

                const kpiCards = [
                    {
                        key: 'total', accent: 'blue', icon: <FiFileText />,
                        label: 'Total Submissions', value: stats.total, pct: null,
                        sublabel: `For ${MONTHS.find(m => m.v === filterMonth)?.l || 'selected period'} ${filterYear}`,
                    },
                    {
                        key: 'achievement', accent: 'purple', icon: <FiTrendingUp />,
                        label: 'Progress submitted', value: stats.achievement, pct: achPct,
                        sublabel: `${stats.total - stats.achievement} still pending progress`,
                    },
                    {
                        key: 'evaluated', accent: 'green', icon: <FiCheckCircle />,
                        label: 'Evaluated', value: stats.evaluated, pct: evalPct,
                        sublabel: `${stats.total - stats.evaluated} awaiting RA evaluation`,
                    },
                    {
                        key: 'rejected', accent: 'red', icon: <FiAlertCircle />,
                        label: 'Rejected by RA', value: stats.rejected, pct: rejPct,
                        sublabel: stats.rejected === 0 ? 'No rejections this period' : `${stats.rejected} plan${stats.rejected !== 1 ? 's' : ''} need resubmission`,
                    },
                ];

                return (
                    <div className="mmo-kpi-grid">
                        {kpiCards.map(c => (
                            <div key={c.key} className={`mmo-kpi-card mmo-kpi-card--${c.accent}`}>
                                <div className="mmo-kpi-top">
                                    <div className="mmo-kpi-label-wrap">
                                        <span className="mmo-kpi-icon">{c.icon}</span>
                                        <span className="mmo-kpi-label">{c.label}</span>
                                    </div>
                                    {c.pct !== null && <span className="mmo-kpi-pct">{c.pct}%</span>}
                                </div>
                                <div className="mmo-kpi-value">{c.value}</div>
                                {c.pct !== null && (
                                    <div className="mmo-kpi-track">
                                        <div className="mmo-kpi-fill" style={{ width: `${c.pct}%` }} />
                                    </div>
                                )}
                                <div className="mmo-kpi-sub">{c.sublabel}</div>
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* Filter bar */}
            <div className="mmo-filter-bar">
                <div className="mmo-search-wrap">
                    <FiSearch className="mmo-search-icon" />
                    <input
                        type="text"
                        className="mmo-search-input"
                        placeholder="Search employee name or code…"
                        aria-label="Search by employee name or code"
                        value={searchQ}
                        onChange={e => setSearchQ(e.target.value)}
                    />
                    {searchQ && <button className="mmo-search-clear" onClick={() => setSearchQ('')} aria-label="Clear search"><FiX /></button>}
                </div>

                <div className="mmo-filter-controls">
                    <div className="mmo-filter-group">
                        <FiCalendar />
                        <select aria-label="Filter by year" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiFilter />
                        <select aria-label="Filter by month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                            <option value="">All Months</option>
                            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiChevronDown />
                        <select aria-label="Filter by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
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
            <div className="mmo-result-meta" aria-live="polite">
                <span>{loading ? 'Loading…' : `${processed.length} plan${processed.length !== 1 ? 's' : ''} found`}</span>
                {isFiltered && (
                    <button className="mmo-clear-filters" onClick={resetFilters}>
                        <FiX /> Reset filters
                    </button>
                )}
                <span className="mmo-reject-hint"><FiAlertCircle /> Select a row to view full details.</span>
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
                                    <th>Stage</th>
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
                                        <tr
                                            key={plan.id}
                                            className={`mmo-row ${isRejected ? 'mmo-row-rejected' : ''}`}
                                            onClick={() => setSelected(plan)}
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`View plan details for ${plan.employee?.name || 'employee'}, ${st.label}`}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(plan); }
                                            }}
                                        >
                                            <td className="mmo-cell-num">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                                            <td>
                                                <div className="mmo-emp-cell">
                                                    <div className="mmo-avatar">{getInitials(plan.employee?.name)}</div>
                                                    <div>
                                                        <div className="mmo-emp-name">{plan.employee?.name || '—'}</div>
                                                        <div className="mmo-emp-code">{plan.employee?.employeeCode}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="mmo-cell-month">{shortMonth(plan.month)} {plan.month?.split('-')[0]}</td>
                                            <td>
                                                <div className="mmo-plan-preview">{plan.planDetails}</div>
                                            </td>
                                            <td>
                                                <div
                                                    className="mmo-progress"
                                                    role="img"
                                                    aria-label={`Workflow stage: ${isEval ? 'evaluated' : plan.hasAchievement ? 'progress submitted' : 'plan submitted'}`}
                                                >
                                                    <div className="mmo-pdot done" title="Plan submitted" />
                                                    <div className={`mmo-pline ${plan.hasAchievement ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${plan.hasAchievement ? 'done' : ''}`} title="Progress submitted" />
                                                    <div className={`mmo-pline ${isEval ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${isEval ? 'done' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`mmo-status-badge ${st.cls}`}>{st.label}</span>
                                            </td>
                                            <td>
                                                {isEval && plan.evaluationScore != null ? (
                                                    <span className="mmo-score" style={{ color: scoreColor(plan.evaluationScore) }}>
                                                        <FiStar className="mmo-score-icon" /> {plan.evaluationScore}/10
                                                    </span>
                                                ) : <span className="mmo-no-score">—</span>}
                                            </td>
                                            <td className="mmo-cell-date">{fmtDate(plan.submittedAt)}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="mmo-view-btn"
                                                    onClick={(e) => { e.stopPropagation(); setSelected(plan); }}
                                                    aria-label={`View plan details for ${plan.employee?.name || 'employee'}`}
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
                        <nav className="mmo-pagination" aria-label="Pagination">
                            <button className="mmo-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                <FiChevronLeft /> Prev
                            </button>
                            <div className="mmo-page-numbers">
                                {getPageWindow(page, totalPages).map(p => typeof p === 'string' ? (
                                    <span key={p} className="mmo-page-gap" aria-hidden="true">…</span>
                                ) : (
                                    <button
                                        key={p}
                                        className={`mmo-page-num ${p === page ? 'active' : ''}`}
                                        onClick={() => setPage(p)}
                                        aria-label={`Page ${p}`}
                                        aria-current={p === page ? 'page' : undefined}
                                    >{p}</button>
                                ))}
                            </div>
                            <button className="mmo-page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                Next <FiChevronRight />
                            </button>
                        </nav>
                    )}
                </>
            )}

            {renderDetail()}
        </div>
    );
};

export default HRDMonthlyOverviewPage;