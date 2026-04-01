import { useState, useEffect } from 'react';
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
                    <strong style={{ color: getScoreColor(p.value) }}>{p.value}/10</strong>
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
    const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));

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

    const currentYear = new Date().getFullYear();
    const availableYearsSet = new Set(Array.from({ length: 12 }, (_, i) => String(currentYear + 2 - i)));
    monthlyPlans.forEach(p => { if (p.month) availableYearsSet.add(p.month.substring(0, 4)); });
    quarterlyEvaluations.forEach(q => { if (q.quarter) availableYearsSet.add(q.quarter.split('-')[1]); });
    yearlyPlans?.forEach(y => { if (y.financialYear) availableYearsSet.add(y.financialYear.substring(0, 4)); });
    const availableYears = Array.from(availableYearsSet).sort((a, b) => b - a);

    const filteredMonths    = unifiedMonths.filter(m => m.month && m.month.startsWith(filterYear));
    const filteredQuarterly = quarterlyEvaluations.filter(q => q.quarter && q.quarter.includes(filterYear));
    const shortFilterYear   = filterYear.substring(2);
    const fyMatch = fy => fy && (fy.startsWith(filterYear) || fy.endsWith(`-${shortFilterYear}`));
    const filteredYearlyPlans   = (yearlyPlans || []).filter(y => fyMatch(y.financialYear));
    const filteredYearlyReports = (yearlyReports || []).filter(y => fyMatch(y.financialYear));
    const filteredEvals = monthlyEvaluations.filter(e => e.month && e.month.startsWith(filterYear));

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
        insights.push({ icon: <FiThumbsUp />, variant: 'positive', text: `100% evaluation completion for ${filterYear} — all plans reviewed` });
    else if (completionRate < 50 && filteredMonths.length > 1)
        insights.push({ icon: <FiInfo />, variant: 'warning', text: `Only ${completionRate}% evaluated in ${filterYear} — ${filteredMonths.filter(m => !m.isEval).length} pending review` });

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
        return (
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
            </div>
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

        const modalStatusCls = isRejected ? 'rejected'
            : isEval ? 'evaluated'
            : plan.hasAchievement ? 'achievement'
            : 'submitted';
        const modalStatusLabel = isRejected ? 'Rejected'
            : isEval ? 'Evaluated'
            : plan.hasAchievement ? 'Achievement Submitted'
            : 'Plan Submitted';

        const steps = [
            { label: 'Plan Submitted', icon: <FiFileText />,    done: true },
            { label: 'Achievement',    icon: <FiTrendingUp />,  done: plan.hasAchievement },
            { label: 'Evaluated',      icon: <FiCheckCircle />, done: isEval },
        ];

        return (
            <div className="med-overlay" onClick={() => setSelectedMonthDetail(null)}>
                <div className="med-modal" onClick={e => e.stopPropagation()}>
                    <div className="med-modal-header">
                        <div className="med-modal-header-left">
                            <div className="med-modal-avatar">{getInitials(employee.name)}</div>
                            <div className="med-modal-header-info">
                                <div className="med-modal-title-row">
                                    <h2 className="med-modal-name">Monthly Review</h2>
                                    <span className={`med-badge med-badge--${modalStatusCls}`}>
                                        {modalStatusLabel}
                                    </span>
                                </div>
                                <p className="med-modal-sub">
                                    {employee.name}&nbsp;·&nbsp;{employee.employeeCode}&nbsp;·&nbsp;{formatMonth(plan.month)}
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {canReject && (
                                <button
                                    className="med-detail-btn"
                                    style={{ color: '#DC2626', borderColor: '#FECACA', background: '#FEF2F2' }}
                                    onClick={() => { setSelectedMonthDetail(null); setRejectTarget(plan); setRejectRemarks(''); }}
                                >
                                    <FiXCircle /> Reject Plan
                                </button>
                            )}
                            <button className="med-modal-close-btn" onClick={() => setSelectedMonthDetail(null)} aria-label="Close">
                                <FiX />
                            </button>
                        </div>
                    </div>

                    <div className="med-modal-stepper">
                        {steps.map((step, i) => (
                            <div key={i} className="med-modal-stepper-item">
                                <div className={`med-modal-step-node ${step.done ? 'med-modal-step-node--done' : ''}`}>
                                    {step.icon}
                                </div>
                                <span className={`med-modal-step-label ${step.done ? 'med-modal-step-label--done' : ''}`}>
                                    {step.label}
                                </span>
                                {i < steps.length - 1 && (
                                    <div className={`med-modal-step-connector ${steps[i + 1].done ? 'med-modal-step-connector--done' : ''}`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {isRejected && (
                        <div className="med-status-banner med-status-banner--rejected">
                            <FiAlertCircle /> This plan has been rejected by MD
                        </div>
                    )}
                    {isEval && (
                        <div className="med-status-banner" style={{ background: '#F0FDF4', color: '#16A34A', borderBottomColor: '#BBF7D0' }}>
                            <FiCheckCircle /> Evaluated by RA — cannot be rejected
                        </div>
                    )}

                    <div className="med-modal-body">
                        <div className="med-modal-section">
                            <div className="med-modal-section-hd">
                                <div className="med-modal-section-icon med-modal-section-icon--blue"><FiFileText /></div>
                                <span>Monthly Plan</span>
                                <span className="med-modal-section-meta-inline" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#94A3B8' }}>
                                    <FiClock /> Submitted {new Date(plan.submittedAt).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="med-modal-section-body">
                                {plan.planDetails
                                    ? <p className="med-modal-text">{plan.planDetails}</p>
                                    : <p className="med-modal-empty-text">No plan details provided.</p>
                                }
                            </div>
                        </div>

                        <div className="med-modal-section">
                            <div className="med-modal-section-hd">
                                <div className="med-modal-section-icon med-modal-section-icon--green"><FiTrendingUp /></div>
                                <span>Achievement</span>
                                {plan.hasAchievement && ach && (
                                    <span className="med-modal-section-meta-inline" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#94A3B8' }}>
                                        <FiClock /> Submitted {new Date(ach.submittedAt).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                            <div className="med-modal-section-body">
                                {plan.hasAchievement && ach
                                    ? <p className="med-modal-text">{ach.achievementDetails || '—'}</p>
                                    : <div className="med-modal-not-submitted"><FiClock /> Achievement not yet submitted</div>
                                }
                            </div>
                        </div>

                        <div className="med-modal-section med-modal-section--last">
                            <div className="med-modal-section-hd">
                                <div className="med-modal-section-icon med-modal-section-icon--orange"><FiMessageSquare /></div>
                                <span>RA Evaluation</span>
                            </div>
                            <div className="med-modal-section-body">
                                {isEval ? (
                                    <>
                                        <div className="med-eval-score-block">
                                            <div className="med-eval-score-circle" style={{ borderColor: getScoreColor(ev.score), color: getScoreColor(ev.score) }}>
                                                <span className="med-eval-score-num">{ev.score}</span>
                                                <span className="med-eval-score-denom">/10</span>
                                            </div>
                                            <div className="med-eval-score-right">
                                                <div className="med-eval-label-row">
                                                    <span className="med-eval-label-chip" style={{ background: `${getScoreColor(ev.score)}18`, color: getScoreColor(ev.score) }}>
                                                        {getScoreLabel(ev.score)}
                                                    </span>
                                                    <span className="med-eval-pct">{ev.score * 10}% of max</span>
                                                </div>
                                                <div className="med-eval-bar-track">
                                                    <div className="med-eval-bar-fill" style={{ width: `${ev.score * 10}%`, background: getScoreColor(ev.score) }} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="med-eval-remarks-wrap">
                                            <div className="med-eval-remarks-label"><FiMessageSquare /> Remarks</div>
                                            {ev.remarks
                                                ? <p className="med-eval-remarks-text">{ev.remarks}</p>
                                                : <p className="med-modal-empty-text" style={{ margin: 0 }}>No remarks provided.</p>
                                            }
                                        </div>
                                    </>
                                ) : (
                                    <div className="med-modal-not-submitted"><FiClock /> This month has not been evaluated yet by RA.</div>
                                )}
                            </div>
                        </div>

                        {isRejected && plan.mdRemarks && (
                            <div className="med-modal-section med-modal-section--danger med-modal-section--last">
                                <div className="med-modal-section-hd">
                                    <div className="med-modal-section-icon med-modal-section-icon--danger"><FiAlertCircle /></div>
                                    <span>MD Rejection Remarks</span>
                                </div>
                                <div className="med-modal-section-body">
                                    <p className="med-modal-text med-modal-text--danger">{plan.mdRemarks}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="med-modal-footer">
                        <span className="med-modal-footer-hint"><FiEye /> Detailed view of {formatMonth(plan.month)}</span>
                        <button className="med-modal-footer-close" onClick={() => setSelectedMonthDetail(null)}>Close</button>
                    </div>
                </div>
            </div>
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
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
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
                                <p className="med-chart-empty">No evaluations yet for {filterYear}</p>
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
                                <p className="med-chart-empty">No quarterly evaluations for {filterYear}</p>
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
                            <p>No monthly reviews found for {filterYear}</p>
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
                            <p>No quarterly evaluations found for {filterYear}</p>
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
