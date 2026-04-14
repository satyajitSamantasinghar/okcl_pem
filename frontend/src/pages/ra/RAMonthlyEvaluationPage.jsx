import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './RAMonthlyEvaluation.css';
import {
    FiFilter, FiSearch, FiStar, FiEye, FiX, FiUsers, FiClock,
    FiCheckCircle, FiTrendingUp, FiClipboard, FiMessageSquare,
    FiDownload, FiChevronUp, FiChevronDown, FiChevronLeft,
    FiChevronRight, FiAward, FiCalendar, FiAlertCircle, FiFileText,
} from 'react-icons/fi';

/* ─────────────────────────────────────────
   HELPERS — per spec
───────────────────────────────────────── */
function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.filter(Boolean).length > 0)
        return plan.planItems.filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}

function parseLegacyPlanAch(legacyText, planCount) {
    const result = Array.from({ length: planCount }, () => ({
        achievementDetails: '', progress: 0
    }));
    if (!legacyText) return result;
    const lines = legacyText.split('\n');
    let currentIdx = -1;
    lines.forEach(line => {
        const withPct = line.match(/^Plan\s+(\d+)\s*\[(\d+)%\]:\s*(.*)/i);
        const withoutPct = !withPct && line.match(/^Plan\s+(\d+):\s*(.*)/i);
        if (withPct) {
            const idx = parseInt(withPct[1]) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].progress = Math.min(100, parseInt(withPct[2]) || 0);
                result[idx].achievementDetails = withPct[3].trim();
            }
        } else if (withoutPct) {
            const idx = parseInt(withoutPct[1]) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].achievementDetails = withoutPct[2].trim();
            }
        } else if (currentIdx >= 0 && line.trim() && !line.match(/^Additional:/i)) {
            result[currentIdx].achievementDetails +=
                (result[currentIdx].achievementDetails ? ' ' : '') + line.trim();
        }
    });
    return result;
}

function getEffectivePlanAch(ach, planCount) {
    if (!ach) return null;
    const pa = ach.planAchievements;
    if (Array.isArray(pa) && pa.length > 0) {
        const hasRealData = pa.some(
            a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0
        );
        if (hasRealData) return pa;
    }
    if (ach.achievementDetails) {
        const parsed = parseLegacyPlanAch(ach.achievementDetails, planCount);
        const hasParsedData = parsed.some(
            a => (a.achievementDetails || '').trim() || (a.progress || 0) > 0
        );
        if (hasParsedData) return parsed;
    }
    return null;
}

function getProgressTokens(progress) {
    const p = Math.min(100, Math.max(0, progress || 0));
    if (p === 100) return { label: 'Completed', color: '#3B6D11', bg: '#EAF3DE', text: '#27500A', border: '#3B6D11' };
    if (p >= 75)  return { label: 'Almost done', color: '#BA7517', bg: '#FAEEDA', text: '#633806', border: '#BA7517' };
    if (p >= 50)  return { label: 'Halfway', color: '#E85523', bg: '#FFF0EB', text: '#993C1D', border: '#E85523' };
    if (p >= 25)  return { label: 'Just started', color: '#BA7517', bg: '#FAEEDA', text: '#633806', border: '#BA7517' };
    return         { label: 'Not started', color: '#A32D2D', bg: '#FCEBEB', text: '#791F1F', border: '#A32D2D' };
}

function parseAdditionalAch(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(a => (a.text || '').trim());
    } catch { /* fall through */ }
    // Try legacy "Additional: ..." capture
    const match = raw.match(/Additional:\s*([\s\S]+)/i);
    if (match) {
        try {
            const p = JSON.parse(match[1].trim());
            if (Array.isArray(p)) return p.filter(a => (a.text || '').trim());
        } catch { /* fall through */ }
        return [{ text: match[1].trim(), progress: 100 }];
    }
    return raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('Additional:'))
        .map(t => ({ text: t.trim(), progress: 100 }));
}

/* ─────────────────────────────────────────
   OTHER HELPERS (existing)
───────────────────────────────────────── */
const getInitials = (name = '') =>
    name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

const getScoreColor = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 8) return 'score-high';
    if (score >= 5) return 'score-mid';
    return 'score-low';
};

const getScoreLabel = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 9) return 'Excellent Performance';
    if (score >= 7) return 'Good Performance';
    if (score >= 4) return 'Meets Expectations';
    return 'Needs Improvement';
};

const getScoreBtnStyle = (score) => {
    if (score >= 9) return { bg: '#3B6D11', hover: '#2d5209' };
    if (score >= 7) return { bg: 'var(--primary)', hover: '#e06410' };
    if (score >= 4) return { bg: '#BA7517', hover: '#9d6313' };
    return { bg: '#A32D2D', hover: '#8a2525' };
};

