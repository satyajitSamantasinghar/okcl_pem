import { useState, useEffect, useCallback } from 'react';
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
    if (Array.isArray(plan.planItems) && plan.planItems.filter(Boolean).length > 0)
        return plan.planItems.filter(Boolean);
    if (plan.planDetails)
        return plan.planDetails.split('\n').map(s => s.trim()).filter(Boolean);
    return [];
}

/* Progress tokens — consistent colours across rings, bars, badges */
function getProgressTokens(p) {
    const v = Math.min(100, Math.max(0, p || 0));
    if (v === 100) return { label: 'Completed', ring: '#16A34A', bar: '#22C55E', badgeBg: '#DCFCE7', badgeText: '#166534', border: '#16A34A', pctColor: '#16A34A', track: '#D1FAE5' };
    if (v >= 75) return { label: 'Almost done', ring: '#D97706', bar: '#F59E0B', badgeBg: '#FEF3C7', badgeText: '#92400E', border: '#D97706', pctColor: '#D97706', track: '#FDE68A' };
    if (v >= 50) return { label: 'Halfway', ring: '#EA580C', bar: '#F97316', badgeBg: '#FFEDD5', badgeText: '#9A3412', border: '#EA580C', pctColor: '#EA580C', track: '#FED7AA' };
    if (v >= 25) return { label: 'Just started', ring: '#D97706', bar: '#F59E0B', badgeBg: '#FEF3C7', badgeText: '#92400E', border: '#D97706', pctColor: '#D97706', track: '#FDE68A' };
    return { label: 'Not started', ring: '#DC2626', bar: '#EF4444', badgeBg: '#FEE2E2', badgeText: '#991B1B', border: '#DC2626', pctColor: '#DC2626', track: '#FECACA' };
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
    const result = Array.from({ length: planCount }, () => ({ achievementDetails: '', progress: 0 }));
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

/* ====================================================
   SUB-COMPONENTS
==================================================== */

/* Clean progress ring */
const ProgressRing = ({ progress, size = 46, color }) => {
    const p = Math.min(100, Math.max(0, progress || 0));
    const r = (size - 6) / 2;
    const circ = 2 * Math.PI * r;
    const dash = (p / 100) * circ;
    const tk = getProgressTokens(p);
    const ringColor = color || tk.ring;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
            style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke="#E5E7EB" strokeWidth={4.5} />
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={ringColor} strokeWidth={4.5}
                strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.5s ease' }} />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle"
                style={{
                    transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px`,
                    fontSize: size < 40 ? 8 : 9, fontWeight: 700,
                    fill: ringColor, fontFamily: 'inherit'
                }}>
                {p}%
            </text>
        </svg>
    );
};

const ProgressBar = ({ value, color, trackColor, height = 6 }) => {
    const p = Math.min(100, Math.max(0, value || 0));
    const tk = getProgressTokens(p);
    return (
        <div className="qd-bar-track" style={{ height, background: trackColor || '#E5E7EB' }}>
            <div style={{
                width: `${p}%`, height: '100%',
                background: color || tk.bar,
                borderRadius: 99, transition: 'width 0.5s ease'
            }} />
        </div>
    );
};

/* Plan card */
const PlanCard = ({ planText, planIndex, pa, hasAchievementRecord }) => {
    const p = pa ? Math.min(100, pa.progress || 0) : 0;
    const tk = getProgressTokens(p);
    const hasAchText = pa?.achievementDetails?.trim();

    return (
        <div className="qd-plan-card" style={{ borderLeftColor: tk.border }}>
            {/* Header */}
            <div className="qd-plan-top">
                <div className="qd-plan-ring-wrap">
                    <ProgressRing progress={p} size={46} color={tk.ring} />
                </div>
                <div className="qd-plan-info">
                    <div className="qd-plan-name-row">
                        <div className="qd-plan-num-chip"
                            style={{ background: tk.badgeBg, color: tk.badgeText }}>
                            {planIndex + 1}
                        </div>
                        <span className="qd-plan-name">Plan {planIndex + 1}</span>
                        <span className="qd-plan-status-badge"
                            style={{ background: tk.badgeBg, color: tk.badgeText }}>
                            {tk.label}
                        </span>
                    </div>
                    <div className="qd-plan-desc">{planText}</div>
                </div>
            </div>

            {/* Progress */}
            <div className="qd-plan-prog-section">
                <div className="qd-plan-prog-row">
                    <span className="qd-plan-prog-lbl">Progress</span>
                    <span className="qd-plan-prog-pct" style={{ color: tk.pctColor }}>
                        {p}% — {tk.label}
                    </span>
                </div>
                <ProgressBar value={p} color={tk.bar} trackColor="#E5E7EB" height={6} />
                <div className="qd-plan-markers">
                    {[0, 25, 50, 75].map(m => (
                        <span key={m} style={(p >= m && m > 0) ? { color: tk.bar, fontWeight: 600 } : (p === 0 && m === 0) ? { color: tk.bar, fontWeight: 600 } : {}}>
                            {m}%
                        </span>
                    ))}
                    <span style={p === 100 ? { color: tk.bar, fontWeight: 600 } : {}}>Done</span>
                </div>
            </div>

            {/* Achievement */}
            <div className="qd-plan-ach-section">
                <div className="qd-plan-ach-lbl">
                    <FiTrendingUp size={10} /> Achievement details
                </div>
                {!hasAchievementRecord ? (
                    <div className="qd-plan-ach-no-submission">
                        <FiClock size={11} /> No achievement submitted for this month
                    </div>
                ) : hasAchText ? (
                    <div className="qd-plan-ach-text">{pa.achievementDetails}</div>
                ) : (
                    <div className="qd-plan-ach-empty">No achievement details provided</div>
                )}
            </div>
        </div>
    );
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

    const { employee, quarter, averageScore, remarks, generatedAt, monthlyData = [] } = data;
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
            <div className="qd-body">

                {/* LEFT — scrollable timeline */}
                <div className="qd-left">
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
                                                    {m.score}/10
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
                                                        <FiTrendingUp size={10} /> Achievement {formatDateShort(m.achievement.submittedAt)}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Plans & Achievements */}
                                        {planItems.length > 0 ? (
                                            <div className="qd-tl-plans">
                                                <div className="qd-tl-plans-label">
                                                    <FiFileText size={11} />
                                                    Plans &amp; achievements
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
                                                        <div className="qd-legacy-ach-badge">Legacy Achievement</div>
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
                                                                <span>Additional achievements</span>
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
                                                    <div className="qd-tl-plans-label"><FiTrendingUp size={11} /> Achievement</div>
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

                {/* RIGHT — fixed */}
                <div className="qd-right">

                    {/* Score card */}
                    <div className="qd-score-card">
                        <div className="qd-score-top"
                            style={{ borderBottom: `2px solid ${scoreBorder}` }}>
                            <div className="qd-score-big" style={{ color: scoreColor }}>
                                {averageScore?.toFixed(1)}
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
                                            {m.score}
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