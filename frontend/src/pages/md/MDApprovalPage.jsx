import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiAward, FiBriefcase, FiCalendar, FiCheckCircle,
    FiChevronDown, FiChevronUp, FiClock, FiEdit3, FiEye, FiUsers,
    FiFileText, FiPenTool, FiPlus, FiStar, FiTarget, FiXCircle,
    FiRefreshCw, FiAlertTriangle, FiColumns, FiBarChart2, FiInfo
} from 'react-icons/fi';
import '../ra/RAYearlyAppraisalPage.css';

/* ══════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
══════════════════════════════════════════════════════════ */
const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
};

const formatDate = (value) => {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];

const getStatusInfo = (status) => {
    const map = {
        PENDING: { label: 'Pending MD Review', cls: 'pending', icon: <FiClock /> },
        SUBMITTED: { label: 'Submitted', cls: 'pending', icon: <FiClock /> },
        APPROVED: { label: 'MD Approved', cls: 'approved', icon: <FiCheckCircle /> },
        REJECTED: { label: 'MD Rejected', cls: 'rejected', icon: <FiXCircle /> },
        EDITED: { label: 'Edited Before Approval', cls: 'edited', icon: <FiEdit3 /> },
        EDITED_AFTER_APPROVAL: { label: 'Edited After Approval', cls: 'edited', icon: <FiEdit3 /> },
        RA_EVALUATED: { label: 'RA Evaluated', cls: 'ra-done', icon: <FiCheckCircle /> },
        HRD_EVALUATED: { label: 'HRD Evaluated (Ready)', cls: 'hrd-done', icon: <FiCheckCircle /> },
        MD_EVALUATED: { label: 'MD Evaluated', cls: 'completed', icon: <FiCheckCircle /> },
        COMPLETED: { label: 'Completed', cls: 'completed', icon: <FiCheckCircle /> },
    };
    return map[status] || { label: status || 'Unknown', cls: 'pending', icon: <FiClock /> };
};

/* Workflow Stepper */
const getWorkflowStep = (status) => {
    if (!status || status === 'SUBMITTED') return 1;
    if (status === 'RA_EVALUATED') return 2;
    if (status === 'HRD_EVALUATED') return 3;
    if (status === 'MD_EVALUATED') return 4;
    if (status === 'COMPLETED') return 5;

    // For plans
    if (status === 'PENDING') return 0;
    if (status === 'REJECTED') return -1;
    if (status === 'APPROVED' || status === 'EDITED_AFTER_APPROVAL') return 1;

    return 1;
};

const getPlanStatusInfo = (status) => {
    if (!status) return null;
    if (status === 'APPROVED') return {
        variant: 'approved',
        label: 'Approved Plan',
        icon: '✅',
        badge: 'Approved',
    };
    if (status === 'PENDING' || status === 'SUBMITTED') return {
        variant: 'pending',
        label: 'Pending MD Review',
        icon: '⏳',
        badge: 'Pending MD Review',
    };
    if (status === 'EDITED') return {
        variant: 'edited',
        label: 'Edited Before Approval',
        icon: '✏️',
        badge: 'Edited Before Approval',
    };
    return { variant: 'pending', label: status, icon: '⏳', badge: status };
};

/* Phase 3 — baseline banner shown below hero */
const PlanBaselineBanner = ({ plan }) => {
    if (!plan) {
        return (
            <div className="yap-baseline-banner yap-baseline-banner--neutral">
                <FiInfo size={14} />
                <span>ℹ️ No yearly plan linked. Evaluating based on self-reported KRA only.</span>
            </div>
        );
    }
    const s = plan.status;
    if (s === 'APPROVED') {
        return (
            <div className="yap-baseline-banner yap-baseline-banner--approved">
                <FiCheckCircle size={14} />
                <span>✅ Evaluated against approved yearly plan (FY {plan.financialYear}, v{plan.version || 1})</span>
            </div>
        );
    }
    return (
        <div className="yap-baseline-banner yap-baseline-banner--warning">
            <FiAlertTriangle size={14} />
            <span>⚠️ Yearly plan is still pending MD approval. You are evaluating against an unconfirmed baseline.</span>
        </div>
    );
};