const formatMonthLabel = (monthStr) => {
    if (!monthStr) return '-';
    const [year, month] = monthStr.split('-');
    return new Date(Number(year), Number(month) - 1).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
    });
};

const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ─────────────────────────────────────────
   CIRCULAR PROGRESS RING
───────────────────────────────────────── */
function CircularProgress({ progress, size = 44 }) {
    const p = Math.min(100, Math.max(0, progress || 0));
    const r = (size - 6) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (p / 100) * circ;
    const tk = getProgressTokens(p);
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-default)" strokeWidth={4} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={tk.color} strokeWidth={4}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.35s ease' }} />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle"
                style={{
                    transform: `rotate(90deg)`,
                    transformOrigin: `${size / 2}px ${size / 2}px`,
                    fontSize: 9, fontWeight: 700,
                    fill: 'var(--text-primary)', fontFamily: 'inherit'
                }}>
                {p}%
            </text>
        </svg>
    );
}

/* ─────────────────────────────────────────
   SUMMARY CARD
───────────────────────────────────────── */
const SummaryCard = ({ icon, value, label, subtitle, color }) => (
    <div className={`meval-kpi-card meval-kpi-card--${color}`}>
        <div className="meval-kpi-top">
            <div className={`meval-kpi-icon meval-kpi-icon--${color}`}>{icon}</div>
            <strong className="meval-kpi-value">{value}</strong>
        </div>
        <div className="meval-kpi-bottom">
            <span className="meval-kpi-label">{label}</span>
            {subtitle && <span className="meval-kpi-sub">{subtitle}</span>}
        </div>
    </div>
);

/* ─────────────────────────────────────────
   STATUS BADGE
───────────────────────────────────────── */
const StatusBadge = ({ status }) => {
    const isEvaluated = status === 'EVALUATED';
    return (
        <span className={`meval-badge ${isEvaluated ? 'meval-badge--evaluated' : 'meval-badge--pending'}`}>
            {isEvaluated ? <FiCheckCircle size={10} /> : <FiClock size={10} />}
            {isEvaluated ? 'Evaluated' : 'Pending'}
        </span>
    );
};

