import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiFileText, FiTrendingUp, FiMessageSquare,
    FiEdit3, FiCheckCircle, FiClock, FiStar, FiSave, FiX, FiCalendar
} from 'react-icons/fi';
import './RAQuarterlyDetailPage.css';

/* ====================================================
   HELPERS
==================================================== */
function formatMonthLong(monthStr) {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-');
    return new Date(y, parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function formatMonthShort(monthStr) {
    if (!monthStr) return '';
    const [, m] = monthStr.split('-');
    return new Date(2024, parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
}
function formatYearShort(monthStr) {
    if (!monthStr) return '';
    return monthStr.split('-')[0].slice(2);
}
function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateShort(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
function formatQuarter(q) { return q?.replace('-', ' · ') || ''; }
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}
function getPlanItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.planItems) && plan.planItems.length > 0)
        return plan.planItems.map(p => typeof p === 'string' ? p : p.itemText).filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}

/* Score colour */
function getScoreColor(s) {
    if (s >= 8) return '#16A34A';
    if (s >= 6) return '#D97706';
    if (s >= 4) return '#EA580C';
    return '#DC2626';
}
function getScoreBg(s) {
    if (s >= 8) return '#DCFCE7';
    if (s >= 6) return '#FEF3C7';
    if (s >= 4) return '#FFEDD5';
    return '#FEE2E2';
}
function getScoreBorder(s) {
    if (s >= 8) return '#86EFAC';
    if (s >= 6) return '#FCD34D';
    if (s >= 4) return '#FDBA74';
    return '#FCA5A5';
}

/**
 * Smart score formatter — industry-standard trailing-zero suppression.
 * - Whole numbers  → no decimal   (10 → "10",  8 → "8")
 * - Decimal scores → 1 d.p.       (9.5 → "9.5", 7.9 → "7.9")
 * - Null / zero    → em-dash      (null/0 → "—")
 */
function formatScore(val) {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return '—';
    const rounded = Math.round(n * 10) / 10;          // round to 1 decimal place
    return rounded % 1 === 0
        ? String(Math.round(rounded))                 // whole number — drop ".0"
        : rounded.toFixed(1);                         // decimal — keep exactly 1 d.p.
}

/* Month chip palette */
const MONTH_PALETTE = {
    '01': { bg: '#DBEAFE', color: '#1D4ED8', line: '#3B82F6' },
    '02': { bg: '#D1FAE5', color: '#065F46', line: '#10B981' },
    '03': { bg: '#FEF3C7', color: '#92400E', line: '#F59E0B' },
    '04': { bg: '#FEE2E2', color: '#991B1B', line: '#EF4444' },
    '05': { bg: '#EDE9FE', color: '#4C1D95', line: '#8B5CF6' },
    '06': { bg: '#CFFAFE', color: '#164E63', line: '#06B6D4' },
    '07': { bg: '#FFEDD5', color: '#9A3412', line: '#F97316' },
    '08': { bg: '#FCE7F3', color: '#831843', line: '#EC4899' },
    '09': { bg: '#DBEAFE', color: '#1D4ED8', line: '#3B82F6' },
    '10': { bg: '#D1FAE5', color: '#065F46', line: '#10B981' },
    '11': { bg: '#FEF3C7', color: '#92400E', line: '#F59E0B' },
    '12': { bg: '#EDE9FE', color: '#4C1D95', line: '#8B5CF6' },
};
function getMonthChip(monthStr) {
    const m = monthStr?.split('-')[1] || '01';
    return MONTH_PALETTE[m] || MONTH_PALETTE['01'];
}

