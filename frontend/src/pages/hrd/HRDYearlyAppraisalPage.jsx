import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiAward, FiBriefcase, FiCalendar, FiCheckCircle,
    FiChevronDown, FiChevronUp, FiClock, FiEdit3, FiEye,
    FiFileText, FiPenTool, FiPlus, FiStar, FiTarget, FiUsers,
    FiXCircle, FiAlertTriangle, FiTrendingUp, FiZap, FiBarChart2,
    FiRefreshCw,
} from 'react-icons/fi';
import api from '../../services/api';
import '../ra/RAYearlyAppraisalPage.css';

/* ══════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
══════════════════════════════════════════════════════════ */
const getCurrentFinancialYear = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
};

const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];

const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((p) => p[0]).join('').substring(0, 2).toUpperCase();
};

const formatDate = (value) => {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getStatusInfo = (status) => {
    const map = {
        PENDING:              { label: 'Pending Assessment', cls: 'pending',   icon: <FiClock /> },
        SUBMITTED:            { label: 'Submitted',          cls: 'pending',   icon: <FiClock /> },
        APPROVED:             { label: 'MD Approved',        cls: 'approved',  icon: <FiCheckCircle /> },
        REJECTED:             { label: 'MD Rejected',        cls: 'rejected',  icon: <FiXCircle /> },
        EDITED:               { label: 'Edited Before Approval', cls: 'edited',    icon: <FiEdit3 /> },
        EDITED_AFTER_APPROVAL:{ label: 'Edited After Approval', cls: 'edited', icon: <FiEdit3 /> },
        RA_EVALUATED:         { label: 'RA Evaluated',       cls: 'ra-done',   icon: <FiCheckCircle /> },
        HRD_EVALUATED:        { label: 'HRD Evaluated',      cls: 'hrd-done',  icon: <FiCheckCircle /> },
        MD_EVALUATED:         { label: 'MD Evaluated',       cls: 'completed', icon: <FiCheckCircle /> },
        COMPLETED:            { label: 'Completed',          cls: 'completed', icon: <FiCheckCircle /> },
    };
    return map[status] || { label: status || 'Unknown', cls: 'pending', icon: <FiClock /> };
};

/* Workflow stepper config */
const getWorkflowStep = (status) => {
    if (!status || status === 'PENDING' || status === 'SUBMITTED') return 0;
    if (status === 'REJECTED') return -1;
    if (status === 'APPROVED' || status === 'EDITED_AFTER_APPROVAL') return 1;
    if (status === 'RA_EVALUATED') return 2;
    if (status === 'HRD_EVALUATED') return 3;
    if (status === 'MD_EVALUATED' || status === 'COMPLETED') return 4;
    return 0;
};

/* ══════════════════════════════════════════════════════════
   MICRO COMPONENTS
══════════════════════════════════════════════════════════ */

/* Status Badge */
const StatusBadge = ({ status }) => {
    const info = getStatusInfo(status);
    return (
        <span className={`yap-badge yap-badge--${info.cls}`}>
            {info.icon} {info.label}
        </span>
    );
};

/* Score Bar */
const ScoreBar = ({ value, max, color = 'primary' }) => {
    const pct = max > 0 ? Math.min(100, (Number(value || 0) / max) * 100) : 0;
    return (
        <div className="yap-scorebar">
            <div className={`yap-scorebar-fill yap-scorebar-fill--${color}`} style={{ width: `${pct}%` }} />
        </div>
    );
};

/* Score Card (dashboard view) */
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

/* Workflow Stepper */
const WorkflowStepper = ({ status }) => {
    const step = getWorkflowStep(status);
    const rejected = status === 'REJECTED';
    const steps = [
        { icon: <FiFileText />, label: 'Plan Submitted' },
        { icon: <FiCheckCircle />, label: 'MD Review' },
        { icon: <FiStar />, label: 'RA Eval' },
        { icon: <FiAward />, label: 'HRD Eval' },
        { icon: <FiAward />, label: 'Finalized' },
    ];

    return (
        <div className="yap-stepper">
            {steps.map((s, i) => {
                const done = step > i;
                const active = step === i;
                const isRejected = rejected && i === 1;
                return (
                    <div key={i} className="yap-stepper-item">
                        {i > 0 && (
                            <div className={`yap-stepper-line${done || (active && i > 0) ? ' yap-stepper-line--done' : ''}`} />
                        )}
                        <div className={`yap-stepper-dot
                            ${done ? 'yap-stepper-dot--done' : ''}
                            ${active ? 'yap-stepper-dot--active' : ''}
                            ${isRejected ? 'yap-stepper-dot--rejected' : ''}`}
                        >
                            {isRejected ? <FiXCircle /> : done ? <FiCheckCircle /> : s.icon}
                        </div>
                        <span className={`yap-stepper-label${active ? ' yap-stepper-label--active' : ''}`}>
                            {s.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

/* MD Rejection Alert */
const RejectionAlert = ({ remark }) => (
    <div className="yap-rejection-alert">
        <div className="yap-rejection-header">
            <FiAlertTriangle className="yap-rejection-icon" />
            <div>
                <div className="yap-rejection-title">Plan Rejected by MD</div>
                <div className="yap-rejection-sub">The employee needs to revise and resubmit</div>
            </div>
        </div>
        {remark && (
            <div className="yap-rejection-body">
                <span className="yap-rejection-label">MD's Reason:</span>
                <p className="yap-rejection-text">"{remark}"</p>
            </div>
        )}
    </div>
);

/* Summary Stats panel */
const SummaryPanel = ({ plans, reports }) => {
    const pendingReports = reports.filter(
        (r) => r.status === 'RA_EVALUATED'
    ).length;
    const doneReports = reports.filter(
        (r) => ['HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(r.status)
    ).length;

    return (
        <div className="yap-summary-panel">
            <div className="yap-summary-stat">
                <div className="yap-summary-icon yap-summary-icon--blue"><FiUsers /></div>
                <div>
                    <div className="yap-summary-val">{plans.length}</div>
                    <div className="yap-summary-label">Plans</div>
                </div>
            </div>
            <div className="yap-summary-stat">
                <div className="yap-summary-icon yap-summary-icon--amber"><FiClock /></div>
                <div>
                    <div className="yap-summary-val">{pendingReports}</div>
                    <div className="yap-summary-label">Pending HRD</div>
                </div>
            </div>
            <div className="yap-summary-stat">
                <div className="yap-summary-icon yap-summary-icon--green"><FiCheckCircle /></div>
                <div>
                    <div className="yap-summary-val">{doneReports}</div>
                    <div className="yap-summary-label">Evaluated</div>
                </div>
            </div>
        </div>
    );
};

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
const HRDYearlyAppraisalPage = () => {
    const [activeTab, setActiveTab]       = useState('plans');
    const [year, setYear]                 = useState(getCurrentFinancialYear());
    const [plans, setPlans]               = useState([]);
    const [reports, setReports]           = useState([]);
    const [loading, setLoading]           = useState(true);
    const [selectedView, setSelectedView] = useState(null);
    const [showHistory, setShowHistory]   = useState(false);
    
    // HRD Evaluation State
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [hrdScore, setHrdScore]         = useState('');
    const [hrdRemarks, setHrdRemarks]     = useState('');
    const [submitting, setSubmitting]     = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [plansRes, reportsRes] = await Promise.all([
                api.get('/hrd/yearly-plans',   { params: { financialYear: year } }),
                api.get('/hrd/yearly-reports', { params: { financialYear: year } }),
            ]);
            setPlans(plansRes.data   || []);
            setReports(reportsRes.data || []);

            if (selectedView) {
                const source = activeTab === 'plans' ? plansRes.data : reportsRes.data;
                const next = source.find((i) => i._id === selectedView._id);
                setSelectedView(next || null);
            }
        } catch {
            toast.error('Failed to load yearly appraisal data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setSelectedView(null);
        setIsEvaluating(false);
        setShowHistory(false);
    }, [year]);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setSelectedView(null);
        setIsEvaluating(false);
        setShowHistory(false);
    };

    const openDetail = (item) => {
        setSelectedView(item);
        setIsEvaluating(false);
        setShowHistory(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const startEvaluation = (report) => {
        setIsEvaluating(true);
        setHrdScore(report.hrdTotalScore ?? '');
        setHrdRemarks(report.hrdRemarks ?? '');
    };

    const handleEvaluate = async (e) => {
        e.preventDefault();
        const score = Number(hrdScore);
        if (score < 0 || score > 5 || hrdScore === '') {
            toast.error('HRD score must be a number between 0 and 5');
            return;
        }
        setSubmitting(true);
        try {
            await api.put(`/hrd/yearly-report/${selectedView._id}`, { 
                hrdTotalScore: score,
                hrdRemarks: hrdRemarks
            });
            toast.success('Evaluation submitted successfully!');
            setIsEvaluating(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to submit evaluation');
        } finally {
            setSubmitting(false);
        }
    };

    /* ── Loading ── */
    if (loading && !plans.length && !reports.length) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading HRD appraisal data…</p>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════
       LIST VIEW
    ══════════════════════════════════════════════════════ */
    if (!selectedView) {
        const items = activeTab === 'plans' ? plans : reports;

        return (
            <div className="yap-page fade-in">

                {/* ── Top bar ── */}
                <div className="yap-topbar">
                    <div className="yap-topbar-left">
                        <div className="yap-topbar-eyebrow"><FiAward size={12} /> HRD Yearly Appraisal</div>
                        <h1 className="yap-topbar-title">HRD Appraisal Workspace</h1>
                        <p className="yap-topbar-desc">
                            Review organization-wide yearly plans and evaluate appraisal reports across all departments.
                        </p>
                    </div>
                    <div className="yap-topbar-right">
                        <SummaryPanel plans={plans} reports={reports} />
                        <div className="yap-year-select">
                            <FiCalendar size={14} />
                            <select value={year} onChange={(e) => setYear(e.target.value)}>
                                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <button className="yap-refresh-btn" onClick={fetchData} title="Refresh">
                            <FiRefreshCw size={14} />
                        </button>
                    </div>
                </div>

                {/* ── Tabs ── */}
                <div className="yap-tabs">
                    <button
                        className={`yap-tab${activeTab === 'plans' ? ' yap-tab--active' : ''}`}
                        onClick={() => handleTabChange('plans')}
                    >
                        <FiTarget size={15} />
                        Yearly Plans
                        <span className="yap-tab-badge">{plans.length}</span>
                    </button>
                    <button
                        className={`yap-tab${activeTab === 'reports' ? ' yap-tab--active' : ''}`}
                        onClick={() => handleTabChange('reports')}
                    >
                        <FiBarChart2 size={15} />
                        Appraisal Reports
                        {reports.filter((r) => r.status === 'RA_EVALUATED').length > 0 && (
                            <span className="yap-tab-badge yap-tab-badge--alert">
                                {reports.filter((r) => r.status === 'RA_EVALUATED').length} pending HRD
                            </span>
                        )}
                        {reports.filter((r) => r.status === 'RA_EVALUATED').length === 0 && (
                            <span className="yap-tab-badge">{reports.length}</span>
                        )}
                    </button>
                </div>

                {/* ── Cards ── */}
                {items.length === 0 ? (
                    <div className="yap-empty">
                        <div className="yap-empty-icon">{activeTab === 'plans' ? <FiTarget /> : <FiFileText />}</div>
                        <h3>No {activeTab === 'plans' ? 'yearly plans' : 'appraisal reports'} found</h3>
                        <p>No data available for Financial Year {year}</p>
                    </div>
                ) : (
                    <div className="yap-cards-grid">
                        {items.map((item) => {
                            const employee = item.employeeId;
                            const isPlan   = activeTab === 'plans';
                            const needsEval = !isPlan && item.status === 'RA_EVALUATED';

                            return (
                                <div
                                    key={item._id}
                                    className={`yap-card${needsEval ? ' yap-card--action-required' : ''}`}
                                    onClick={() => openDetail(item)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => e.key === 'Enter' && openDetail(item)}
                                >
                                    {needsEval && (
                                        <div className="yap-card-action-pill">
                                            <FiZap size={10} /> Action Required
                                        </div>
                                    )}

                                    {/* Head */}
                                    <div className="yap-card-head">
                                        <div className="yap-card-avatar">{getInitials(employee?.name)}</div>
                                        <div className="yap-card-identity">
                                            <div className="yap-card-name">{employee?.name || 'Unknown'}</div>
                                            <div className="yap-card-sub">
                                                {employee?.employeeCode} · {employee?.department || 'N/A'}
                                            </div>
                                        </div>
                                        <StatusBadge status={item.status} />
                                    </div>

                                    {/* Meta chips */}
                                    <div className="yap-card-chips">
                                        <span className="yap-chip"><FiCalendar size={11} /> FY {item.financialYear}</span>
                                        {isPlan && <span className="yap-chip"><FiPenTool size={11} /> v{item.version || 1}</span>}
                                        {isPlan && <span className="yap-chip"><FiCheckCircle size={11} /> {formatDate(item.submittedAt)}</span>}
                                        {!isPlan && item.grandTotal != null && (
                                            <span className="yap-chip yap-chip--score">
                                                <FiAward size={11} /> {item.grandTotal}/100
                                            </span>
                                        )}
                                    </div>

                                    {/* Score strip for reports */}
                                    {!isPlan && (
                                        <div className="yap-card-score-strip">
                                            <span className="yap-score-chip yap-score-chip--ra">
                                                RA {item.raTotalScore ?? '—'}/80
                                            </span>
                                            <span className="yap-score-chip yap-score-chip--hrd">
                                                HRD {item.hrdTotalScore ?? '—'}/5
                                            </span>
                                            <span className="yap-score-chip yap-score-chip--md">
                                                MD {item.mdFinalScore ?? '—'}/15
                                            </span>
                                        </div>
                                    )}

                                    {/* CTA */}
                                    <div className="yap-card-footer">
                                        <button
                                            className={`yap-card-btn${needsEval ? ' yap-card-btn--primary' : ' yap-card-btn--secondary'}`}
                                            onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                                        >
                                            <FiEye size={13} />
                                            {isPlan ? 'View Plan' : needsEval ? 'Start Evaluation' : 'View Report'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════
       DETAIL VIEW
    ══════════════════════════════════════════════════════ */
    const item = selectedView;
    const employee = item.employeeId;
    const isPlan = activeTab === 'plans';
    const hasHRDEval = item.hrdTotalScore != null;
    const isLocked = ['MD_EVALUATED', 'COMPLETED'].includes(item.status);
    const canEvaluate = item.status === 'RA_EVALUATED' || (hasHRDEval && !isLocked);

    return (
        <div className="yap-detail-page fade-in">

            {/* ══ FIXED HEADER CHROME ══ */}
            <div className="yap-detail-header">
                {/* Back */}
                <button
                    className="yap-back-btn"
                    onClick={() => { setSelectedView(null); setIsEvaluating(false); }}
                >
                    <FiArrowLeft size={14} /> Back to List
                </button>

                {/* Workflow Stepper */}
                {!isPlan && <WorkflowStepper status={item.status} />}

                {/* Hero Header */}
                <div className="yap-hero">
                    <div className="yap-hero-left">
                        <div className="yap-hero-avatar">{getInitials(employee?.name)}</div>
                        <div className="yap-hero-info">
                            <div className="yap-hero-name">{employee?.name}</div>
                            <div className="yap-hero-meta">
                                <span><FiBriefcase size={12} /> {employee?.department || 'N/A'}</span>
                                <span><FiCalendar size={12} /> FY {item.financialYear}</span>
                                <span><FiUsers size={12} /> {employee?.employeeCode}</span>
                            </div>
                            <div className="yap-hero-badges">
                                <StatusBadge status={item.status} />
                                {!isPlan && item.grandTotal != null && (
                                    <span className="yap-hero-grand-score">
                                        <FiAward size={12} /> {item.grandTotal}/100 Grand Total
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="yap-hero-right">
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
                            canEvaluate && !hasHRDEval ? (
                                <button className="yap-cta-btn" onClick={() => startEvaluation(item)}>
                                    <FiStar size={14} /> Start HRD Evaluation
                                </button>
                            ) : canEvaluate && hasHRDEval ? (
                                <button className="yap-cta-btn yap-cta-btn--secondary" onClick={() => startEvaluation(item)}>
                                    <FiEdit3 size={14} /> Update Evaluation
                                </button>
                            ) : null
                        )}
                    </div>
                </div>

                {/* MD Rejection Alert */}
                {item.status === 'REJECTED' && (
                    <RejectionAlert remark={item.mdRemarks} />
                )}
            </div>

            {/* ══ SCROLLABLE SPLIT-PANE BODY ══ */}
            <div className="yap-detail-body">

                {/* LEFT — independently scrollable */}
                <div className="yap-detail-left">
                    {isPlan ? (
                        <>
                            {/* Plan Objectives */}
                            <div className="yap-section">
                                <div className="yap-section-hd yap-section-hd--blue">
                                    <div className="yap-section-hd-icon"><FiTarget /></div>
                                    <div>
                                        <div className="yap-section-hd-title">Yearly Plan Objectives</div>
                                        <div className="yap-section-hd-sub">Employee's focus areas and goals for FY {item.financialYear}</div>
                                    </div>
                                </div>
                                <div className="yap-section-body">
                                    {item.planAndObjectives
                                        ? <pre className="yap-pre">{item.planAndObjectives}</pre>
                                        : <span className="yap-muted">No objectives submitted.</span>}
                                </div>
                            </div>

                            {/* MD Remarks (non-rejection) */}
                            {item.mdRemarks && item.status !== 'REJECTED' && (
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--green">
                                        <div className="yap-section-hd-icon"><FiCheckCircle /></div>
                                        <div>
                                            <div className="yap-section-hd-title">MD Remarks</div>
                                            <div className="yap-section-hd-sub">Feedback from the Managing Director</div>
                                        </div>
                                    </div>
                                    <div className="yap-section-body yap-text-content--approved">
                                        {item.mdRemarks}
                                    </div>
                                </div>
                            )}

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
                                            <div className="yap-section-hd-title">Edit History</div>
                                            <div className="yap-section-hd-sub">{item.editHistory.length} revision{item.editHistory.length !== 1 ? 's' : ''} recorded</div>
                                        </div>
                                        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                                            {showHistory ? <FiChevronUp /> : <FiChevronDown />}
                                        </div>
                                    </div>
                                    {showHistory && (
                                        <ul className="yap-history-list">
                                            {item.editHistory.map((edit, i) => (
                                                <li key={i} className="yap-history-item">
                                                    <div className="yap-history-num">{i + 1}</div>
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
                                        <div className="yap-section-hd-title">Work Done Against KRA</div>
                                        <div className="yap-section-hd-sub">Employee's self-reported delivery against yearly targets</div>
                                    </div>
                                </div>
                                <div className="yap-section-body">
                                    {item.workKRA
                                        ? <pre className="yap-pre">{item.workKRA}</pre>
                                        : <span className="yap-muted">No self-assessment submitted.</span>}
                                </div>
                            </div>

                            {/* Additional Assignments */}
                            <div className="yap-section">
                                <div className="yap-section-hd yap-section-hd--teal">
                                    <div className="yap-section-hd-icon"><FiPlus /></div>
                                    <div>
                                        <div className="yap-section-hd-title">Additional Assignments</div>
                                        <div className="yap-section-hd-sub">Extra responsibilities handled outside the planned KRA</div>
                                    </div>
                                </div>
                                <div className="yap-section-body">
                                    {item.additionalAssignments
                                        ? <pre className="yap-pre">{item.additionalAssignments}</pre>
                                        : <span className="yap-muted">No additional assignments recorded.</span>}
                                </div>
                            </div>

                            {/* Evaluator Remarks */}
                            {(item.raRemarks || item.hrdRemarks || item.mdRemarks) && (
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--purple">
                                        <div className="yap-section-hd-icon"><FiFileText /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Evaluator Remarks</div>
                                            <div className="yap-section-hd-sub">Feedback from RA, HRD and MD stages</div>
                                        </div>
                                    </div>
                                    {[
                                        { role: 'RA Remarks', cls: 'ra', text: item.raRemarks },
                                        { role: 'HRD Remarks', cls: 'hrd', text: item.hrdRemarks },
                                        { role: 'MD Remarks', cls: 'md', text: item.mdRemarks },
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

                {/* RIGHT — Sidebar */}
                <div className="yap-detail-right">
                    {isPlan ? (
                        /* Plan summary sidebar */
                        <div className="yap-block">
                            <div className="yap-block-header">
                                <div className="yap-block-icon yap-block-icon--indigo"><FiCalendar /></div>
                                <div><h3>Plan Summary</h3><p>Submission & approval details</p></div>
                            </div>
                            <div className="yap-side-stack">
                                {[
                                    { label: 'Financial Year', value: item.financialYear },
                                    { label: 'Version',        value: `v${item.version || 1}` },
                                    { label: 'Submitted',      value: formatDate(item.submittedAt) },
                                    { label: 'Current Status', value: getStatusInfo(item.status).label },
                                ].map((r) => (
                                    <div key={r.label} className="yap-side-row">
                                        <span className="yap-side-label">{r.label}</span>
                                        <span className="yap-side-val">{r.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Score Dashboard */}
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-icon--orange"><FiTrendingUp /></div>
                                    <div><h3>Score Dashboard</h3><p>Evaluation scores across stages</p></div>
                                </div>
                                <div className="yap-score-grid">
                                    <ScoreCard label="RA Score"    value={item.raTotalScore}  max={80} color="primary" />
                                    <ScoreCard label="HRD Score"   value={item.hrdTotalScore} max={5}  color="teal"    />
                                    <ScoreCard label="MD Score"    value={item.mdFinalScore}  max={15} color="indigo"  />
                                    <ScoreCard label="Grand Total" value={item.grandTotal}    max={100} color="success" highlight />
                                </div>
                            </div>

                            {/* ── Evaluation Form or CTA ── */}
                            {isEvaluating ? (
                                <div className="yap-block">
                                    <div className="yap-block-header">
                                        <div className="yap-block-icon yap-block-icon--teal"><FiStar /></div>
                                        <div>
                                            <h3>HRD Evaluation Form</h3>
                                            <p>Discretionary Score (max 5)</p>
                                        </div>
                                    </div>

                                    <form className="yap-eval-form" onSubmit={handleEvaluate}>
                                        <div className="yap-eval-field">
                                            <label>HRD Discretionary Score</label>
                                            <span className="yap-eval-hint">Evaluate the employee's overall performance.</span>
                                            <input
                                                type="number"
                                                min="0"
                                                max="5"
                                                step="0.5"
                                                placeholder="Score out of 5"
                                                value={hrdScore}
                                                onChange={(e) => setHrdScore(e.target.value)}
                                            />
                                        </div>

                                        <div className="yap-eval-field" style={{ marginTop: 16 }}>
                                            <label>HRD Remarks</label>
                                            <textarea
                                                rows={3}
                                                placeholder="Add concise appraisal remarks…"
                                                value={hrdRemarks}
                                                onChange={(e) => setHrdRemarks(e.target.value)}
                                            />
                                        </div>

                                        <div className="yap-form-actions" style={{ marginTop: '16px' }}>
                                            <button type="submit" className="yap-card-btn yap-card-btn--primary" disabled={submitting}>
                                                {submitting ? 'Submitting…' : 'Submit Evaluation'}
                                            </button>
                                            <button type="button" className="yap-card-btn yap-card-btn--secondary" onClick={() => setIsEvaluating(false)}>
                                                Cancel
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            ) : (
                                /* Start/Update CTA block */
                                !hasHRDEval && canEvaluate ? (
                                    <div className="yap-cta-block">
                                        <div className="yap-cta-block-icon" style={{ background: 'rgba(13, 148, 136, 0.1)', color: '#0d9488' }}>
                                            <FiStar />
                                        </div>
                                        <div className="yap-cta-block-text">
                                            <strong>Evaluation Required</strong>
                                            <p>This report is awaiting your HRD-stage scoring (out of 5). Click to begin.</p>
                                        </div>
                                        <button className="yap-cta-btn" style={{ background: '#0d9488' }} onClick={() => startEvaluation(item)}>
                                            Start Evaluation
                                        </button>
                                    </div>
                                ) : hasHRDEval && !isLocked ? (
                                    <div className="yap-eval-edit">
                                        <button className="yap-btn-sm yap-btn-sm--ghost" onClick={() => startEvaluation(item)}>
                                            <FiEdit3 /> Update Evaluation
                                        </button>
                                    </div>
                                ) : !canEvaluate && !hasHRDEval ? (
                                    <div className="yap-cta-block" style={{ borderStyle: 'solid', borderColor: 'var(--border-default)', background: 'var(--bg-muted)' }}>
                                        <div className="yap-cta-block-icon" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>
                                            <FiClock />
                                        </div>
                                        <div className="yap-cta-block-text">
                                            <strong>Waiting for RA</strong>
                                            <p>This report cannot be evaluated until the Reporting Authority has completed their assessment.</p>
                                        </div>
                                    </div>
                                ) : null
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HRDYearlyAppraisalPage;
