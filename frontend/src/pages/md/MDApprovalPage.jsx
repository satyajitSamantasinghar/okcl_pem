import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiAward, FiBriefcase, FiCalendar, FiCheckCircle,
    FiChevronDown, FiChevronUp, FiClock, FiEdit3, FiEye, FiUsers,
    FiFileText, FiPenTool, FiPlus, FiStar, FiTarget, FiXCircle,
    FiRefreshCw, FiAlertTriangle
} from 'react-icons/fi';
import './MDApprovalPage.css';

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
        EDITED: { label: 'Edited', cls: 'edited', icon: <FiEdit3 /> },
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
    if (!status || status === 'PENDING' || status === 'SUBMITTED') return 0;
    if (status === 'REJECTED') return -1;
    if (status === 'APPROVED' || status === 'EDITED_AFTER_APPROVAL') return 1;
    if (status === 'RA_EVALUATED') return 2;
    if (status === 'HRD_EVALUATED') return 3;
    if (status === 'MD_EVALUATED' || status === 'COMPLETED') return 4;
    return 0;
};

const WorkflowStepper = ({ status, isReport = false }) => {
    const step = getWorkflowStep(status);
    const rejected = status === 'REJECTED';
    
    // Plans have a shorter flow: Submitted -> MD Review
    // Reports have full flow: Submitted -> RA Eval -> HRD Eval -> Finalized (MD)
    const steps = isReport ? [
        { icon: <FiFileText />, label: 'Submitted' },
        { icon: <FiStar />, label: 'RA Eval' },
        { icon: <FiCheckCircle />, label: 'HRD Eval' },
        { icon: <FiAward />, label: 'Finalized' }
    ] : [
        { icon: <FiFileText />, label: 'Submitted' },
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
                                        {r.grandTotal != null && (
                                            <div style={{ padding: '0 4px', marginBottom: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Grand Total:</span>
                                                    <strong style={{ fontSize: '1.1rem', color: 'var(--primary, #ff7a18)'}}>{r.grandTotal}/100</strong>
                                                </div>
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
        <div className="yap-page fade-in">
            {/* CTA Toolbar */}
            <div>
                <button className="yap-back-btn" onClick={() => { setSelectedView(null); resetContext(); }}>
                    <FiArrowLeft /> Back to List
                </button>
            </div>

            {/* Hero Header */}
            <div className="yap-hero">
                <div className="yap-hero-left">
                    <div className="yap-hero-avatar">{getInitials(emp?.name)}</div>
                    <div className="yap-hero-info">
                        <div className="yap-hero-name">{emp?.name}</div>
                        <div className="yap-hero-meta">
                            <span><FiStar style={{ color: 'var(--warning)' }} /> {emp?.employeeCode}</span>
                            <span><FiBriefcase /> {emp?.department || 'N/A'}</span>
                            <span><FiCalendar /> FY {year}</span>
                        </div>
                        <div className="yap-hero-badges" style={{ marginTop: '6px' }}>
                            <StatusBadge status={item.status} />
                            {!isPlan && item.grandTotal != null && (
                                <span className="yap-hero-grand-score">
                                    Grand Total: {item.grandTotal}/100
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stepper */}
            <WorkflowStepper status={item.status} isReport={!isPlan} />

            {/* Main Detail Grid */}
            <div className="yap-detail-grid">
                {/* LEFT CONTENT */}
                <div className="yap-detail-left">
                    {/* Rejection Alert */}
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

                    {isPlan ? (
                        <>
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-bg-primary"><FiTarget /></div>
                                    <div>
                                        <h3 className="yap-block-title">Yearly Plan Objectives</h3>
                                        <p className="yap-block-desc">Stated goals and objectives for the financial year</p>
                                    </div>
                                </div>
                                <div className="yap-block-body">
                                    <div className="yap-text-content">{item.planAndObjectives || 'No objectives provided.'}</div>
                                </div>
                            </div>
                            
                            {item.editHistory?.length > 0 && (
                                <div className="yap-block">
                                    <div className="yap-block-header" style={{ cursor: 'pointer' }} onClick={() => setShowHistory(!showHistory)}>
                                        <div className="yap-block-icon yap-block-bg-secondary"><FiPenTool /></div>
                                        <div>
                                            <h3 className="yap-block-title">Edit History (v{item.version})</h3>
                                            <p className="yap-block-desc">{item.editHistory.length} registered modifications</p>
                                        </div>
                                    </div>
                                    {showHistory && (
                                        <div className="yap-block-body">
                                            <ul className="yap-history-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {item.editHistory.map((edit, idx) => (
                                                    <li key={idx} style={{ padding: '12px', background: 'var(--bg-muted)', borderRadius: '8px' }}>
                                                        <strong style={{ fontSize: '0.85rem' }}><FiEdit3 /> Note:</strong> <span style={{ fontSize: '0.85rem' }}>{edit.note}</span><br/>
                                                        <small style={{ color: 'var(--text-muted)' }}>{new Date(edit.editedAt).toLocaleString()}</small>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-bg-primary"><FiBriefcase /></div>
                                    <div>
                                        <h3 className="yap-block-title">Works as per KRA</h3>
                                        <p className="yap-block-desc">Self-assessment against mapped KRA goals</p>
                                    </div>
                                </div>
                                <div className="yap-block-body">
                                    <div className="yap-text-content">{item.workKRA || 'No data provided.'}</div>
                                </div>
                            </div>

                            {item.additionalAssignments && (
                                <div className="yap-block">
                                    <div className="yap-block-header">
                                        <div className="yap-block-icon yap-block-bg-success"><FiPlus /></div>
                                        <div>
                                            <h3 className="yap-block-title">Additional Assignments</h3>
                                            <p className="yap-block-desc">Extracurricular work beyond KRA</p>
                                        </div>
                                    </div>
                                    <div className="yap-block-body">
                                        <div className="yap-text-content">{item.additionalAssignments}</div>
                                    </div>
                                </div>
                            )}
                            
                            {/* Evaluator Remarks */}
                            {(item.raRemarks || item.hrdRemarks || item.mdRemarks) && (
                                <div className="yap-block">
                                    <div className="yap-block-header">
                                        <div className="yap-block-icon yap-block-bg-accent"><FiFileText /></div>
                                        <div>
                                            <h3 className="yap-block-title">Evaluator Remarks</h3>
                                            <p className="yap-block-desc">Notes left by authorities</p>
                                        </div>
                                    </div>
                                    <div className="yap-block-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
                                         {item.raRemarks && (
                                             <div style={{ padding: '12px', background: 'rgba(255, 122, 24, 0.05)', borderRadius: '8px', borderLeft: '3px solid var(--primary)' }}>
                                                <strong style={{ fontSize: '0.8rem', color: 'var(--primary)', textTransform: 'uppercase' }}>RA Remarks:</strong> 
                                                <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>{item.raRemarks}</p>
                                            </div>
                                         )}
                                         {item.hrdRemarks && (
                                             <div style={{ padding: '12px', background: 'rgba(13, 148, 136, 0.05)', borderRadius: '8px', borderLeft: '3px solid #0d9488' }}>
                                                <strong style={{ fontSize: '0.8rem', color: '#0d9488', textTransform: 'uppercase' }}>HRD Remarks:</strong> 
                                                <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>{item.hrdRemarks}</p>
                                            </div>
                                         )}
                                         {item.mdRemarks && !isPlan && (
                                             <div style={{ padding: '12px', background: 'rgba(99, 102, 241, 0.05)', borderRadius: '8px', borderLeft: '3px solid #6366f1' }}>
                                                <strong style={{ fontSize: '0.8rem', color: '#6366f1', textTransform: 'uppercase' }}>MD Remarks:</strong> 
                                                <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>{item.mdRemarks}</p>
                                            </div>
                                         )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* RIGHT EVALUATION STICKY PANEL */}
                <div className="yap-detail-right">
                    {!isPlan && (
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
                    )}
                    
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
                </div>
            </div>
        </div>
    );
}