/* Legacy achievement parsing */
function parseLegacyPlanAch(legacyText, planCount) {
    const result = Array.from({ length: planCount }, () => ({ achievementDetails: '' }));
    if (!legacyText) return result;
    const lines = legacyText.split('\n');
    let currentIdx = -1;
    lines.forEach(line => {
        // Old blobs may carry a "[NN%]" marker; it is tolerated only so it is
        // stripped from the displayed text — the percentage is no longer used.
        const header = line.match(/^Plan\s+(\d+)\s*(?:\[\d+%\])?:\s*(.*)/i);
        if (header) {
            const idx = parseInt(header[1], 10) - 1;
            if (idx >= 0 && idx < planCount) {
                currentIdx = idx;
                result[idx].achievementDetails = header[2].trim();
            }
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
        const hasRealData = pa.some(a => (a.achievementDetails || '').trim());
        if (hasRealData) return pa;
    }
    if (ach.achievementDetails) {
        const parsed = parseLegacyPlanAch(ach.achievementDetails, planCount);
        const hasParsedData = parsed.some(a => (a.achievementDetails || '').trim());
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
        return [{ text: match[1].trim() }];
    }
    return raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('Additional:')).map(t => ({ text: t.trim() }));
}

/* ====================================================
   SUB-COMPONENTS
==================================================== */

/* Plan card — plan detail first, its progress detail directly beneath */
const PlanCard = ({ planText, planIndex, pa, hasAchievementRecord }) => {
    const progressText = (pa?.achievementDetails || '').trim();
    const state = !hasAchievementRecord ? 'idle' : progressText ? 'reported' : 'missing';
    const statusLabel = { idle: 'Pending', reported: 'Progress reported', missing: 'Not reported' }[state];

    return (
        <div className={`qd-plan-card qd-plan-card--${state}`}>
            {/* Plan detail */}
            <div className="qd-plan-top">
                <div className="qd-plan-info">
                    <div className="qd-plan-name-row">
                        <div className="qd-plan-num-chip">{planIndex + 1}</div>
                        <span className="qd-plan-name">Plan {planIndex + 1}</span>
                        <span className={`qd-plan-status-badge qd-plan-status-badge--${state}`}>{statusLabel}</span>
                    </div>
                    <div className="qd-plan-desc">{planText}</div>
                </div>
            </div>

            {/* Progress detail */}
            <div className="qd-plan-ach-section">
                <div className="qd-plan-ach-lbl">
                    <FiTrendingUp size={10} /> Progress details
                </div>
                {!hasAchievementRecord ? (
                    <div className="qd-plan-ach-no-submission">
                        <FiClock size={11} /> No progress submitted for this month
                    </div>
                ) : progressText ? (
                    <div className="qd-plan-ach-text">{progressText}</div>
                ) : (
                    <div className="qd-plan-ach-empty">No progress details provided</div>
                )}
            </div>
        </div>
    );
};

/* ====================================================
   SPLIT PANE HOOK
==================================================== */
const SPLIT_KEY = 'ra_qdp_split_pct';
const DEFAULT_PCT = 65;
const MIN_PCT = 40;
const MAX_PCT = 80;

const useSplitPane = () => {
    const [leftPct, setLeftPct] = useState(() => {
        const saved = localStorage.getItem(SPLIT_KEY);
        const n = Number(saved);
        return (n >= MIN_PCT && n <= MAX_PCT) ? n : DEFAULT_PCT;
    });
    const containerRef = useRef(null);
    const dragging = useRef(false);

    const onMouseMove = useCallback((e) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
        const clamped = Math.min(MAX_PCT, Math.max(MIN_PCT, rawPct));
        setLeftPct(clamped);
    }, []);

    const onMouseUp = useCallback(() => {
        if (!dragging.current) return;
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.style.pointerEvents = '';
        localStorage.setItem(SPLIT_KEY, String(Math.round(leftPct)));
    }, [leftPct]);

    useEffect(() => {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [onMouseMove, onMouseUp]);

    const onDividerMouseDown = useCallback((e) => {
        e.preventDefault();
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.body.style.pointerEvents = 'none';
    }, []);

    const onDividerDblClick = useCallback(() => {
        setLeftPct(DEFAULT_PCT);
        localStorage.setItem(SPLIT_KEY, String(DEFAULT_PCT));
    }, []);

    return { leftPct, containerRef, onDividerMouseDown, onDividerDblClick };
};

/* ====================================================
   MAIN PAGE
==================================================== */
const RAQuarterlyDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editingRemarks, setEditing] = useState(false);
    const [remarksText, setRemarksText] = useState('');
    const [saving, setSaving] = useState(false);

    const { leftPct, containerRef, onDividerMouseDown, onDividerDblClick } = useSplitPane();

    const fetchDetail = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/ra/quarterly-evaluations/${id}/full-detail`);
            setData(res.data);
            setRemarksText(res.data.remarks || '');
        } catch {
            toast.error('Failed to load quarterly report');
            navigate(-1);
        } finally { setLoading(false); }
    }, [id, navigate]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    const saveRemarks = async () => {
        setSaving(true);
        try {
            await api.put(`/ra/quarterly-evaluations/${id}/remarks`, { remarks: remarksText });
            toast.success('Remarks saved');
            setData(prev => ({ ...prev, remarks: remarksText, hasRemarks: !!remarksText.trim() }));
            setEditing(false);
        } catch { toast.error('Failed to save remarks'); }
        finally { setSaving(false); }
    };

    if (loading) return (
        <div className="loading-container">
            <div className="spinner" /> <p>Loading quarterly report…</p>
        </div>
    );
    if (!data) return null;

    const { employee, quarter, remarks, generatedAt, monthlyData = [] } = data;

    // BUG FIX: if the backend's stored averageScore is 0 or null (stale/missing),
    // compute it client-side from monthlyData as a reliable fallback.
    // After the backend fix this path is rarely hit, but it keeps the UI correct
    // even if the server hasn't yet self-healed the stored value.
    const storedAvg = Number(data.averageScore);
    const evaluatedMonths = monthlyData.filter(m => Number(m.score) > 0);
    const computedAvg = evaluatedMonths.length > 0
        ? evaluatedMonths.reduce((sum, m) => sum + Number(m.score), 0) / evaluatedMonths.length
        : 0;
    const averageScore = storedAvg > 0 ? storedAvg : computedAvg;

    const scoreColor = getScoreColor(averageScore);
    const scoreBg = getScoreBg(averageScore);
    const scoreBorder = getScoreBorder(averageScore);

    return (
        <div className="qd-page fade-in">

            {/* ════════ STICKY HEADER ════════ */}
            <div className="qd-sticky-header">
                <button className="qd-back-btn" onClick={() => navigate(-1)}>
                    <FiArrowLeft size={14} /> Back
                </button>
                <div className="qd-header-divider" />
                <div className="qd-header-avatar">{getInitials(employee?.name)}</div>
                <div className="qd-header-info">
                    <span className="qd-header-name">{employee?.name}</span>
                    <span className="qd-header-meta">
                        {employee?.employeeCode} · {employee?.department || 'N/A'}
                    </span>
                </div>
                <span className="qd-quarter-chip">
                    <FiCalendar size={11} style={{ flexShrink: 0 }} />
                    {formatQuarter(quarter)}
                </span>
                {data.hasRemarks
                    ? <span className="qd-status-pill qd-pill-green"><FiCheckCircle size={10} /> Remarks added</span>
                    : <span className="qd-status-pill qd-pill-amber">Remarks pending</span>
                }
            </div>

            {/* ════════ BODY ════════ */}
            <div className="qd-body" ref={containerRef}>

                {/* LEFT — scrollable timeline */}
                <div className="qd-left" style={{ width: `${leftPct}%`, flexShrink: 0 }}>
                    <div className="qd-timeline">
                        {monthlyData.map((m, idx) => {
                            const chip = getMonthChip(m.month);
                            const planItems = getPlanItems(m.plan);
                            const isLast = idx === monthlyData.length - 1;
                            const sc = getScoreColor(m.score);
                            const sb = getScoreBg(m.score);
                            const sborder = getScoreBorder(m.score);

                            return (
                                <div key={m.month} className="qd-tl-row">

                                    {/* ── Spine: dot + connecting line ── */}
                                    <div className="qd-tl-spine">
                                        <div className="qd-tl-dot"
                                            style={{ background: chip.bg, color: chip.color }}>
                                            <span className="qd-tl-dot-mon">{formatMonthShort(m.month)}</span>
                                            <span className="qd-tl-dot-yr">{formatYearShort(m.month)}</span>
                                        </div>
                                        {/*
                                          The line uses flex:1 inside a stretch-aligned row
                                          so it always fills the full height between months.
                                          background colour comes from this month's chip.line.
                                        */}
                                        {!isLast && (
                                            <div className="qd-tl-line"
                                                style={{ background: chip.line }} />
                                        )}
                                    </div>

                                    {/* ── Month body ── */}
                                    <div className="qd-tl-body">

                                        {/* Month header */}
                                        <div className="qd-tl-month-header">
                                            <span className="qd-tl-month-name">{formatMonthLong(m.month)}</span>
                                            <div className="qd-tl-month-right">
                                                <span className="qd-tl-score-pill"
                                                    style={{ background: sb, color: sc, border: `1px solid ${sborder}` }}>
                                                    {formatScore(m.score)}/10
                                                </span>
                                                {m.evaluatedAt && (
                                                    <span className="qd-tl-eval-date">
                                                        <FiCheckCircle size={10} /> Evaluated {formatDateShort(m.evaluatedAt)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* RA evaluation remark */}
                                        {m.remarks && (
                                            <div className="qd-tl-ra-remark"
                                                style={{ borderLeftColor: '#3B82F6' }}>
                                                <div className="qd-tl-remark-label">
                                                    <FiMessageSquare size={10} /> Your evaluation remark
                                                </div>
                                                <div className="qd-tl-remark-text">"{m.remarks}"</div>
                                            </div>
                                        )}

                                        {/* Timestamps */}
                                        {(m.plan?.submittedAt || m.achievement?.submittedAt) && (
                                            <div className="qd-tl-timestamps">
                                                {m.plan?.submittedAt && (
                                                    <span className="qd-ts-item qd-ts-plan">
                                                        <FiFileText size={10} /> Plan {formatDateShort(m.plan.submittedAt)}
                                                    </span>
                                                )}
                                                {m.achievement?.submittedAt && (
                                                    <span className="qd-ts-item qd-ts-ach">
                                                        <FiTrendingUp size={10} /> Progress {formatDateShort(m.achievement.submittedAt)}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Plans & Achievements */}
                                        {planItems.length > 0 ? (
                                            <div className="qd-tl-plans">
                                                <div className="qd-tl-plans-label">
                                                    <FiFileText size={11} />
                                                    Plans &amp; progress
                                                    <span className="qd-plans-count">
                                                        {planItems.length} plan{planItems.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="qd-plan-cards-list">
                                                    {(() => {
                                                        const eff = getEffectivePlanAch(m.achievement, planItems.length);
                                                        return planItems.map((planText, pi) => (
                                                            <PlanCard key={pi}
                                                                planText={planText} planIndex={pi}
                                                                pa={eff?.[pi]}
                                                                hasAchievementRecord={!!m.achievement} />
                                                        ));
                                                    })()}
                                                </div>

                                                {(m.achievement?.achievementDetails && !getEffectivePlanAch(m.achievement, planItems.length)) && (
                                                    <div className="qd-legacy-ach-box" style={{ marginTop: '10px' }}>
                                                        <div className="qd-legacy-ach-badge">Legacy progress</div>
                                                        <div className="qd-legacy-ach-text">{m.achievement.achievementDetails}</div>
                                                    </div>
                                                )}

                                                {(() => {
                                                    const items = parseAdditionalAch(m.achievement?.additionalAchievement || '');
                                                    if (!items.length) return null;
                                                    return (
                                                        <div className="qd-extras-card">
                                                            <div className="qd-extras-header">
                                                                <FiStar size={12} />
                                                                <span>Additional work with progress update</span>
                                                                <span className="qd-extras-count">{items.length} extra</span>
                                                            </div>
                                                            <div className="qd-extras-body">
                                                                {items.map((item, li) => (
                                                                    <div key={li} className="qd-extra-item">
                                                                        <div className="qd-extra-num">{li + 1}</div>
                                                                        <span className="qd-extra-text">{item.text}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        ) : (
                                            m.achievement?.achievementDetails && (
                                                <div className="qd-tl-plans">
                                                    <div className="qd-tl-plans-label"><FiTrendingUp size={11} /> Progress</div>
                                                    <div className="qd-legacy-ach-box">
                                                        <div className="qd-legacy-ach-badge">Legacy format</div>
                                                        <div className="qd-legacy-ach-text">{m.achievement.achievementDetails}</div>
                                                    </div>
                                                </div>
                                            )
                                        )}

                                        {!m.plan && (
                                            <div className="qd-no-plan-note">
                                                <FiFileText size={12} /> No plan data available for this month
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* DIVIDER */}
                <div
                    className="qd-split-divider"
                    onMouseDown={onDividerMouseDown}
                    onDoubleClick={onDividerDblClick}
                    title="Drag to resize, double-click to reset"
                />

                {/* RIGHT — fixed */}
                <div className="qd-right" style={{ flex: 1, minWidth: 0 }}>

                    {/* Score card */}
                    <div className="qd-score-card">
                        <div className="qd-score-top"
                            style={{ borderBottom: `2px solid ${scoreBorder}` }}>
                            <div className="qd-score-big" style={{ color: scoreColor }}>
                                {formatScore(averageScore)}
                                <span className="qd-score-denom">/10</span>
                            </div>
                            <div className="qd-score-label">Quarterly average</div>
                            <span className="qd-score-quarter-chip"
                                style={{ background: scoreBg, color: scoreColor, border: `1px solid ${scoreBorder}` }}>
                                {formatQuarter(quarter)}
                            </span>
                        </div>
                        <div className="qd-monthly-bars">
                            <div className="qd-monthly-bars-label">Monthly breakdown</div>
                            {monthlyData.map(m => {
                                const sc = getScoreColor(m.score);
                                const sb = getScoreBg(m.score);
                                const sbo = getScoreBorder(m.score);
                                return (
                                    <div key={m.month} className="qd-mb-row">
                                        <span className="qd-mb-label">
                                            {formatMonthShort(m.month)} '{formatYearShort(m.month)}
                                        </span>
                                        <div className="qd-mb-track">
                                            <div className="qd-mb-fill"
                                                style={{ width: `${(m.score / 10) * 100}%`, background: sc }} />
                                        </div>
                                        <span className="qd-mb-score-chip"
                                            style={{ background: sb, color: sc, border: `1px solid ${sbo}` }}>
                                            {formatScore(m.score)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Remarks card */}
                    <div className="qd-remarks-card">
                        <div className="qd-remarks-label">
                            <FiFileText size={12} /> Quarterly remarks
                        </div>
                        {editingRemarks ? (
                            <div className="qd-remarks-edit">
                                <textarea className="qd-remarks-textarea"
                                    value={remarksText}
                                    onChange={e => setRemarksText(e.target.value)}
                                    placeholder="Summarize the employee's performance for this quarter…"
                                    rows={5} autoFocus />
                                <div className="qd-remarks-actions">
                                    <button className="qd-btn-cancel"
                                        onClick={() => { setEditing(false); setRemarksText(data.remarks || ''); }}
                                        disabled={saving}>
                                        <FiX size={12} /> Cancel
                                    </button>
                                    <button className="qd-btn-save" onClick={saveRemarks} disabled={saving}>
                                        {saving ? 'Saving…' : <><FiSave size={12} /> Save</>}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="qd-remarks-view">
                                {remarks?.trim()
                                    ? <div className="qd-remarks-text">{remarks}</div>
                                    : <div className="qd-remarks-empty">No quarterly remarks added yet.</div>
                                }
                                <button className="qd-btn-edit" onClick={() => setEditing(true)}>
                                    <FiEdit3 size={12} /> {remarks ? 'Edit remarks' : 'Add remarks'}
                                </button>
                            </div>
                        )}
                    </div>

                    {generatedAt && (
                        <div className="qd-generated-pill">
                            <FiCheckCircle size={11} />
                            Generated {formatDate(generatedAt)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RAQuarterlyDetailPage;