/* ─────────────────────────────────────────
   SCORE BAR (table)
───────────────────────────────────────── */
const ScoreBar = ({ score }) => {
    if (score === null || score === undefined || score === 0 && !score)
        return <span className="meval-score-dash">—</span>;
    if (score === 0) return <span className="meval-score-dash">—</span>;
    const cls = getScoreColor(score);
    return (
        <div className="meval-score-wrap">
            <span className={`meval-score-num ${cls}`}>
                {score}<span className="meval-score-denom">/10</span>
            </span>
            <div className="meval-score-bar-track">
                <div className={`meval-score-bar-fill ${cls}`} style={{ width: `${(score / 10) * 100}%` }} />
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   PLAN CONTEXT PANEL (shared between Detail & Evaluate modals)
───────────────────────────────────────── */
const PlanContextPanel = ({ plan, achievement, className = '' }) => {
    const planItems = getPlanItems(plan);
    const effectivePlanAch = getEffectivePlanAch(achievement, planItems.length);
    const additionalItems = parseAdditionalAch(achievement?.additionalAchievement || '');

    const hasAch = !!achievement && achievement.status !== 'DRAFT';

    const overallProg = effectivePlanAch
        ? Math.round(effectivePlanAch.reduce((s, a) => s + Math.min(100, a.progress || 0), 0) / effectivePlanAch.length)
        : null;
    const completed = effectivePlanAch
        ? effectivePlanAch.filter(a => (a.progress || 0) >= 100).length
        : 0;

    return (
        <div className={`meval-ctx ${className}`}>
            {/* Overall progress strip */}
            {hasAch && overallProg !== null && (
                <div className="meval-ctx-overall">
                    <div className="meval-ctx-overall-row">
                        <span className="meval-ctx-overall-lbl">Overall Achievement</span>
                        <span className="meval-ctx-overall-val">
                            {completed}/{planItems.length} plans &middot; {overallProg}%
                        </span>
                    </div>
                    <div className="meval-ctx-prog-track">
                        <div className="meval-ctx-prog-fill" style={{ width: `${overallProg}%` }} />
                    </div>
                    <div className="meval-ctx-ts-row">
                        {plan?.submittedAt && (
                            <span className="meval-ctx-ts"><FiFileText size={9} /> Plan {formatDate(plan.submittedAt)}</span>
                        )}
                        {achievement?.submittedAt && (
                            <span className="meval-ctx-ts"><FiTrendingUp size={9} /> Achievement {formatDate(achievement.submittedAt)}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Section label */}
            <div className="meval-ctx-sec-lbl">
                <FiFileText size={12} />
                {hasAch ? 'Plans & Achievements' : 'Plan Details'}
                <span className="meval-ctx-sec-count">{planItems.length} plan{planItems.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Plans */}
            <div className="meval-ctx-plan-list">
                {planItems.map((planText, i) => {
                    const pa = effectivePlanAch?.[i] || { achievementDetails: '', progress: 0 };
                    const p = Math.min(100, pa.progress || 0);
                    const tk = getProgressTokens(p);

                    if (!hasAch || !effectivePlanAch) {
                        return (
                            <div key={i} className="meval-ctx-plan-card meval-ctx-plan-card--idle">
                                <div className="meval-ctx-plan-top">
                                    <span className="meval-ctx-plan-idx">{i + 1}</span>
                                    <div className="meval-ctx-plan-info">
                                        <div className="meval-ctx-plan-name-row">
                                            <span className="meval-ctx-plan-name">Plan {i + 1}</span>
                                            <span className="meval-ctx-plan-badge meval-ctx-plan-badge--idle">Pending</span>
                                        </div>
                                        <p className="meval-ctx-plan-text">{planText}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    const statusLabel = p === 100 ? 'Completed' : p > 0 ? 'In Progress' : 'Not Started';
                    const statusCls = p === 100 ? 'done' : p > 0 ? 'partial' : 'none';

                    return (
                        <div key={i} className="meval-ctx-plan-card" style={{ borderLeftColor: tk.border }}>
                            <div className="meval-ctx-plan-top">
                                <CircularProgress progress={p} size={42} />
                                <div className="meval-ctx-plan-info">
                                    <div className="meval-ctx-plan-name-row">
                                        <span className="meval-ctx-plan-idx">{i + 1}</span>
                                        <span className="meval-ctx-plan-name">Plan {i + 1}</span>
                                        <span className={`meval-ctx-plan-badge meval-ctx-plan-badge--${statusCls}`}>{statusLabel}</span>
                                    </div>
                                    <p className="meval-ctx-plan-text">{planText}</p>
                                </div>
                            </div>
                            <div className="meval-ctx-prog-section">
                                <div className="meval-ctx-prog-labels">
                                    <span>Progress</span>
                                    <span style={{ color: tk.color, fontWeight: 700 }}>{p}%{p === 100 ? ' — Done' : p > 0 ? ' — In Progress' : ' — Not Started'}</span>
                                </div>
                                <div className="meval-ctx-prog-track">
                                    <div className="meval-ctx-prog-fill" style={{ width: `${p}%`, background: tk.color }} />
                                </div>
                                <div className="meval-ctx-prog-markers">
                                    {[0, 25, 50, 75].map(m => (
                                        <span key={m} style={p >= m && p > 0 ? { color: tk.color, fontWeight: 600 } : {}}>{m}%</span>
                                    ))}
                                    <span style={p === 100 ? { color: tk.color, fontWeight: 600 } : {}}>Done</span>
                                </div>
                            </div>
                            <div className="meval-ctx-ach-section">
                                <div className="meval-ctx-ach-lbl"><FiTrendingUp size={10} /> Achievement Details</div>
                                {pa.achievementDetails
                                    ? <div className="meval-ctx-ach-text">{pa.achievementDetails}</div>
                                    : <div className="meval-ctx-ach-empty">No details provided</div>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Additional achievements */}
            {additionalItems.length > 0 && (
                <div className="meval-ctx-extras">
                    <div className="meval-ctx-sec-lbl" style={{ marginTop: '16px', marginBottom: '12px' }}>
                        <FiStar size={12} />
                        Additional Achievements
                        <span className="meval-ctx-sec-count">{additionalItems.length} extra</span>
                    </div>
                    {additionalItems.map((item, i) => {
                        const text = typeof item === 'string' ? item : (item.text || '');
                        const prog = typeof item === 'string' ? 100 : Math.min(100, item.progress || 100);
                        const tk = getProgressTokens(prog);
                        const statusLabel = prog === 100 ? 'Completed' : prog > 0 ? 'In Progress' : 'Not Started';
                        const statusCls = prog === 100 ? 'done' : prog > 0 ? 'partial' : 'none';

                        return (
                            <div key={i} className="meval-ctx-plan-card" style={{ borderLeftColor: tk.border }}>
                                <div className="meval-ctx-plan-top">
                                    <CircularProgress progress={prog} size={42} />
                                    <div className="meval-ctx-plan-info">
                                        <div className="meval-ctx-plan-name-row">
                                            <span className="meval-ctx-plan-idx">{i + 1}</span>
                                            <span className="meval-ctx-plan-name">Extra Achievement {i + 1}</span>
                                            <span className={`meval-ctx-plan-badge meval-ctx-plan-badge--${statusCls}`}>{statusLabel}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="meval-ctx-prog-section">
                                    <div className="meval-ctx-prog-labels">
                                        <span>Progress</span>
                                        <span style={{ color: tk.color, fontWeight: 700 }}>{prog}%{prog === 100 ? ' — Done' : prog > 0 ? ' — In Progress' : ' — Not Started'}</span>
                                    </div>
                                    <div className="meval-ctx-prog-track">
                                        <div className="meval-ctx-prog-fill" style={{ width: `${prog}%`, background: tk.color }} />
                                    </div>
                                    <div className="meval-ctx-prog-markers">
                                        {[0, 25, 50, 75].map(m => (
                                            <span key={m} style={prog >= m && prog > 0 ? { color: tk.color, fontWeight: 600 } : {}}>{m}%</span>
                                        ))}
                                        <span style={prog === 100 ? { color: tk.color, fontWeight: 600 } : {}}>Done</span>
                                    </div>
                                </div>
                                <div className="meval-ctx-ach-section">
                                    <div className="meval-ctx-ach-lbl"><FiStar size={10} color="#BA7517" /> Achievement Details</div>
                                    {text
                                        ? <div className="meval-ctx-ach-text">{text}</div>
                                        : <div className="meval-ctx-ach-empty">No details provided</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* No achievement block */}
            {!hasAch && (
                <div className="meval-ctx-no-ach">
                    <FiTrendingUp size={16} />
                    <span>Achievement not yet submitted</span>
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   DETAIL MODAL (View button)
───────────────────────────────────────── */
const DetailModal = ({ ev, detail, detailLoading, onClose, onEvaluate }) => {
    if (!ev) return null;

    const planItems = detail ? getPlanItems(detail.plan) : [];
    const hasAch = !!detail?.achievement && detail.achievement.status !== 'DRAFT';
    const isEvaluated = detail?.status?.evaluated || ev.status === 'EVALUATED';

    const stepperPlan = 'done';
    const stepperAch = hasAch ? 'done' : 'active';
    const stepperEval = isEvaluated ? 'done' : hasAch ? 'active' : 'idle';

    return createPortal(
        <div className="meval-overlay" onClick={onClose}>
            <div className="meval-vmodal" onClick={e => e.stopPropagation()}>

                {/* Sticky Header */}
                <div className="meval-vmodal-hdr">
                    <div className="meval-vmodal-hdr-left">
                        <div className="meval-modal-avatar">{getInitials(ev.employee?.name || '?')}</div>
                        <div>
                            <h2 className="meval-vmodal-title">{ev.employee?.name || 'Unknown'}</h2>
                            <div className="meval-vmodal-meta">
                                <span>{ev.employee?.employeeCode}</span>
                                <span className="meval-vmodal-sep" />
                                <span>{ev.employee?.department}</span>
                                <span className="meval-vmodal-sep" />
                                <span className="meval-vmodal-month">{formatMonthLabel(ev.month)}</span>
                                <StatusBadge status={ev.status} />
                            </div>
                        </div>
                    </div>
                    <button className="meval-modal-close" onClick={onClose}><FiX /></button>
                </div>

                {/* Stepper */}
                <div className="meval-stepper">
                    <div className="meval-step">
                        <div className={`meval-step-dot meval-step-dot--${stepperPlan}`}>
                            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                        <span className={`meval-step-lbl meval-step-lbl--${stepperPlan}`}>Plan</span>
                    </div>
                    <div className={`meval-step-line meval-step-line--${hasAch ? 'filled' : 'empty'}`} />
                    <div className="meval-step">
                        <div className={`meval-step-dot meval-step-dot--${stepperAch}`}>
                            {stepperAch === 'done'
                                ? <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                                : <FiTrendingUp size={11} />}
                        </div>
                        <span className={`meval-step-lbl meval-step-lbl--${stepperAch}`}>Achievement</span>
                    </div>
                    <div className={`meval-step-line meval-step-line--${isEvaluated ? 'filled' : 'empty'}`} />
                    <div className="meval-step">
                        <div className={`meval-step-dot meval-step-dot--${stepperEval}`}>
                            {stepperEval === 'done'
                                ? <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                                : <FiCheckCircle size={11} />}
                        </div>
                        <span className={`meval-step-lbl meval-step-lbl--${stepperEval}`}>Evaluated</span>
                    </div>
                </div>

                {/* Body */}
                <div className="meval-vmodal-body">
                    {detailLoading ? (
                        <div className="meval-loading">
                            <div className="meval-spinner" />
                            <p>Loading details…</p>
                        </div>
                    ) : detail ? (
                        <>
                            <PlanContextPanel plan={detail.plan} achievement={detail.achievement} />

                            {/* RA Evaluation box */}
                            <div className="meval-ra-box">
                                <div className="meval-ra-icon"><FiMessageSquare size={13} /></div>
                                <div className="meval-ra-info">
                                    <div className="meval-ra-lbl">RA Evaluation</div>
                                    {isEvaluated ? (
                                        <>
                                            {detail.remarks && <div className="meval-ra-done">{detail.remarks}</div>}
                                            {detail.score != null && detail.score !== 0 && (
                                                <div className="meval-ra-score-row">
                                                    Score: <strong>{detail.score}/10</strong>
                                                    <span className={`meval-score-label-chip ${getScoreColor(detail.score)}`}>
                                                        {getScoreLabel(detail.score)}
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="meval-ra-pending">Awaiting evaluation</div>
                                    )}
                                </div>
                                {isEvaluated && detail.score != null && detail.score !== 0 && (
                                    <div className={`meval-score-chip meval-score-chip--${getScoreColor(detail.score)}`}>
                                        {detail.score}/10
                                    </div>
                                )}
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="meval-vmodal-footer">
                    <span className="meval-vmodal-ftr-state">
                        {isEvaluated ? 'Evaluated' : hasAch ? 'Awaiting RA review' : 'Achievement pending'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {!isEvaluated && hasAch && onEvaluate && (
                            <button className="btn btn-primary" onClick={onEvaluate}>
                                <FiStar size={13} /> Evaluate
                            </button>
                        )}
                        <button className="btn btn-secondary" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

/* ─────────────────────────────────────────
   EVALUATE MODAL (Evaluate button)
───────────────────────────────────────── */
const EvaluateModal = ({ item, onClose, onSubmit, submitting }) => {
    const [score, setScore] = useState(null);
    const [remarks, setRemarks] = useState('');
    const [ctxDetail, setCtxDetail] = useState(null);
    const MAX_REMARKS = 500;

    // Load context detail for the evaluate modal
    useEffect(() => {
        if (!item) return;
        api.get(`/ra/monthly-evaluations/${item._id}`)
            .then(res => setCtxDetail(res.data))
            .catch(() => setCtxDetail(null));
    }, [item]);

    const isValid = score >= 1 && score <= 10;

    const handleSubmit = () => {
        if (!isValid) { toast.error('Please select a score between 1 and 10'); return; }
        onSubmit({ score, remarks });
    };

    const btnStyle = score ? getScoreBtnStyle(score) : null;

    return createPortal(
        <div className="meval-overlay" onClick={onClose}>
            <div className="meval-emodal" onClick={e => e.stopPropagation()}>

                {/* Sticky Header */}
                <div className="meval-emodal-hdr">
                    <div className="meval-modal-header-left">
                        <div className="meval-modal-avatar">{getInitials(item?.employee?.name || '?')}</div>
                        <div>
                            <h2 className="meval-modal-title">Submit Evaluation</h2>
                            <p className="meval-modal-subtitle">
                                {item?.employee?.name} &bull; {formatMonthLabel(item?.month)}
                            </p>
                        </div>
                    </div>
                    <button className="meval-modal-close" onClick={onClose}><FiX /></button>
                </div>

                {/* Two-column body */}
                <div className="meval-emodal-body">

                    {/* LEFT: Context panel */}
                    <div className="meval-emodal-ctx-wrap">
                        <div className="meval-emodal-ctx-title">
                            <FiClipboard size={13} /> Plan & Achievement Context
                        </div>
                        {ctxDetail ? (
                            <PlanContextPanel plan={ctxDetail.plan} achievement={ctxDetail.achievement} className="meval-emodal-ctx-inner" />
                        ) : (
                            <div className="meval-loading" style={{ padding: '24px' }}>
                                <div className="meval-spinner" />
                                <p>Loading context…</p>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Scoring form */}
                    <div className="meval-emodal-form">

                        {/* Score display */}
                        <div className="meval-score-display">
                            <span className="meval-score-display-num" style={btnStyle ? { color: btnStyle.bg } : {}}>
                                {score ?? '—'}
                            </span>
                            <span className="meval-score-display-denom">/10</span>
                            {isValid && (
                                <span className="meval-score-display-lbl"
                                    style={{ background: btnStyle.bg + '22', color: btnStyle.bg }}>
                                    {getScoreLabel(score)}
                                </span>
                            )}
                        </div>

                        {/* Score button grid */}
                        <div className="meval-form-group">
                            <label className="meval-form-label">
                                Score <span className="meval-required">*</span>
                            </label>
                            <div className="meval-score-btns">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => {
                                    const s = getScoreBtnStyle(v);
                                    const isSelected = score === v;
                                    return (
                                        <button
                                            key={v}
                                            type="button"
                                            className={`meval-score-btn${isSelected ? ' meval-score-btn--selected' : ''}`}
                                            style={isSelected
                                                ? { background: s.bg, borderColor: s.bg, color: '#fff', transform: 'scale(1.12)', boxShadow: `0 4px 12px ${s.bg}55` }
                                                : {}}
                                            onClick={() => setScore(v)}
                                        >
                                            {v}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Score range labels */}
                            <div className="meval-score-range-labels">
                                <span style={{ color: '#A32D2D' }}>1–3 Needs Improvement</span>
                                <span style={{ color: '#BA7517' }}>4–6 Meets Expectations</span>
                                <span style={{ color: 'var(--primary)' }}>7–8 Good</span>
                                <span style={{ color: '#3B6D11' }}>9–10 Excellent</span>
                            </div>
                        </div>

                        {/* Remarks */}
                        <div className="meval-form-group">
                            <div className="meval-form-label-row">
                                <label className="meval-form-label">
                                    Remarks <span className="meval-optional">(optional)</span>
                                </label>
                                <span className={`meval-char-counter ${remarks.length > MAX_REMARKS * 0.9 ? 'meval-char-counter--warn' : ''}`}>
                                    {remarks.length}/{MAX_REMARKS}
                                </span>
                            </div>
                            <textarea
                                className="meval-textarea"
                                value={remarks}
                                onChange={e => setRemarks(e.target.value.slice(0, MAX_REMARKS))}
                                placeholder="Provide concise feedback on performance, delivery, and ownership…"
                                rows={4}
                            />
                        </div>

                        {/* Submit */}
                        <div className="meval-emodal-form-actions">
                            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
                            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !isValid}>
                                {submitting
                                    ? <><span className="meval-btn-spinner" /> Submitting…</>
                                    : <><FiCheckCircle /> Submit Evaluation</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
const ROWS_PER_PAGE = 10;

const RAMonthlyEvaluationPage = () => {
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [search, setSearch] = useState('');
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(1);

    const [detailItem, setDetailItem] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [evaluatingItem, setEvaluatingItem] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const fetchEvaluations = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/monthly-evaluations', { params: { month: filterMonth } });
            setEvaluations(res.data?.data || []);
            setPage(1);
        } catch { toast.error('Failed to load evaluations'); }
        finally { setLoading(false); }
    }, [filterMonth]);

    useEffect(() => { fetchEvaluations(); }, [fetchEvaluations]);

    const total = evaluations.length;
    const evaluated = evaluations.filter(e => e.status === 'EVALUATED').length;
    const pending = total - evaluated;
    const completion = total > 0 ? Math.round((evaluated / total) * 100) : 0;

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = evaluations.filter(ev => {
            if (!q) return true;
            return [ev.employee?.name, ev.employee?.employeeCode, ev.employee?.department]
                .filter(Boolean).some(v => v.toLowerCase().includes(q));
        });
        list = [...list].sort((a, b) => {
            let aVal, bVal;
            if (sortField === 'name') { aVal = a.employee?.name || ''; bVal = b.employee?.name || ''; }
            else if (sortField === 'score') { aVal = a.score ?? -1; bVal = b.score ?? -1; }
            else if (sortField === 'status') { aVal = a.status || ''; bVal = b.status || ''; }
            else { aVal = a.month || ''; bVal = b.month || ''; }
            const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [evaluations, search, sortField, sortDir]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const SortIcon = ({ field }) => {
        if (sortField !== field) return <span className="meval-sort-neutral">⇅</span>;
        return sortDir === 'asc'
            ? <FiChevronUp className="meval-sort-active" />
            : <FiChevronDown className="meval-sort-active" />;
    };

    const openDetail = async (ev) => {
        setDetailItem(ev); setDetailData(null); setDetailLoading(true);
        try {
            const res = await api.get(`/ra/monthly-evaluations/${ev._id}`);
            setDetailData({ ...res.data, employee: ev.employee });
        } catch { toast.error('Failed to load details'); }
        finally { setDetailLoading(false); }
    };

    const closeDetail = () => { setDetailItem(null); setDetailData(null); };

    const handleEvaluate = async ({ score, remarks }) => {
        setSubmitting(true);
        try {
            await api.post('/ra/monthly-evaluation', {
                evaluationId: evaluatingItem._id,
                score: Number(score),
                remarks,
            });
            toast.success('Evaluation submitted successfully!');
            setEvaluatingItem(null);
            fetchEvaluations();
        } catch (err) { toast.error(err.response?.data?.message || 'Evaluation failed'); }
        finally { setSubmitting(false); }
    };

    // Helper: get plan count from evaluation row
    const getPlanCount = (ev) => {
        if (!ev.monthlyPlanId) return null;
        if (Array.isArray(ev.monthlyPlanId.planItems) && ev.monthlyPlanId.planItems.filter(Boolean).length > 0)
            return ev.monthlyPlanId.planItems.filter(Boolean).length;
        if (ev.monthlyPlanId.planDetails)
            return ev.monthlyPlanId.planDetails.split('\n').filter(s => s.trim()).length;
        return null;
    };

    return (
        <div className="meval-page fade-in">

            {/* ── COMPACT HEADER ── */}
            <div className="meval-topbar">
                <div className="meval-topbar-left">
                    <div className="meval-topbar-eyebrow">
                        <FiCalendar size={11} />
                        Monthly Evaluation
                    </div>
                    <h1 className="meval-topbar-title">Employee Evaluations</h1>
                    <p className="meval-topbar-desc">
                        Review plan submissions and score your direct reports for {formatMonthLabel(filterMonth)}.
                    </p>
                </div>
                <button
                    className="btn btn-secondary meval-export-btn"
                    onClick={() => toast('PDF export coming soon!', { icon: '📄' })}
                >
                    <FiDownload size={14} /> Export
                </button>
            </div>

            {/* ── KPI STRIP ── */}
            <div className="meval-kpi-strip">
                <SummaryCard icon={<FiUsers size={16} />} value={total} label="Total" subtitle="Employees" color="blue" />
                <SummaryCard icon={<FiClock size={16} />} value={pending} label="Pending" subtitle="Awaiting evaluation" color="amber" />
                <SummaryCard icon={<FiCheckCircle size={16} />} value={evaluated} label="Evaluated" subtitle="This month" color="green" />
                <SummaryCard icon={<FiTrendingUp size={16} />} value={`${completion}%`} label="Completion" subtitle={`${evaluated}/${total} done`} color="orange" />
            </div>

            {/* ── FILTER TOOLBAR ── */}
            <div className="meval-toolbar">
                <div className="meval-filter-group">
                    <FiFilter size={13} className="meval-filter-icon" />
                    <label htmlFor="meval-month-filter" className="meval-filter-label">Month</label>
                    <input
                        id="meval-month-filter"
                        type="month"
                        value={filterMonth}
                        onChange={e => setFilterMonth(e.target.value)}
                        className="meval-month-input"
                    />
                </div>
                <div className="meval-toolbar-divider" />
                <div className="meval-search-wrap">
                    <FiSearch size={13} className="meval-search-icon" />
                    <input
                        type="text"
                        className="meval-search-input"
                        placeholder="Search by name, code, or department…"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                    {search && (
                        <button className="meval-search-clear" onClick={() => { setSearch(''); setPage(1); }}>
                            <FiX size={12} />
                        </button>
                    )}
                </div>
                <span className="meval-result-count">
                    {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* ── EVALUATION TABLE CARD ── */}
            <div className="meval-table-card">
                <div className="meval-table-card-header">
                    <div>
                        <h3 className="meval-table-card-title">Evaluation Queue</h3>
                        <p className="meval-table-card-sub">Click any row to view details · Use Evaluate to score</p>
                    </div>
                    <span className={`meval-badge ${pending > 0 ? 'meval-badge--pending' : 'meval-badge--evaluated'}`}>
                        {pending > 0 ? `${pending} Pending` : '✓ All Done'}
                    </span>
                </div>

                {loading ? (
                    <div className="meval-loading">
                        <div className="meval-spinner" />
                        <p>Loading evaluations…</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="meval-empty">
                        <div className="meval-empty-icon">📭</div>
                        <h3>No evaluations found</h3>
                        <p>{search ? 'Try a different name, code, or department.' : 'No monthly plan submissions for this period.'}</p>
                    </div>
                ) : (
                    <>
                        {/* Head — 7 columns now */}
                        <div className="meval-table-head meval-table-head--v2">
                            <div onClick={() => toggleSort('name')}>Employee <SortIcon field="name" /></div>
                            <div onClick={() => toggleSort('month')}>Month <SortIcon field="month" /></div>
                            <div>Plans</div>
                            <div>Achievement</div>
                            <div onClick={() => toggleSort('score')}>Score <SortIcon field="score" /></div>
                            <div onClick={() => toggleSort('status')}>Status <SortIcon field="status" /></div>
                            <div className="meval-col-actions-head">Actions</div>
                        </div>

                        {/* Rows */}
                        <div className="meval-table-body">
                            {pageRows.map((ev, idx) => {
                                const planCount = getPlanCount(ev);
                                const hasAch = ev.monthlyPlanId && ev.achievementSubmitted; // may not exist - we'll just show a badge

                                return (
                                    <div
                                        key={ev._id}
                                        className="meval-table-row meval-table-row--v2"
                                        onClick={() => openDetail(ev)}
                                        style={{ animationDelay: `${idx * 35}ms` }}
                                    >
                                        {/* Employee */}
                                        <div className="meval-cell meval-cell--employee">
                                            <div className="meval-avatar">{getInitials(ev.employee?.name)}</div>
                                            <div className="meval-employee-info">
                                                <strong>{ev.employee?.name || 'Unknown'}</strong>
                                                <span>{ev.employee?.employeeCode} &bull; {ev.employee?.department}</span>
                                            </div>
                                        </div>

                                        {/* Month */}
                                        <div className="meval-cell meval-cell--month">
                                            <FiCalendar size={12} className="meval-cell-icon" />
                                            {formatMonthLabel(ev.month)}
                                        </div>

                                        {/* Plans count */}
                                        <div className="meval-cell">
                                            {planCount != null
                                                ? <span className="meval-plans-pill">{planCount} plan{planCount !== 1 ? 's' : ''}</span>
                                                : <span className="meval-score-dash">—</span>}
                                        </div>

                                        {/* Achievement status */}
                                        <div className="meval-cell">
                                            {ev.status === 'EVALUATED' || ev.hasAchievement
                                                ? <span className="meval-ach-badge meval-ach-badge--submitted"><FiCheckCircle size={10} /> Submitted</span>
                                                : <span className="meval-ach-badge meval-ach-badge--pending"><FiClock size={10} /> Pending</span>
                                            }
                                        </div>

                                        {/* Score */}
                                        <div className="meval-cell">
                                            <ScoreBar score={ev.status === 'EVALUATED' ? ev.score : null} />
                                        </div>

                                        {/* Status */}
                                        <div className="meval-cell">
                                            <StatusBadge status={ev.status} />
                                        </div>

                                        {/* Actions */}
                                        <div className="meval-cell meval-cell--actions" onClick={e => e.stopPropagation()}>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => openDetail(ev)}
                                            >
                                                <FiEye size={13} /> View
                                            </button>
                                            {ev.status !== 'EVALUATED' && (
                                                <button
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => setEvaluatingItem(ev)}
                                                >
                                                    <FiStar size={13} /> Evaluate
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="meval-pagination">
                                <span className="meval-page-info">
                                    Page {safePage} of {totalPages} &nbsp;·&nbsp; {filtered.length} employees
                                </span>
                                <div className="meval-page-btns">
                                    <button className="meval-page-btn" disabled={safePage === 1}
                                        onClick={() => setPage(p => Math.max(1, p - 1))}>
                                        <FiChevronLeft size={14} />
                                    </button>
                                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                                        .reduce((acc, n, idx, arr) => {
                                            if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…');
                                            acc.push(n);
                                            return acc;
                                        }, [])
                                        .map((item, i) => item === '…'
                                            ? <span key={`e-${i}`} className="meval-page-ellipsis">…</span>
                                            : <button key={item}
                                                className={`meval-page-btn ${item === safePage ? 'meval-page-btn--active' : ''}`}
                                                onClick={() => setPage(item)}>{item}</button>
                                        )}
                                    <button className="meval-page-btn" disabled={safePage === totalPages}
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                                        <FiChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modals */}
            {detailItem && (
                <DetailModal
                    ev={detailItem}
                    detail={detailData}
                    detailLoading={detailLoading}
                    onClose={closeDetail}
                    onEvaluate={() => { closeDetail(); setEvaluatingItem(detailItem); }}
                />
            )}
            {evaluatingItem && (
                <EvaluateModal
                    item={evaluatingItem}
                    onClose={() => setEvaluatingItem(null)}
                    onSubmit={handleEvaluate}
                    submitting={submitting}
                />
            )}
        </div>
    );
};

export default RAMonthlyEvaluationPage;