import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './RAMonthlyEvaluation.css';
import ExtendDeadlineModal from './ExtendDeadlineModal';
// CENTRALIZED DEADLINE CONFIG — single source of truth via DeadlineContext
import { useDeadlines } from '../../context/DeadlineContext';
import {
    FiFilter, FiSearch, FiStar, FiEye, FiX, FiUsers, FiClock,
    FiCheckCircle, FiTrendingUp, FiClipboard, FiMessageSquare,
    FiDownload, FiChevronUp, FiChevronDown, FiChevronLeft,
    FiChevronRight, FiAward, FiCalendar, FiAlertCircle, FiFileText,
    FiXCircle, FiAlertTriangle,
} from 'react-icons/fi';
import { FaFile } from 'react-icons/fa';

/* ─────────────────────────────────────────
   HELPERS — per spec
───────────────────────────────────────── */
function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.length > 0)
        return plan.planItems.map(p => typeof p === 'string' ? p : p.itemText).filter(Boolean);
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
    if (p >= 75) return { label: 'Almost done', color: '#BA7517', bg: '#FAEEDA', text: '#633806', border: '#BA7517' };
    if (p >= 50) return { label: 'Halfway', color: '#E85523', bg: '#FFF0EB', text: '#993C1D', border: '#E85523' };
    if (p >= 25) return { label: 'Just started', color: '#BA7517', bg: '#FAEEDA', text: '#633806', border: '#BA7517' };
    return { label: 'Not started', color: '#A32D2D', bg: '#FCEBEB', text: '#791F1F', border: '#A32D2D' };
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
                {Number(score)}<span className="meval-score-denom">/10</span>
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
                        <span className="meval-ctx-overall-lbl">Overall Progress</span>
                        <span className="meval-ctx-overall-val">
                            {completed}/{planItems.length} plans &middot; {overallProg}%
                        </span>
                    </div>
                    <div className="meval-ctx-prog-track">
                        <div className="meval-ctx-prog-fill" style={{ width: `${overallProg}%` }} />
                    </div>
                    <div className="meval-ctx-ts-row">
                        {plan?.submittedAt && (
                            <span className="meval-ctx-ts"><FiFileText size={9} /> Plan submitted on {formatDate(plan.submittedAt)}</span>
                        )}
                        {achievement?.submittedAt && (
                            <span className="meval-ctx-ts"><FiTrendingUp size={9} /> Progress submitted on {formatDate(achievement.submittedAt)}</span>
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
                                <div className="meval-ctx-ach-lbl"><FiTrendingUp size={10} /> Progress Details</div>
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
                        Additional Work done with progress update 
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
                                            <span className="meval-ctx-plan-name">Extra Work with progress update {i + 1}</span>
                                            <span className={`meval-ctx-plan-badge meval-ctx-plan-badge--${statusCls}`}>{statusLabel}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="meval-ctx-prog-section">
                                    <div className="meval-ctx-prog-labels">
                                        <span>Progress Percentage</span>
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
                                    <div className="meval-ctx-ach-lbl"><FiStar size={10} color="#BA7517" />Work details with progress update</div>
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
                    <span>Progress Details not yet submitted</span>
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   DETAIL MODAL (View button)
   New prop: isMissedDeadline (boolean) — changes footer
───────────────────────────────────────── */
const DetailModal = ({ ev, detail, detailLoading, onClose, onEvaluate, onReject, isMissedDeadline, onExtendDeadline }) => {
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
                        <span className={`meval-step-lbl meval-step-lbl--${stepperAch}`}>Progress</span>
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
                            {/* Rejection alert — shown when RA has rejected this plan */}
                            {(ev.monthlyPlanId?.status === 'REJECTED' || detail?.plan?.status === 'REJECTED') && (
                                <div className="meval-rejection-alert">
                                    <div className="meval-rejection-alert-header">
                                        <FiXCircle size={14} />
                                        <strong>Plan Rejected by RA</strong>
                                    </div>
                                    <div className="meval-rejection-alert-reason">
                                        <span className="meval-rejection-reason-label">Rejection Reason:</span>
                                        {detail?.plan?.raRemarks || ev.monthlyPlanId?.raRemarks || '—'}
                                    </div>
                                    <div className="meval-rejection-alert-hint">
                                        The employee will need to revise and resubmit this plan before evaluation can proceed.
                                    </div>
                                </div>
                            )}

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
                                                    Score: <strong>{Number(detail.score)}/10</strong>
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
                                        {Number(detail.score)}/10
                                    </div>
                                )}
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="meval-vmodal-footer">
                    {isMissedDeadline ? (
                        /* ── Missed deadline footer ── */
                        <>
                            <span style={{ color: '#B91C1C', fontSize: '13px', fontWeight: 500 }}>
                                ⚠️ Deadline passed — submission missing
                            </span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="btn btn-secondary"
                                    style={{ border: '1px solid #FDBA74', color: '#C2410C', background: '#FFF7ED', fontSize: '13px', fontWeight: 500 }}
                                    onClick={onExtendDeadline}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#FFEDD5'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = '#FFF7ED'; }}
                                >
                                    ⏱ Extend Deadline
                                </button>
                                <button className="btn btn-secondary" onClick={onClose}>Close</button>
                            </div>
                        </>
                    ) : (
                        /* ── Normal footer ── */
                        <>
                            <span className="meval-vmodal-ftr-state">
                                {isEvaluated ? 'Evaluated'
                                    : (ev.monthlyPlanId?.status === 'REJECTED' || detail?.plan?.status === 'REJECTED') ? 'Plan rejected — awaiting resubmission'
                                    : hasAch ? 'Awaiting RA review'
                                    : 'Progress pending'}
                            </span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {/* Evaluate button: hidden when plan is REJECTED — employee must resubmit first */}
                                {!isEvaluated
                                    && hasAch
                                    && onEvaluate
                                    && ev.monthlyPlanId?.status !== 'REJECTED'
                                    && detail?.plan?.status !== 'REJECTED' && (
                                    <button className="btn btn-primary" onClick={onEvaluate}>
                                        <FiStar size={13} /> Evaluate
                                    </button>
                                )}
                                {!isEvaluated && ev.monthlyPlanId?.status !== 'REJECTED' && detail?.plan?.status !== 'REJECTED' && onReject && (
                                    <button className="btn btn-danger" onClick={onReject}>
                                        <FiXCircle size={13} /> Reject Plan
                                    </button>
                                )}
                                <button className="btn btn-secondary" onClick={onClose}>Close</button>
                            </div>
                        </>
                    )}
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
        api.get(`/ra/monthly-evaluations/${item.id}`)
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
                            <FiClipboard size={13} /> Plan & Progress Context
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
   REJECT MODAL
───────────────────────────────────────── */
const RejectModal = ({ item, planStatus, planRemarks, onClose, onSubmit, submitting }) => {
    const [step, setStep] = useState(1); // 1=confirm, 2=remarks+plan
    const [raRemarks, setRaRemarks] = useState('');
    const [ctxDetail, setCtxDetail] = useState(null);
    const MIN_CHARS = 10;
    const MAX_CHARS = 500;
    const isValid = raRemarks.trim().length >= MIN_CHARS;

    // Fetch plan + achievement context (same endpoint as EvaluateModal)
    useEffect(() => {
        if (!item) return;
        api.get(`/ra/monthly-evaluations/${item.id}`)
            .then(res => setCtxDetail(res.data))
            .catch(() => setCtxDetail(null));
    }, [item]);

    const handleSubmit = () => {
        if (!isValid) { toast.error(`Please provide a reason (at least ${MIN_CHARS} characters).`); return; }
        onSubmit({ raRemarks: raRemarks.trim() });
    };

    return createPortal(
        <div className="meval-overlay" onClick={onClose}>
            <div
                className={`meval-reject-modal${step === 2 ? ' meval-reject-modal--wide' : ''}`}
                onClick={e => e.stopPropagation()}
            >

                {/* Header */}
                <div className="meval-reject-hdr">
                    <div className="meval-reject-hdr-left">
                        <div className="meval-reject-icon-wrap">
                            <FiXCircle size={18} />
                        </div>
                        <div>
                            <h2 className="meval-reject-title">Reject Monthly Plan</h2>
                            <p className="meval-reject-subtitle">
                                {item?.employee?.name} &bull; {formatMonthLabel(item?.month)}
                            </p>
                        </div>
                    </div>
                    <button className="meval-modal-close" onClick={onClose}><FiX /></button>
                </div>

                {step === 1 ? (
                    /* ── Step 1: Confirmation ── */
                    <div className="meval-reject-body">
                        <div className="meval-reject-warn-banner">
                            <FiAlertTriangle size={16} />
                            <div>
                                <div className="meval-reject-warn-title">Are you sure you want to reject this plan?</div>
                                <div className="meval-reject-warn-sub">
                                    The employee will be notified and must revise and resubmit their plan.
                                    This action cannot be undone without employee resubmission.
                                </div>
                            </div>
                        </div>

                        {/* Plan preview */}
                        <div className="meval-reject-plan-preview">
                            <div className="meval-reject-preview-label">
                                <FiFileText size={11} /> Plan being rejected
                            </div>
                            <div className="meval-reject-preview-month">{formatMonthLabel(item?.month)}</div>
                            <div className="meval-reject-preview-employee">
                                {item?.employee?.name} &bull; {item?.employee?.employeeCode} &bull; {item?.employee?.department}
                            </div>
                        </div>

                        <div className="meval-reject-step1-actions">
                            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => setStep(2)}>
                                <FiXCircle size={13} /> Yes, Reject & Add Reason
                            </button>
                        </div>
                    </div>
                ) : (
                    /* ── Step 2: Two-column — Plan context LEFT, Remarks form RIGHT ── */
                    <div className="meval-reject-step2-body">

                        {/* LEFT — plan & achievement context */}
                        <div className="meval-reject-ctx-panel">
                            <div className="meval-reject-ctx-title">
                                <FiFileText size={12} /> Plan Being Rejected
                            </div>
                            <div className="meval-reject-ctx-inner">
                                {ctxDetail ? (
                                    <PlanContextPanel
                                        plan={ctxDetail.plan}
                                        achievement={ctxDetail.achievement}
                                    />
                                ) : (
                                    <div className="meval-loading">
                                        <div className="meval-spinner" />
                                        <p>Loading plan details…</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* RIGHT — rejection reason form */}
                        <div className="meval-reject-form-panel">
                            <div>
                                <p className="meval-reject-form-title">Rejection Reason</p>
                            </div>

                            <div className="meval-reject-remarks-info">
                                <FiMessageSquare size={13} />
                                Provide a clear reason so the employee knows what to revise.
                                This reason will be visible to the employee and recorded in the audit log.
                            </div>

                            <div className="meval-form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <div className="meval-form-label-row">
                                    <label className="meval-form-label">
                                        Rejection Reason <span className="meval-required">*</span>
                                    </label>
                                    <span className={`meval-char-counter ${raRemarks.length > MAX_CHARS * 0.9 ? 'meval-char-counter--warn' : ''}`}>
                                        {raRemarks.length}/{MAX_CHARS}
                                    </span>
                                </div>
                                <textarea
                                    className="meval-textarea meval-reject-textarea"
                                    value={raRemarks}
                                    onChange={e => setRaRemarks(e.target.value.slice(0, MAX_CHARS))}
                                    placeholder="Explain why this plan is being rejected and what the employee should change when resubmitting… (min 10 characters)"
                                    rows={6}
                                    autoFocus
                                    style={{ flex: 1, resize: 'none' }}
                                />
                                {raRemarks.trim().length > 0 && raRemarks.trim().length < MIN_CHARS && (
                                    <div className="meval-reject-char-hint">
                                        {MIN_CHARS - raRemarks.trim().length} more character{MIN_CHARS - raRemarks.trim().length !== 1 ? 's' : ''} needed
                                    </div>
                                )}
                            </div>

                            <div className="meval-reject-form-actions">
                                <button className="btn btn-secondary" onClick={() => setStep(1)} disabled={submitting}>Back</button>
                                <button
                                    className="btn btn-danger"
                                    onClick={handleSubmit}
                                    disabled={submitting || !isValid}
                                >
                                    {submitting
                                        ? <><span className="meval-btn-spinner" /> Rejecting…</>
                                        : <><FiXCircle size={13} /> Confirm Rejection</>
                                    }
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
const ROWS_PER_PAGE = 10;

// ── App go-live date — set once, never changes ──
const GO_LIVE = { year: 2026, month: 5 }; // June 2026

const RAMonthlyEvaluationPage = () => {
    const location = useLocation();
    // CENTRALIZED DEADLINE CONFIG — plan & achievement days from .env via API.
    // getPlanDeadlineForRole / getAchievementDeadlineForRole are called per team
    // member with their own role so an RA reportee gets the RA deadline, not EMPLOYEE.
    const {
        getPlanDeadlineForRole,
        getAchievementDeadlineForRole,
    } = useDeadlines();
    const [evaluations, setEvaluations] = useState([]);
    const [employeesList, setEmployeesList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    });
    const currentYM = useMemo(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }, []);
    const [search, setSearch] = useState('');
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(1);

    const [detailItem, setDetailItem] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailIsMissed, setDetailIsMissed] = useState(false);

    const [evaluatingItem, setEvaluatingItem] = useState(null);
    const [rejectingItem, setRejectingItem] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    /* ── Deadline Extension state ── */
    const [isMissedSectionOpen, setIsMissedSectionOpen] = useState(false);
    const [isExtendModalOpen, setIsExtendModalOpen] = useState(false);
    const [selectedEmployeeForExtension, setSelectedEmployeeForExtension] = useState(null);
    /* Track rows that have been extended: { [employeeId+type]: { newDate } } */
    const [extendedRows, setExtendedRows] = useState({});
    const missedSectionRef = useRef(null);

    const fetchEvaluations = useCallback(async () => {
        setLoading(true);
        try {
            const [evalRes, empRes] = await Promise.all([
                api.get('/ra/monthly-evaluations', { params: { month: filterMonth } }),
                // Pass filterMonth so the backend uses EmployeeRAHistory and returns
                // only employees who were under this RA in the selected month.
                api.get('/ra/my-employees', { params: { month: filterMonth } })
            ]);
            setEvaluations(evalRes.data?.data || []);
            setEmployeesList(Array.isArray(empRes.data) ? empRes.data : []);
            setPage(1);
        } catch { toast.error('Failed to load data'); }
        finally { setLoading(false); }
    }, [filterMonth]);

    useEffect(() => { fetchEvaluations(); }, [fetchEvaluations]);

    /* ── Auto-expand missed section if ?filter=missed in URL ── */
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('filter') === 'missed') {
            setIsMissedSectionOpen(true);
            // Scroll into view after a short delay so the section has rendered
            setTimeout(() => {
                if (missedSectionRef.current) {
                    missedSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
        }
    }, [location.search]);

    /* ── Missed deadline employees derived from all employees ── */
    /* Each team member's deadline is resolved from their OWN role (emp.role)
       so an RA reportee (e.g. Sushant das, role=RA) gets checked against the
       RA deadline (27th) instead of the EMPLOYEE deadline (26th). This also
       means the Extend button is hidden when the member's own-role deadline
       hasn't passed yet. */
    const missedEvaluations = useMemo(() => {
        const today = new Date();
        const [selYear, selMonth] = filterMonth.split('-').map(Number);
        if (!selYear || !selMonth) return [];

        const q = search.trim().toLowerCase();

        // Sets for O(1) lookups
        const submittedSet = new Set();
        const achievementsSet = new Set();

        evaluations.forEach(ev => {
            const empId = ev.employee?.id?.toString();
            if (!empId) return;
            // Treat any employee who has a monthlyPlanId (whether SUBMITTED, REJECTED, or
            // otherwise) as having a "plan on record" for the missed-deadline check.
            // Reason: a rejected plan means the employee DID submit within the deadline;
            // the RA rejected it afterwards. The dateMiddleware already allows the employee
            // to resubmit after a rejection regardless of the deadline, so they do NOT need
            // a deadline extension and must NOT appear in the missed-deadline section.
            if (ev.monthlyPlanId) submittedSet.add(empId);
            if (ev.hasAchievement || ev.status === 'EVALUATED') achievementsSet.add(empId);
        });


        return employeesList.map(emp => {
            const empId = emp.id?.toString();
            const hasPlan = submittedSet.has(empId);
            const hasAch = achievementsSet.has(empId);

            // Resolve deadlines per this specific person's role.
            // Falls back to 'EMPLOYEE' for any unrecognised role (HRD, MD, etc.).
            const memberRole = emp.role || 'EMPLOYEE';
            const memberPlanDeadline = getPlanDeadlineForRole(filterMonth, memberRole);
            const memberAchDeadline  = getAchievementDeadlineForRole(filterMonth, memberRole);

            if (!memberPlanDeadline || !memberAchDeadline) return null;

            let missingType = null;
            let originalDeadline = null;

            if (!hasPlan && today > memberPlanDeadline) {
                missingType = 'plan';
                originalDeadline = memberPlanDeadline;
            } else if (hasPlan && !hasAch && today > memberAchDeadline) {
                missingType = 'achievement';
                originalDeadline = memberAchDeadline;
            }

            if (!missingType) return null;

            // Apply search filter
            if (q) {
                const matchable = [
                    emp.name,
                    emp.employeeCode,
                    emp.department,
                ].filter(Boolean);
                if (!matchable.some(v => v.toLowerCase().includes(q))) return null;
            }

            // Return shape expected by table and ExtendModal
            const existingEv = evaluations.find(e => e.employee?.id?.toString() === empId) || {};

            return {
                ...existingEv,
                _id: existingEv.id || `missed-${empId}`,
                employee: emp,
                missingType,
                originalDeadline
            };
        }).filter(Boolean);
    }, [employeesList, evaluations, filterMonth, search, getPlanDeadlineForRole, getAchievementDeadlineForRole]);


    /* ── Parsed filterMonth for the modal ── */
    const filterMonthYear = useMemo(() => {
        const [y, m] = filterMonth.split('-').map(Number);
        return { month: m, year: y };
    }, [filterMonth]);

    /* ── Helper: open extend modal ── */
    const openExtendModal = (emp, missingType, originalDeadline) => {
        setSelectedEmployeeForExtension({ ...emp, missingType, originalDeadline });
        setIsExtendModalOpen(true);
    };

    const closeExtendModal = () => {
        setIsExtendModalOpen(false);
        setSelectedEmployeeForExtension(null);
    };

    /* Format month label e.g. "May 2026" */
    const filterMonthLabel = useMemo(() => {
        const [y, m] = filterMonth.split('-').map(Number);
        return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [filterMonth]);

    const handleRejectPlan = async ({ raRemarks }) => {
        if (!rejectingItem) return;
        const planId = rejectingItem.monthlyPlanId?.id || rejectingItem.monthlyPlanId;
        if (!planId) { toast.error('Could not identify the monthly plan to reject.'); return; }
        setSubmitting(true);
        try {
            await api.put(`/ra/monthly-plan/${planId}/reject`, { raRemarks });
            toast.success('Monthly plan rejected. The employee has been notified.');
            setRejectingItem(null);
            fetchEvaluations();
            // Refresh detail panel if it's open for the same employee/month
            if (detailItem && detailItem.id === rejectingItem.id) {
                const res = await api.get(`/ra/monthly-evaluations/${detailItem.id}`);
                setDetailData(res.data);
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to reject monthly plan.');
        } finally { setSubmitting(false); }
    };


    // FIX (permanent): "total" should only count active, valid plan submissions.
    // A REJECTED plan is no longer valid — the employee must resubmit. Counting
    // rejected plans inflates "Total" and makes the completion rate misleading.
    const total = evaluations.filter(e => e.monthlyPlanId?.status !== 'REJECTED').length;
    const evaluated = evaluations.filter(e => e.status === 'EVALUATED').length;

    // FIX (permanent): "pending" must only count evaluations the RA can actually
    // act on right now. The three conditions that must ALL be true:
    //   1. Not yet evaluated (status !== 'EVALUATED')
    //   2. Plan is not rejected (monthlyPlanId?.status !== 'REJECTED')
    //   3. Employee has submitted their progress (hasAchievement === true)
    //
    // Previously this was `total - evaluated` which incorrectly included:
    //   • Employees who haven't uploaded progress yet (RA cannot evaluate yet)
    //   • Employees whose plan was rejected (RA has already acted; no eval possible)
    const pending = evaluations.filter(e =>
      e.status !== 'EVALUATED' &&
      e.monthlyPlanId?.status !== 'REJECTED' &&
      e.hasAchievement === true
    ).length;

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

    const openDetail = async (ev, isMissed = false) => {
        setDetailItem(ev); setDetailData(null); setDetailLoading(true); setDetailIsMissed(isMissed);
        try {
            const res = await api.get(`/ra/monthly-evaluations/${ev.id}`);
            setDetailData({ ...res.data, employee: ev.employee });
        } catch { toast.error('Failed to load details'); }
        finally { setDetailLoading(false); }
    };

    const closeDetail = () => { setDetailItem(null); setDetailData(null); setDetailIsMissed(false); };

    const handleEvaluate = async ({ score, remarks }) => {
        setSubmitting(true);
        try {
            await api.post('/ra/monthly-evaluation', {
                evaluationId: evaluatingItem.id,
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
                <SummaryCard icon={<FaFile size={16} />} value={total} label="Total" subtitle="Monthly plans submitted" color="blue" />
                <SummaryCard icon={<FiClock size={16} />} value={pending} label="Pending" subtitle="Awaiting evaluation" color="amber" />
                <SummaryCard icon={<FiCheckCircle size={16} />} value={evaluated} label="Evaluated" subtitle="This month" color="green" />
                <SummaryCard icon={<FiTrendingUp size={16} />} value={`${completion}%`} label="Completion" subtitle={`${evaluated}/${total} done`} color="orange" />
            </div>

            {/* ── FILTER TOOLBAR ── */}
            <div className="meval-toolbar">
                <div className="meval-filter-group">
                    <FiFilter size={13} className="meval-filter-icon" />
                    <label className="meval-filter-label">Period</label>
                    <div className="meval-period-selectors">
        {/* ── Month dropdown — only valid months for selected year ── */}
    <select
        value={filterMonth.split('-')[1]}
        onChange={e => setFilterMonth(`${filterMonth.split('-')[0]}-${e.target.value}`)}
        className="meval-month-select"
    >
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
            const selectedYear = Number(filterMonth.split('-')[0]);
            const isBeforeGoLive = selectedYear === GO_LIVE.year && m < GO_LIVE.month;
            const isAfterToday  = selectedYear === currentYM.year && m > currentYM.month;
            if (isBeforeGoLive || isAfterToday) return null;
            // if(isBeforeGoLive) return null;
            return (
                <option key={m} value={String(m).padStart(2, '0')}>
                    {new Date(2000, m - 1).toLocaleString('en-US', { month: 'long' })}
                </option>
            );
        })}
    </select>

    {/* ── Year dropdown — only years from go-live to current year ── */}
    <select
        value={filterMonth.split('-')[0]}
        onChange={e => {
            const newYear = Number(e.target.value);
            let currentMon = Number(filterMonth.split('-')[1]);
            // Clamp month: if switching to go-live year, don't go below go-live month
            if (newYear === GO_LIVE.year && currentMon < GO_LIVE.month)
                currentMon = GO_LIVE.month;
            // Clamp month: if switching to current year, don't go above today's month
            if (newYear === currentYM.year && currentMon > currentYM.month)
                currentMon = currentYM.month;
            setFilterMonth(`${newYear}-${String(currentMon).padStart(2, '0')}`);
        }}
        className="meval-year-select"
    >
        {Array.from(
            { length: currentYM.year - GO_LIVE.year + 1 },
            (_, i) => GO_LIVE.year + i
        ).map(year => (
            <option key={year} value={year}>{year}</option>
        ))}
    </select>
</div>
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
                        <p className="meval-table-card-sub">Click any row to view details · Use Evaluate to score · Use Reject to send back for revision</p>
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
                        {/* Scrollable wrapper — guarantees Actions column is always fully visible */}
                        <div className="meval-table-scroll">
                            {/* Head — 7 columns */}
                            <div className="meval-table-head meval-table-head--v2">
                                <div onClick={() => toggleSort('name')}>Employee <SortIcon field="name" /></div>
                                <div onClick={() => toggleSort('month')}>Month <SortIcon field="month" /></div>
                                <div>Plans</div>
                                <div>Progress</div>
                                <div onClick={() => toggleSort('score')}>Score <SortIcon field="score" /></div>
                                <div onClick={() => toggleSort('status')}>Status <SortIcon field="status" /></div>
                                <div className="meval-col-actions-head">Actions</div>
                            </div>

                            {/* Rows */}
                            <div className="meval-table-body">
                                {pageRows.map((ev, idx) => {
                                    const planCount = getPlanCount(ev);
                                    // hasAchievement is set by the backend: true only when a SUBMITTED
                                    // (not DRAFT) MonthlyAchievement exists for this plan.
                                    // Evaluation is only permitted AFTER the employee submits their progress.
                                    const hasAch = !!ev.hasAchievement;

                                    return (
                                        <div
                                            key={ev.id}
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

                                            {/* Achievement status / Plan rejection badge */}
                                            <div className="meval-cell">
                                                {(() => {
                                                    const planStatus = ev.monthlyPlanId?.status;
                                                    if (planStatus === 'REJECTED') {
                                                        return <span className="meval-ach-badge meval-ach-badge--rejected"><FiXCircle size={10} /> Plan Rejected</span>;
                                                    }
                                                    if (ev.hasAchievement) {
                                                        return <span className="meval-ach-badge meval-ach-badge--submitted"><FiCheckCircle size={10} /> Submitted</span>;
                                                    }
                                                    return <span className="meval-ach-badge meval-ach-badge--pending"><FiClock size={10} /> Pending</span>;
                                                })()}
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
                                                {/* Evaluate: only shown AFTER the employee submits their progress/achievement */}
                                                {ev.status !== 'EVALUATED'
                                                    && ev.monthlyPlanId?.status !== 'REJECTED'
                                                    && hasAch && (
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => setEvaluatingItem(ev)}
                                                        title="Evaluate — progress has been submitted"
                                                    >
                                                        <FiStar size={13} /> Evaluate
                                                    </button>
                                                )}
                                                {/* Reject Plan: allowed as long as not yet evaluated or already rejected */}
                                                {ev.status !== 'EVALUATED' && ev.monthlyPlanId?.status !== 'REJECTED' && (
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => setRejectingItem(ev)}
                                                        title="Reject plan and ask employee to revise"
                                                    >
                                                        <FiXCircle size={13} /> Reject Plan
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div> {/* end meval-table-scroll */}

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
            </div> {/* end meval-table-card */}

            {/* ───────────────────────────────────────────────────
                MISSED DEADLINE SECTION
            ─────────────────────────────────────────────────── */}
            {missedEvaluations.length > 0 && (
                <div ref={missedSectionRef} style={{ marginTop: '4px' }}>
                    {/* Collapsible header */}
                    <div
                        onClick={() => setIsMissedSectionOpen(o => !o)}
                        style={{
                            background: '#FFFBEB',
                            borderLeft: '3px solid #F59E0B',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            cursor: 'pointer',
                            border: '1px solid #FDE68A',
                            borderLeftWidth: '3px',
                            userSelect: 'none',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '1rem' }}>⚠️</span>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400E' }}>
                                            Missed Deadline Employees
                                        </span>
                                        <span style={{
                                            background: '#FEF3C7', color: '#92400E',
                                            borderRadius: '9999px', fontSize: '12px', fontWeight: 600,
                                            padding: '2px 10px',
                                        }}>
                                            {missedEvaluations.length} OVERDUE
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#B45309', marginTop: '2px' }}>
                                        These employees have not submitted within the deadline period
                                    </div>
                                </div>
                            </div>
                            <FiChevronDown
                                size={18}
                                style={{
                                    color: '#B45309',
                                    flexShrink: 0,
                                    transform: isMissedSectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                }}
                            />
                        </div>
                    </div>

                    {/* Expandable table */}
                    {isMissedSectionOpen && (
                        <div style={{
                            background: '#fff',
                            border: '1px solid #FDE68A',
                            borderTop: 'none',
                            borderRadius: '0 0 8px 8px',
                            overflow: 'hidden',
                        }}>
                            {/* Table head */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(200px,2.5fr) minmax(130px,1fr) minmax(140px,1fr) minmax(160px,1.2fr) minmax(160px,1.2fr)',
                                padding: '9px 20px',
                                background: '#FFFBEB',
                                borderBottom: '1px solid #FDE68A',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                color: '#92400E',
                            }}>
                                <div>Employee</div>
                                <div>Month</div>
                                <div>Missing</div>
                                <div>Original Deadline</div>
                                <div style={{ textAlign: 'right' }}>Action</div>
                            </div>

                            {/* Table rows */}
                            {missedEvaluations.map(ev => {
                                const empId = ev.employee?.id?.toString() || ev.id?.toString();
                                const rowKey = `${empId}-${ev.missingType}`;
                                const extended = extendedRows[rowKey];

                                return (
                                    <div
                                        key={ev.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'minmax(200px,2.5fr) minmax(130px,1fr) minmax(140px,1fr) minmax(160px,1.2fr) minmax(160px,1.2fr)',
                                            padding: '12px 20px',
                                            borderBottom: '1px solid #FEF3C7',
                                            alignItems: 'center',
                                        }}
                                    >
                                        {/* Employee */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div className="meval-avatar" style={{ flexShrink: 0 }}>
                                                {getInitials(ev.employee?.name)}
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {ev.employee?.name || 'Unknown'}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <span>{ev.employee?.employeeCode}</span>
                                                    {ev.employee?.department && (
                                                        <span style={{
                                                            background: '#FEF3C7', color: '#92400E',
                                                            borderRadius: '4px', padding: '0 4px', fontSize: '0.68rem', fontWeight: 600,
                                                        }}>
                                                            {ev.employee.department}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Month */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.845rem', color: 'var(--text-primary)' }}>
                                            <FiCalendar size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                            {filterMonthLabel}
                                        </div>

                                        {/* Missing type pill */}
                                        <div>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                padding: '3px 10px', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 600,
                                                whiteSpace: 'nowrap',
                                                ...(ev.missingType === 'plan'
                                                    ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
                                                    : { background: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE' }),
                                            }}>
                                                {ev.missingType === 'plan' ? '📋 Plan' : '🏆 Progress'}
                                            </span>
                                        </div>

                                        {/* Original deadline */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.83rem', color: '#B91C1C', fontWeight: 500 }}>
                                            <span style={{ fontSize: '0.8rem' }}>🔴</span>
                                            {ev.originalDeadline
                                                ? new Date(ev.originalDeadline).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                                                : '—'}
                                        </div>

                                        {/* Action */}
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            {extended ? (
                                                <span style={{
                                                    background: '#F0FDF4', color: '#166534',
                                                    border: '1px solid #BBF7D0', borderRadius: '6px',
                                                    padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    ✅ Extended → {new Date(extended.newDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => openExtendModal(ev.employee, ev.missingType, ev.originalDeadline)}
                                                    style={{
                                                        background: '#FFF7ED', color: '#C2410C',
                                                        border: '1px solid #FDBA74', borderRadius: '6px',
                                                        padding: '6px 14px', fontSize: '13px', fontWeight: 500,
                                                        cursor: 'pointer', fontFamily: 'inherit',
                                                        whiteSpace: 'nowrap',
                                                        transition: 'background 0.15s',
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = '#FFEDD5'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = '#FFF7ED'; }}
                                                >
                                                    ⏱ Extend Deadline
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Modals */}
            {detailItem && (
                <DetailModal
                    ev={detailItem}
                    detail={detailData}
                    detailLoading={detailLoading}
                    onClose={closeDetail}
                    isMissedDeadline={detailIsMissed}
                    onEvaluate={
                        // Block evaluation when plan is rejected — employee must resubmit first
                        detailIsMissed
                        || detailItem.monthlyPlanId?.status === 'REJECTED'
                        || detailData?.plan?.status === 'REJECTED'
                            ? undefined
                            : () => { closeDetail(); setEvaluatingItem(detailItem); }
                    }
                    onReject={
                        // Block re-rejection of an already rejected plan
                        detailIsMissed
                        || detailItem.monthlyPlanId?.status === 'REJECTED'
                        || detailData?.plan?.status === 'REJECTED'
                            ? undefined
                            : () => { closeDetail(); setRejectingItem(detailItem); }
                    }
                    onExtendDeadline={() => {
                        const missed = missedEvaluations.find(m => m.id === detailItem.id);
                        if (missed) openExtendModal(missed.employee, missed.missingType, missed.originalDeadline);
                    }}
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
            {rejectingItem && (
                <RejectModal
                    item={rejectingItem}
                    onClose={() => setRejectingItem(null)}
                    onSubmit={handleRejectPlan}
                    submitting={submitting}
                />
            )}

            {/* ── Extend Deadline Modal ── */}
            {isExtendModalOpen && selectedEmployeeForExtension && (
                <ExtendDeadlineModal
                    employee={selectedEmployeeForExtension}
                    month={filterMonthLabel}
                    monthYear={filterMonthYear}
                    missingType={selectedEmployeeForExtension.missingType || 'plan'}
                    originalDeadline={selectedEmployeeForExtension.originalDeadline || null}
                    onClose={closeExtendModal}
                    onConfirm={(newDeadline, reason, notify, empName) => {
                        // Mark row as extended (optimistic UI)
                        const empId = selectedEmployeeForExtension.id?.toString();
                        const rowKey = `${empId}-${selectedEmployeeForExtension.missingType}`;
                        setExtendedRows(prev => ({ ...prev, [rowKey]: { newDate: newDeadline } }));
                        closeExtendModal();
                    }}
                />
            )}
        </div>
    );
};

export default RAMonthlyEvaluationPage;