const WorkflowStepper = ({ status, isReport = false }) => {
    const step = getWorkflowStep(status);
    const rejected = status === 'REJECTED';

    const steps = isReport ? [
        { icon: <FiFileText />, label: 'Report Submitted' },
        { icon: <FiStar />, label: 'RA Evaluation' },
        { icon: <FiUsers />, label: 'HRD Evaluation' },
        { icon: <FiAward />, label: 'MD Final' },
        { icon: <FiCheckCircle />, label: 'Completed' },
    ] : [
        { icon: <FiFileText />, label: 'Plan Submitted' },
        { icon: <FiCheckCircle />, label: 'MD Review' }
    ];

    return (
        <div className="yap-stepper">
            {steps.map((s, i) => {
                const done = step > i;
                const active = step === i;
                const isRejected = rejected && i === 1;
                return (
                    <div key={i} className="yap-stepper-item">
                        {i > 0 && <div className={`yap-stepper-line${done || (active && i > 0) ? ' yap-stepper-line--done' : ''}`} />}
                        <div className={`yap-stepper-dot
                            ${done ? 'yap-stepper-dot--done' : ''}
                            ${active ? 'yap-stepper-dot--active' : ''}
                            ${isRejected ? 'yap-stepper-dot--rejected' : ''}`}
                        >
                            {isRejected ? <FiXCircle /> : done ? <FiCheckCircle /> : s.icon}
                        </div>
                        <span className={`yap-stepper-label${active ? ' yap-stepper-label--active' : ''}`}>{s.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

/* Micro Components */
const StatusBadge = ({ status }) => {
    const info = getStatusInfo(status);
    return (
        <span className={`yap-badge yap-badge--${info.cls}`}>
            {info.icon} {info.label}
        </span>
    );
};

const ScoreBar = ({ value, max, color = 'primary' }) => {
    const pct = max > 0 ? Math.min(100, (Number(value || 0) / max) * 100) : 0;
    return (
        <div className="yap-scorebar">
            <div className={`yap-scorebar-fill yap-scorebar-fill--${color}`} style={{ width: `${pct}%` }} />
        </div>
    );
};

const ScoreCard = ({ label, value, max, color = 'primary', highlight = false }) => {
    const display = value != null ? value : '—';
    const pct = value != null && max > 0 ? Math.round((value / max) * 100) : null;
    return (
        <div className={`yap-scorecard${highlight ? ' yap-scorecard--highlight' : ''}`}>
            <div className={`yap-scorecard-top yap-scorecard-top--${color}`}>
                <span className="yap-scorecard-label">{label}</span>
                {pct !== null && <span className="yap-scorecard-pct">{pct}%</span>}
            </div>
            <div className="yap-scorecard-val">
                <strong>{display}</strong>
                <span>/{max}</span>
            </div>
            <ScoreBar value={value} max={max} color={color} />
        </div>
    );
};

const YearlyPlanTab = ({ plan, showHistory, setShowHistory }) => {
    if (!plan) {
        return (
            <div className="yap-plan-tab-empty">
                <div className="yap-plan-tab-empty-icon"><FiFileText /></div>
                <p>No yearly plan was linked when this appraisal was submitted.</p>
                <span>Evaluate based on the KRA text provided by the employee.</span>
            </div>
        );
    }
    const ps = getPlanStatusInfo(plan.status);
    return (
        <div className="yap-plan-tab">
            <div className="yap-plan-tab-meta">
                <span className={`yap-plan-status-badge yap-plan-status-badge--${ps.variant}`}>
                    {ps.icon} {ps.badge}
                </span>
                <span className="yap-plan-tab-fy">FY {plan.financialYear} · v{plan.version || 1}</span>
            </div>

            {plan.status !== 'APPROVED' && (
                <div className="yap-plan-tab-warning">
                    <FiAlertTriangle size={13} />
                    Yearly plan is still pending MD approval. You are evaluating against an unconfirmed baseline.
                </div>
            )}
            {plan.status === 'APPROVED' && (
                <div className="yap-plan-tab-approved">
                    <FiCheckCircle size={13} />
                    Approved plan — reliable baseline
                </div>
            )}

            <div className="yap-block" style={{ marginTop: 12 }}>
                <div className="yap-block-header">
                    <div className="yap-block-icon yap-block-icon--blue"><FiTarget /></div>
                    <div><h3>Plan & Objectives</h3><p>Submitted yearly goals</p></div>
                </div>
                <div style={{ padding: '14px 18px', fontSize: '0.875rem', lineHeight: 1.8 }}>
                    {plan.planAndObjectives
                        ? <pre className="yap-pre">{plan.planAndObjectives}</pre>
                        : <span className="yap-muted">No objectives submitted.</span>}
                </div>
            </div>

            {plan.editHistory?.length > 0 && (
                <div className="yap-block" style={{ marginTop: 10 }}>
                    <div
                        className="yap-block-header yap-block-header--clickable"
                        onClick={() => setShowHistory(!showHistory)}
                    >
                        <div className="yap-block-icon yap-block-icon--amber"><FiPenTool /></div>
                        <div>
                            <h3>Edit History</h3>
                            <p>{plan.editHistory.length} revision{plan.editHistory.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="yap-toggle-icon">{showHistory ? <FiChevronUp /> : <FiChevronDown />}</div>
                    </div>
                    {showHistory && (
                        <ul className="yap-history-list">
                            {plan.editHistory.map((edit, i) => (
                                <li key={i} className="yap-history-item">
                                    <div className="yap-history-num">{i + 1}</div>
                                    <div>
                                        <div className="yap-history-note">{edit.note || 'Plan updated'}</div>
                                        <div className="yap-history-date">{new Date(edit.editedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};/* ══════════════════════════════════════════════════════════
   RESIZE HOOK
══════════════════════════════════════════════════════════ */
const SPLIT_KEY = 'md_yap_split_pct';
const DEFAULT_PCT = 68;
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

const COMPARE_SPLIT_KEY = 'pes_yap_compare_split';
const MIN_COMPARE_PCT = 20;

const useCompareSplitPane = () => {
    const [splits, setSplits] = useState(() => {
        const saved = localStorage.getItem(COMPARE_SPLIT_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.left >= MIN_COMPARE_PCT && parsed.mid >= MIN_COMPARE_PCT) return parsed;
            } catch (e) { }
        }
        return { left: 33.33, mid: 33.33 };
    });

    const containerRef = useRef(null);
    const draggingRef = useRef(null);

    const onMouseMove = useCallback((e) => {
        if (!draggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const rawPct = ((e.clientX - rect.left) / rect.width) * 100;

        setSplits(prev => {
            let next = { ...prev };
            if (draggingRef.current === 'left') {
                next.left = Math.min(Math.max(MIN_COMPARE_PCT, rawPct), 100 - prev.mid - MIN_COMPARE_PCT);
            } else if (draggingRef.current === 'right') {
                const midPct = rawPct - prev.left;
                next.mid = Math.min(Math.max(MIN_COMPARE_PCT, midPct), 100 - prev.left - MIN_COMPARE_PCT);
            }
            return next;
        });
    }, []);

    const onMouseUp = useCallback(() => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.style.pointerEvents = '';
        setSplits(current => {
            localStorage.setItem(COMPARE_SPLIT_KEY, JSON.stringify(current));
            return current;
        });
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [onMouseMove, onMouseUp]);

    const onDividerMouseDown = useCallback((e, divider) => {
        e.preventDefault();
        draggingRef.current = divider;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.body.style.pointerEvents = 'none';
    }, []);

    const onDividerDblClick = useCallback(() => {
        const def = { left: 33.33, mid: 33.33 };
        setSplits(def);
        localStorage.setItem(COMPARE_SPLIT_KEY, JSON.stringify(def));
    }, []);

    return { splits, containerRef, onDividerMouseDown, onDividerDblClick };
};


/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
export default function MDApprovalPage() {
    const [activeTab, setActiveTab] = useState('plans');
    const [year, setYear] = useState('2025-26');
    const [plans, setPlans] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);

    const [selectedView, setSelectedView] = useState(null);
    const [showHistory, setShowHistory] = useState(false);

    // Form logic
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false); // For plans
    const [mdRemarks, setMdRemarks] = useState('');
    const [mdScore, setMdScore] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Compare Mode states
    const [compareMode, setCompareMode] = useState(false);
    const [syncScroll, setSyncScroll] = useState(false);
    const leftCompareRef = useRef(null);
    const midCompareRef = useRef(null);
    const [rightTab, setRightTab] = useState('scoring');

    const { leftPct, containerRef, onDividerMouseDown, onDividerDblClick } = useSplitPane();
    const {
        splits: compareSplits,
        containerRef: compareContainerRef,
        onDividerMouseDown: onCompareDividerMouseDown,
        onDividerDblClick: onCompareDividerDblClick
    } = useCompareSplitPane();

    const fetchData = async () => {
        setLoading(true);
        try {
            const [plansRes, reportsRes] = await Promise.all([
                api.get('/md/yearly-plans', { params: { financialYear: year } }),
                api.get('/md/yearly-reports', { params: { financialYear: year } })
            ]);
            setPlans(plansRes.data);
            setReports(reportsRes.data);

            if (selectedView) {
                const arr = activeTab === 'plans' ? plansRes.data : reportsRes.data;
                const updatedItem = arr.find(item => item._id === selectedView._id);
                setSelectedView(updatedItem || null);
            }
        } catch {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setSelectedView(null);
    }, [year]);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setSelectedView(null);
        resetContext();
    };

    const resetContext = () => {
        setIsEvaluating(false);
        setIsRejecting(false);
        setMdRemarks('');
        setMdScore('');
        setShowHistory(false);
    };

    // Plans submission
    const handlePlanStatus = async (status) => {
        if (status === 'REJECTED' && !mdRemarks.trim()) {
            toast.error('Remarks are required for rejection');
            return;
        }
        setSubmitting(true);
        try {
            const decision = status === 'APPROVED' ? 'APPROVE' : 'REJECT';
            await api.put(`/md/yearly-plan/${selectedView._id}`, { decision, mdRemarks });
            toast.success(`Plan ${status.toLowerCase()} successfully`);
            resetContext();
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Action failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleReportEvaluate = async (e) => {
        e.preventDefault();
        const score = Number(mdScore);
        if (score < 0 || score > 15) {
            toast.error('MD Final Score must be between 0 and 15');
            return;
        }
        setSubmitting(true);
        try {
            await api.put(`/md/yearly-report/${selectedView._id}`, { mdFinalScore: score, mdRemarks });
            toast.success('Evaluation submitted successfully!');
            resetContext();
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* ── LIST VIEW ── */
    if (!selectedView) {
        return (
            <div className="yap-page fade-in">

                {/* Header */}
                <div className="yap-topbar">
                    <div className="yap-topbar-left">
                        <span className="yap-topbar-eyebrow">YEARLY EVALUATION WORKFLOW</span>
                        <h1 className="yap-topbar-title">MD Approval &amp; Evaluation</h1>
                        <p className="yap-topbar-desc">Approve organization yearly plans and finalize appraisal ratings for FY {year}</p>
                    </div>
                    <div className="yap-topbar-right">
                        <div className="yap-year-select">
                            <FiCalendar />
                            <select value={year} onChange={(e) => setYear(e.target.value)}>
                                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <button className="yap-refresh-btn" onClick={fetchData} title="Refresh">
                            <FiRefreshCw className={loading ? 'yap-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Summary Panels */}
                <div className="yap-summary-panel">
                    <div className="yap-summary-stat">
                        <div className="yap-summary-icon yap-summary-icon--blue"><FiUsers /></div>
                        <div>
                            <div className="yap-summary-val">{plans.length}</div>
                            <div className="yap-summary-label">Total Plans</div>
                        </div>
                    </div>
                    <div className="yap-summary-stat">
                        <div className="yap-summary-icon yap-summary-icon--green"><FiFileText /></div>
                        <div>
                            <div className="yap-summary-val">{reports.length}</div>
                            <div className="yap-summary-label">Total Reports</div>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="yap-tabs">
                    <button className={`yap-tab ${activeTab === 'plans' ? 'yap-tab--active' : ''}`} onClick={() => handleTabChange('plans')}>
                        <FiTarget /> Yearly Plans <span className="yap-tab-badge">{plans.length}</span>
                    </button>
                    <button className={`yap-tab ${activeTab === 'reports' ? 'yap-tab--active' : ''}`} onClick={() => handleTabChange('reports')}>
                        <FiFileText /> Appraisal Reports <span className="yap-tab-badge">{reports.length}</span>
                    </button>
                </div>

                {loading && !plans.length && !reports.length ? (
                    <div className="yap-loading"><div className="spinner" /> Loading Data...</div>
                ) : (
                    <div className="yap-cards-grid">
                        {activeTab === 'plans' && (
                            plans.length === 0 ? (
                                <div className="yap-empty">
                                    <div className="yap-empty-icon"><FiTarget /></div>
                                    <h3>No Yearly Plans found</h3>
                                    <p>No plans have been submitted for FY {year}</p>
                                </div>
                            ) : plans.map(p => {
                                const emp = p.employeeId;
                                return (
                                    <div key={p._id} className="yap-card" onClick={() => setSelectedView(p)}>
                                        <div className="yap-card-head">
                                            <div className="yap-card-avatar">{getInitials(emp?.name)}</div>
                                            <div className="yap-card-identity">
                                                <div className="yap-card-name" title={emp?.name}>{emp?.name}</div>
                                                <div className="yap-card-sub">{emp?.employeeCode} • {emp?.department || 'N/A'}</div>
                                            </div>
                                        </div>
                                        <div className="yap-card-chips">
                                            <StatusBadge status={p.status} />
                                        </div>
                                        <div className="yap-card-footer">
                                            <button className="yap-card-btn yap-card-btn--secondary">View Plan &rarr;</button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        {activeTab === 'reports' && (
                            reports.length === 0 ? (
                                <div className="yap-empty">
                                    <div className="yap-empty-icon"><FiFileText /></div>
                                    <h3>No Appraisal Reports found</h3>
                                    <p>No reports have been submitted for FY {year}</p>
                                </div>
                            ) : reports.map(r => {
                                const emp = r.employeeId;
                                return (
                                    <div key={r._id} className="yap-card" onClick={() => setSelectedView(r)}>
                                        <div className="yap-card-head">
                                            <div className="yap-card-avatar">{getInitials(emp?.name)}</div>
                                            <div className="yap-card-identity">
                                                <div className="yap-card-name" title={emp?.name}>{emp?.name}</div>
                                                <div className="yap-card-sub">{emp?.employeeCode} • {emp?.department || 'N/A'}</div>
                                            </div>
                                        </div>
                                        <div className="yap-card-chips">
                                            <StatusBadge status={r.status} />
                                        </div>
                                        <div className="yap-card-score-strip">
                                            {r.raTotalScore != null && <span className="yap-score-chip yap-score-chip--ra">RA: {r.raTotalScore}/80</span>}
                                            {r.hrdTotalScore != null && <span className="yap-score-chip yap-score-chip--hrd">HRD: {r.hrdTotalScore}/5</span>}
                                            {r.mdFinalScore != null && <span className="yap-score-chip yap-score-chip--md">MD: {r.mdFinalScore}/15</span>}
                                        </div>
                                        {r.grandTotal != null ? (
                                            <div style={{ padding: '0 4px', marginBottom: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Grand Total:</span>
                                                    <strong style={{ fontSize: '1.1rem', color: 'var(--primary, #ff7a18)' }}>{r.grandTotal}/100</strong>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ padding: '4px 4px 8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                                <FiClock size={12} />
                                                <span>
                                                    {r.raTotalScore == null
                                                        ? 'Awaiting RA Evaluation'
                                                        : r.hrdTotalScore == null
                                                            ? 'Awaiting HRD Evaluation'
                                                            : 'Awaiting MD Evaluation'}
                                                </span>
                                            </div>
                                        )}
                                        <div className="yap-card-footer">
                                            <button className="yap-card-btn yap-card-btn--secondary">
                                                {['COMPLETED', 'MD_EVALUATED'].includes(r.status) ? 'View Report' : 'Evaluate Report'} &rarr;
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        );
    }

    /* ── DETAIL VIEW ── */
    const item = selectedView;
    const emp = item.employeeId;
    const isPlan = activeTab === 'plans';

    const canReviewPlan = isPlan && item.status !== 'APPROVED';
    const isCompleted = ['COMPLETED', 'MD_EVALUATED'].includes(item.status);
    const canEvaluateReport = !isPlan && item.status === 'HRD_EVALUATED';

    return (
        <div className="yap-detail-page fade-in">

            {/* ══ FIXED HEADER CHROME ══ */}
            <div className="yap-detail-header">
                {/* Back */}
                <button className="yap-back-btn" onClick={() => { setSelectedView(null); resetContext(); }}>
                    <FiArrowLeft size={14} /> Back to List
                </button>

                {/* Workflow Stepper */}
                <WorkflowStepper status={item.status} isReport={!isPlan} />

                {/* Hero Header */}
                <div className="yap-hero">
                    <div className="yap-hero-left">
                        <div className="yap-hero-avatar">{getInitials(emp?.name)}</div>
                        <div className="yap-hero-info">
                            <div className="yap-hero-name">{emp?.name}</div>
                            <div className="yap-hero-meta">
                                <span><FiUsers size={12} /> {emp?.employeeCode}</span>
                                <span><FiBriefcase size={12} /> {emp?.department || 'N/A'}</span>
                                <span><FiCalendar size={12} /> FY {year}</span>
                            </div>
                            <div className="yap-hero-badges">
                                <StatusBadge status={item.status} />
                                {!isPlan && item.grandTotal != null && (
                                    <span className="yap-hero-grand-score">
                                        <FiAward size={12} /> Grand Total: {item.grandTotal}/100
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="yap-hero-right">
                        {!isPlan && item.yearlyPlanId && (
                            <button
                                className={`yap-compare-btn${compareMode ? ' yap-compare-btn--active' : ''}`}
                                onClick={() => setCompareMode(m => !m)}
                                title="Toggle Compare Mode"
                            >
                                {compareMode ? <FiXCircle size={14} /> : <FiColumns size={14} />}
                                {compareMode ? '✖ Exit Compare Mode' : '📊 Compare with Plan'}
                            </button>
                        )}
                        {isPlan ? (
                            <div className="yap-hero-meta-stack">
                                <div className="yap-hero-meta-item">
                                    <span>Submitted</span>
                                    <strong>{formatDate(item.submittedAt)}</strong>
                                </div>
                                <div className="yap-hero-meta-item">
                                    <span>Version</span>
                                    <strong>v{item.version || 1}</strong>
                                </div>
                            </div>
                        ) : (
                            isCompleted ? (
                                <span className="yap-locked-badge">
                                    <FiCheckCircle size={13} /> Finalized — Read Only
                                </span>
                            ) : canEvaluateReport ? (
                                <button className="yap-cta-btn" onClick={() => { setIsEvaluating(true); setMdScore(item.mdFinalScore || ''); setMdRemarks(item.mdRemarks || ''); }}>
                                    <FiAward size={14} /> Evaluate Report
                                </button>
                            ) : null
                        )}
                    </div>
                </div>

                {/* Phase 3: Baseline banner */}
                {!isPlan && <PlanBaselineBanner plan={item.yearlyPlanId} />}

                {/* MD Rejection Alert */}
                {item.status === 'REJECTED' && (
                    <div className="yap-rejection-alert">
                        <div className="yap-rejection-header">
                            <FiAlertTriangle className="yap-rejection-icon" />
                            <div>
                                <div className="yap-rejection-title">Plan Rejected by MD</div>
                                <div className="yap-rejection-sub">The employee needs to revise and resubmit</div>
                            </div>
                        </div>
                        {item.mdRemarks && (
                            <div className="yap-rejection-body">
                                <span className="yap-rejection-label">MD's Reason:</span>
                                <p className="yap-rejection-text">"{item.mdRemarks}"</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ══ SCROLLABLE SPLIT-PANE BODY ══ */}
            {compareMode && !isPlan ? (
                /* ═══ 3-COLUMN COMPARE MODE ═══ */
                <div className="yap-compare-body" ref={compareContainerRef}>

                    {/* Left: Yearly Plan pane */}
                    <div
                        className="yap-compare-pane yap-compare-pane--plan"
                        ref={leftCompareRef}
                        style={{ flexBasis: `${compareSplits.left}%`, flexGrow: 0, flexShrink: 0 }}
                        onScroll={(e) => {
                            if (!syncScroll || !midCompareRef.current) return;
                            if (Math.abs(midCompareRef.current.scrollTop - e.target.scrollTop) > 5) {
                                midCompareRef.current.scrollTop = e.target.scrollTop;
                            }
                        }}
                    >
                        <div className="yap-compare-pane-hd">📋 YEARLY PLAN</div>
                        {item.yearlyPlanId?.planAndObjectives
                            ? <pre className="yap-pre" style={{ padding: '16px 20px' }}>{item.yearlyPlanId.planAndObjectives}</pre>
                            : <span className="yap-muted" style={{ padding: 20, display: 'block' }}>No plan objectives linked.</span>
                        }
                    </div>

                    {/* DIVIDER 1 */}
                    <div
                        className="yap-split-divider"
                        onMouseDown={(e) => onCompareDividerMouseDown(e, 'left')}
                        onDoubleClick={onCompareDividerDblClick}
                        title="Drag to resize · Double-click to reset"
                    />

                    {/* Middle: Appraisal Report pane */}
                    <div
                        className="yap-compare-pane yap-compare-pane--report"
                        ref={midCompareRef}
                        style={{ flexBasis: `${compareSplits.mid}%`, flexGrow: 0, flexShrink: 0 }}
                        onScroll={(e) => {
                            if (!syncScroll || !leftCompareRef.current) return;
                            if (Math.abs(leftCompareRef.current.scrollTop - e.target.scrollTop) > 5) {
                                leftCompareRef.current.scrollTop = e.target.scrollTop;
                            }
                        }}
                    >
                        <div className="yap-compare-pane-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>📝 APPRAISAL REPORT</span>
                            <button
                                className={`yap-sync-btn${syncScroll ? ' yap-sync-btn--on' : ''}`}
                                onClick={() => setSyncScroll(s => !s)}
                                style={{ margin: '-4px 0' }}
                            >
                                <FiRefreshCw size={12} />
                                Sync Scroll: {syncScroll ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        <div style={{ padding: '0 20px 40px' }}>
                            <div className="yap-section">
                                <div className="yap-section-hd yap-section-hd--blue">
                                    <div className="yap-section-hd-icon"><FiBriefcase /></div>
                                    <div>
                                        <div className="yap-section-hd-title">Works as per KRA</div>
                                        <div className="yap-section-hd-sub">Self-assessment against mapped KRA goals</div>
                                    </div>
                                </div>
                                <div className="yap-section-body">
                                    {item.workKRA
                                        ? <pre className="yap-pre">{item.workKRA}</pre>
                                        : <span className="yap-muted">No data provided.</span>}
                                </div>
                            </div>

                            {item.additionalAssignments && (
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--teal">
                                        <div className="yap-section-hd-icon"><FiPlus /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Additional Assignments</div>
                                            <div className="yap-section-hd-sub">Extracurricular work beyond KRA</div>
                                        </div>
                                    </div>
                                    <div className="yap-section-body">
                                        <pre className="yap-pre">{item.additionalAssignments}</pre>
                                    </div>
                                </div>
                            )}

                            {(item.raRemarks || item.hrdRemarks) && (
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--purple">
                                        <div className="yap-section-hd-icon"><FiFileText /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Evaluator Remarks</div>
                                            <div className="yap-section-hd-sub">Notes left by authorities</div>
                                        </div>
                                    </div>
                                    {[
                                        { role: 'RA Remarks', cls: 'ra', text: item.raRemarks },
                                        { role: 'HRD Remarks', cls: 'hrd', text: item.hrdRemarks },
                                    ].filter(r => r.text).map(({ role, cls, text }) => (
                                        <div key={cls} className={`yap-remark-item yap-remark-item--${cls}`}>
                                            <div className="yap-remark-item-hd">{role}</div>
                                            <div className="yap-remark-item-body">{text}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* DIVIDER 2 */}
                    <div
                        className="yap-split-divider"
                        onMouseDown={(e) => onCompareDividerMouseDown(e, 'right')}
                        onDoubleClick={onCompareDividerDblClick}
                        title="Drag to resize · Double-click to reset"
                    />

                    {/* Right: Scoring sidebar */}
                    <div className="yap-compare-pane yap-compare-pane--scoring" style={{ flex: 1, minWidth: 260 }}>
                        <div className="yap-compare-pane-hd">⭐ SCORING</div>
                        <div style={{ padding: '0 0 40px' }}>
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div>
                                        <h3 className="yap-block-title">Score Dashboard</h3>
                                        <p className="yap-block-desc">Current valuation standings</p>
                                    </div>
                                </div>
                                <div className="yap-block-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <ScoreCard label="RA Final Score" value={item.raTotalScore} max={80} color="primary" />
                                    <ScoreCard label="HRD Score" value={item.hrdTotalScore} max={5} color="secondary" />
                                    <ScoreCard label="MD Score" value={item.mdFinalScore} max={15} color="success" highlight />
                                </div>
                            </div>

                            <div className="yap-block yap-eval-sticky">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-bg-success"><FiAward /></div>
                                    <div>
                                        <h3 className="yap-block-title">MD Final Appraisal</h3>
                                        <p className="yap-block-desc">Provide final score (Max 15)</p>
                                    </div>
                                </div>
                                <div className="yap-block-body">
                                    {isEvaluating ? (
                                        <form onSubmit={handleReportEvaluate} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Score (Max 15)<span style={{ color: 'var(--error)' }}>*</span></label>
                                                <input
                                                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontFamily: 'inherit' }}
                                                    type="number" min="0" max="15" step="0.5"
                                                    required
                                                    value={mdScore}
                                                    onChange={(e) => setMdScore(e.target.value)}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Remarks</label>
                                                <textarea
                                                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-default)', width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                                                    rows="3"
                                                    placeholder="Optional remarks..."
                                                    value={mdRemarks}
                                                    onChange={(e) => setMdRemarks(e.target.value)}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button type="submit" className="yap-cta-btn" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting}>
                                                    {submitting ? 'Saving...' : 'Submit Score'}
                                                </button>
                                                <button type="button" className="yap-cta-btn yap-cta-btn--secondary" onClick={resetContext}>Cancel</button>
                                            </div>
                                        </form>
                                    ) : (
                                        <div style={{ padding: '16px' }}>
                                            {isCompleted ? (
                                                <div style={{ padding: '12px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <FiCheckCircle /> MD Evaluation Finalized. All scoring completed.
                                                </div>
                                            ) : canEvaluateReport ? (
                                                <button className="yap-cta-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setIsEvaluating(true); setMdScore(item.mdFinalScore || ''); setMdRemarks(item.mdRemarks || ''); }}>
                                                    <FiAward /> Evaluate Report
                                                </button>
                                            ) : (
                                                <div style={{ padding: '12px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <FiClock /> Evaluation pending HRD submission.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="yap-detail-body" ref={containerRef}>
                    {/* LEFT — independently scrollable */}
                    <div className="yap-detail-left" style={{ flexBasis: `${leftPct}%`, flexGrow: 0, flexShrink: 0 }}>
                        {isPlan ? (
                            <>
                                {/* Plan Objectives */}
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--blue">
                                        <div className="yap-section-hd-icon"><FiTarget /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Yearly Plan Objectives</div>
                                            <div className="yap-section-hd-sub">Stated goals and objectives for the financial year</div>
                                        </div>
                                    </div>
                                    <div className="yap-section-body">
                                        {item.planAndObjectives
                                            ? <pre className="yap-pre">{item.planAndObjectives}</pre>
                                            : <span className="yap-muted">No objectives provided.</span>}
                                    </div>
                                </div>

                                {/* Edit History */}
                                {item.editHistory?.length > 0 && (
                                    <div className="yap-section">
                                        <div
                                            className="yap-section-hd yap-section-hd--amber"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setShowHistory(!showHistory)}
                                        >
                                            <div className="yap-section-hd-icon"><FiPenTool /></div>
                                            <div style={{ flex: 1 }}>
                                                <div className="yap-section-hd-title">Edit History (v{item.version})</div>
                                                <div className="yap-section-hd-sub">{item.editHistory.length} registered modifications</div>
                                            </div>
                                            <div style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                                                {showHistory ? <FiChevronUp /> : <FiChevronDown />}
                                            </div>
                                        </div>
                                        {showHistory && (
                                            <ul className="yap-history-list">
                                                {item.editHistory.map((edit, idx) => (
                                                    <li key={idx} className="yap-history-item">
                                                        <div className="yap-history-num">{idx + 1}</div>
                                                        <div>
                                                            <div className="yap-history-note">{edit.note || 'Plan updated'}</div>
                                                            <div className="yap-history-date">{formatDate(edit.editedAt)}</div>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                {/* Work KRA */}
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--blue">
                                        <div className="yap-section-hd-icon"><FiBriefcase /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Works as per KRA</div>
                                            <div className="yap-section-hd-sub">Self-assessment against mapped KRA goals</div>
                                        </div>
                                    </div>
                                    <div className="yap-section-body">
                                        {item.workKRA
                                            ? <pre className="yap-pre">{item.workKRA}</pre>
                                            : <span className="yap-muted">No data provided.</span>}
                                    </div>
                                </div>

                                {/* Additional Assignments */}
                                {item.additionalAssignments && (
                                    <div className="yap-section">
                                        <div className="yap-section-hd yap-section-hd--teal">
                                            <div className="yap-section-hd-icon"><FiPlus /></div>
                                            <div>
                                                <div className="yap-section-hd-title">Additional Assignments</div>
                                                <div className="yap-section-hd-sub">Extracurricular work beyond KRA</div>
                                            </div>
                                        </div>
                                        <div className="yap-section-body">
                                            <pre className="yap-pre">{item.additionalAssignments}</pre>
                                        </div>
                                    </div>
                                )}

                                {/* Evaluator Remarks */}
                                {(item.raRemarks || item.hrdRemarks || (item.mdRemarks && !isPlan)) && (
                                    <div className="yap-section">
                                        <div className="yap-section-hd yap-section-hd--purple">
                                            <div className="yap-section-hd-icon"><FiFileText /></div>
                                            <div>
                                                <div className="yap-section-hd-title">Evaluator Remarks</div>
                                                <div className="yap-section-hd-sub">Notes left by authorities</div>
                                            </div>
                                        </div>
                                        {[
                                            { role: 'RA Remarks', cls: 'ra', text: item.raRemarks },
                                            { role: 'HRD Remarks', cls: 'hrd', text: item.hrdRemarks },
                                            { role: 'MD Remarks', cls: 'md', text: !isPlan ? item.mdRemarks : null },
                                        ].filter(r => r.text).map(({ role, cls, text }) => (
                                            <div key={cls} className={`yap-remark-item yap-remark-item--${cls}`}>
                                                <div className="yap-remark-item-hd">{role}</div>
                                                <div className="yap-remark-item-body">{text}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* DIVIDER */}
                    <div
                        className="yap-split-divider"
                        onMouseDown={onDividerMouseDown}
                        onDoubleClick={onDividerDblClick}
                        title="Drag to resize · Double-click to reset"
                    />

                    {/* RIGHT EVALUATION STICKY PANEL */}
                    <div className="yap-detail-right" style={{ flex: 1, minWidth: 280 }}>
                        {isPlan ? (
                            <>
                                {/* PLAN ACTION BOX */}
                                <div className="yap-block">
                                    <div className="yap-block-header">
                                        <div className="yap-block-icon yap-block-bg-primary"><FiCheckCircle /></div>
                                        <div>
                                            <h3 className="yap-block-title">MD Plan Evaluation</h3>
                                            <p className="yap-block-desc">Approve or reject the employee's plan</p>
                                        </div>
                                    </div>
                                    <div className="yap-block-body">
                                        {isEvaluating ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                {isRejecting ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Remarks <span style={{ color: 'var(--error)' }}>*</span></label>
                                                        <textarea
                                                            style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--error)', width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                                                            rows="4"
                                                            placeholder="Why is this rejected?..."
                                                            value={mdRemarks}
                                                            onChange={(e) => setMdRemarks(e.target.value)}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div style={{ padding: '12px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '8px', fontSize: '0.9rem', borderLeft: '3px solid var(--success)' }}>
                                                        You are about to approve this yearly plan. No remarks required.
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button
                                                        className={`yap-cta-btn ${isRejecting ? 'yap-cta-btn--secondary' : ''}`}
                                                        style={isRejecting ? { background: 'var(--error)', color: '#fff', borderColor: 'var(--error)' } : {}}
                                                        onClick={() => handlePlanStatus(isRejecting ? 'REJECTED' : 'APPROVED')}
                                                        disabled={submitting || (isRejecting && !mdRemarks.trim())}
                                                    >
                                                        {submitting ? 'Saving...' : isRejecting ? 'Confirm Rejection' : 'Confirm Approval'}
                                                    </button>
                                                    <button className="yap-cta-btn yap-cta-btn--secondary" onClick={resetContext}>Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                {canReviewPlan ? (
                                                    <div style={{ display: 'flex', gap: '10px' }}>
                                                        <button className="yap-cta-btn" style={{ background: 'var(--success)', flex: 1, justifyContent: 'center' }} onClick={() => { setIsEvaluating(true); setIsRejecting(false); }}>
                                                            <FiCheckCircle /> Approve
                                                        </button>
                                                        <button className="yap-cta-btn" style={{ background: 'var(--error)', flex: 1, justifyContent: 'center' }} onClick={() => { setIsEvaluating(true); setIsRejecting(true); }}>
                                                            <FiXCircle /> Reject
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ padding: '12px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <FiCheckCircle /> Plan process concluded.
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="yap-right-tabs">
                                    <button className={"yap-right-tab" + (rightTab === 'plan' ? ' yap-right-tab--active' : '')} onClick={() => setRightTab('plan')}>
                                        📋 Yearly Plan
                                    </button>
                                    <button className={"yap-right-tab" + (rightTab === 'scoring' ? ' yap-right-tab--active' : '')} onClick={() => setRightTab('scoring')}>
                                        ⭐ Scoring
                                    </button>
                                </div>

                                {rightTab === 'plan' ? (
                                    <YearlyPlanTab plan={item.yearlyPlanId} showHistory={showHistory} setShowHistory={setShowHistory} />
                                ) : (
                                    <>
                                        <div className="yap-block">
                                            <div className="yap-block-header">
                                                <div>
                                                    <h3 className="yap-block-title">Score Dashboard</h3>
                                                    <p className="yap-block-desc">Current valuation standings</p>
                                                </div>
                                            </div>
                                            <div className="yap-block-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                <ScoreCard label="RA Final Score" value={item.raTotalScore} max={80} color="primary" />
                                                <ScoreCard label="HRD Score" value={item.hrdTotalScore} max={5} color="secondary" />
                                                <ScoreCard label="MD Score" value={item.mdFinalScore} max={15} color="success" highlight />
                                            </div>
                                        </div>

                                        {/* REPORT ACTION BOX */}
                                        <div className="yap-block yap-eval-sticky">
                                            <div className="yap-block-header">
                                                <div className="yap-block-icon yap-block-bg-success"><FiAward /></div>
                                                <div>
                                                    <h3 className="yap-block-title">MD Final Appraisal</h3>
                                                    <p className="yap-block-desc">Provide final score (Max 15)</p>
                                                </div>
                                            </div>
                                            <div className="yap-block-body">
                                                {isEvaluating ? (
                                                    <form onSubmit={handleReportEvaluate} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                            <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Score (Max 15)<span style={{ color: 'var(--error)' }}>*</span></label>
                                                            <input
                                                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontFamily: 'inherit' }}
                                                                type="number" min="0" max="15" step="0.5"
                                                                required
                                                                value={mdScore}
                                                                onChange={(e) => setMdScore(e.target.value)}
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                            <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Remarks</label>
                                                            <textarea
                                                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-default)', width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                                                                rows="3"
                                                                placeholder="Optional remarks..."
                                                                value={mdRemarks}
                                                                onChange={(e) => setMdRemarks(e.target.value)}
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button type="submit" className="yap-cta-btn" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting}>
                                                                {submitting ? 'Saving...' : 'Submit Score'}
                                                            </button>
                                                            <button type="button" className="yap-cta-btn yap-cta-btn--secondary" onClick={resetContext}>Cancel</button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <div style={{ padding: '16px' }}>
                                                        {isCompleted ? (
                                                            <div style={{ padding: '12px', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <FiCheckCircle /> MD Evaluation Finalized. All scoring completed.
                                                            </div>
                                                        ) : canEvaluateReport ? (
                                                            <button className="yap-cta-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setIsEvaluating(true); setMdScore(item.mdFinalScore || ''); setMdRemarks(item.mdRemarks || ''); }}>
                                                                <FiAward /> Evaluate Report
                                                            </button>
                                                        ) : (
                                                            <div style={{ padding: '12px', background: 'var(--warning-bg)', color: 'var(--warning)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <FiClock /> Waiting for HRD Evaluation to conclude.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
