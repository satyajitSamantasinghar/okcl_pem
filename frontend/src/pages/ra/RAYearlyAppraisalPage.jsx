import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
    FiArrowLeft, FiAward, FiBriefcase, FiCalendar, FiCheckCircle,
    FiChevronDown, FiChevronUp, FiClock, FiEdit3, FiEye,
    FiFileText, FiPenTool, FiPlus, FiStar, FiTarget, FiUsers,
    FiXCircle, FiAlertTriangle, FiTrendingUp, FiZap, FiBarChart2,
    FiRefreshCw, FiLink, FiColumns, FiInfo, FiLayers,
} from 'react-icons/fi';
import api from '../../services/api';
import './RAYearlyAppraisalPage.css';

/* ─────────────────────────────────────────────────────────
   CONSTANTS & HELPERS
───────────────────────────────────────────────────────── */

// ── Go-live FY: the first fiscal year the app was in production ──
const GO_LIVE_FY_START = 2026; // FY 2026-27 = April 2026 → March 2027

const getCurrentFinancialYear = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fy = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
    // Never default to a pre-go-live FY
    const goLiveFY = `${GO_LIVE_FY_START}-${String((GO_LIVE_FY_START + 1) % 100).padStart(2, '0')}`;
    return fy < goLiveFY ? goLiveFY : fy;
};

// Dynamically build FY options from go-live up to current FY only.
// Grows automatically every April 1 — never needs manual updating.
const buildYearOptions = () => {
    const now = new Date();
    const currentFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const opts = [];
    for (let fy = GO_LIVE_FY_START; fy <= currentFYStart; fy++) {
        opts.push(`${fy}-${String((fy + 1) % 100).padStart(2, '0')}`);
    }
    return opts.reverse(); // most recent at top, matching screenshot UI
};

const yearOptions = buildYearOptions();

const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((p) => p[0]).join('').substring(0, 2).toUpperCase();
};

const formatDate = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getStatusInfo = (status) => {
    const map = {
        PENDING: { label: 'Pending MD Review', cls: 'pending', icon: <FiClock /> },
        SUBMITTED: { label: 'Submitted', cls: 'pending', icon: <FiClock /> },
        APPROVED: { label: 'MD Approved', cls: 'approved', icon: <FiCheckCircle /> },
        REJECTED: { label: 'MD Rejected', cls: 'rejected', icon: <FiXCircle /> },
        EDITED: { label: 'Edited Before Approval', cls: 'edited', icon: <FiEdit3 /> },
        EDITED_AFTER_APPROVAL: { label: 'Edited After Approval', cls: 'edited', icon: <FiEdit3 /> },
        RA_EVALUATED: { label: 'RA Evaluated', cls: 'ra-done', icon: <FiCheckCircle /> },
        HRD_EVALUATED: { label: 'HRD Evaluated', cls: 'hrd-done', icon: <FiCheckCircle /> },
        MD_EVALUATED: { label: 'MD Evaluated', cls: 'completed', icon: <FiCheckCircle /> },
        COMPLETED: { label: 'Completed', cls: 'completed', icon: <FiCheckCircle /> },
    };
    return map[status] || { label: status || 'Unknown', cls: 'pending', icon: <FiClock /> };
};

/* Workflow stepper step index */
const getWorkflowStep = (status) => {
    if (!status || status === 'SUBMITTED') return 1;
    if (status === 'RA_EVALUATED') return 2;
    if (status === 'HRD_EVALUATED') return 3;
    if (status === 'MD_EVALUATED') return 4;
    if (status === 'COMPLETED') return 5;
    return 1;
};

const emptyEvaluationForm = {
    raWorkKRAScore: '',
    raAdditionalScore: '',
    raPersonalAttributes: '',
    raTeamAttributes: '',
    raLeadershipAttributes: '',
    raRemarks: '',
};

const buildEvaluationForm = (report) => ({
    raWorkKRAScore: report?.raWorkKraScore ?? '',
    raAdditionalScore: report?.raAdditionalScore ?? '',
    raPersonalAttributes: report?.raPersonalAttributes ?? '',
    raTeamAttributes: report?.raTeamAttributes ?? '',
    raLeadershipAttributes: report?.raLeadershipAttributes ?? '',
    raRemarks: report?.raRemarks ?? '',
});

const getNum = (v) => Number(v || 0);

const EVALUATION_FIELDS = [
    { key: 'raWorkKRAScore',         label: 'Work KRA Score',              desc: 'Based on KRA execution quality',            max: 60 },
    { key: 'raAdditionalScore',      label: 'Additional Assignment Score', desc: 'Extra responsibilities beyond KRAs',        max: 5  },
    { key: 'raPersonalAttributes',   label: 'Personal Attributes',         desc: 'Discipline, punctuality, attitude',         max: 5  },
    { key: 'raTeamAttributes',       label: 'Team Attributes',             desc: 'Collaboration and teamwork',                max: 5  },
    { key: 'raLeadershipAttributes', label: 'Leadership Attributes',       desc: 'Initiative and peer mentorship',            max: 5  },
];

const clampScoreValue = (value, max) => {
    if (value === '') return '';
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return '';
    return String(Math.min(Math.max(numeric, 0), max));
};

/* ─── PLAN BASELINE HELPERS ─────────────────────── */
const getPlanStatusInfo = (status) => {
    if (!status) return null;
    if (status === 'APPROVED') return { variant: 'approved', label: 'Approved Plan', icon: '✅', badge: 'Approved' };
    if (status === 'PENDING' || status === 'SUBMITTED') return { variant: 'pending', label: 'Pending MD Review', icon: '⏳', badge: 'Pending MD Review' };
    if (status === 'EDITED') return { variant: 'edited', label: 'Edited Before Approval', icon: '✏️', badge: 'Edited Before Approval' };
    return { variant: 'pending', label: status, icon: '⏳', badge: status };
};

/* ─────────────────────────────────────────────────────────
   MICRO COMPONENTS
───────────────────────────────────────────────────────── */

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
    const display = value != null ? value : '-';
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

/* ─────────────────────────────────────────────────────────
   SECTION 1 — REDESIGNED SUMMARY PANEL
   Three chips: Total Plans | Pending (orange-tinted) | Evaluated (green-tinted)
───────────────────────────────────────────────────────── */
const SummaryPanel = ({ plans, reports }) => {
    const pendingReports = reports.filter(
        (r) => !['RA_EVALUATED', 'HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(r.status)
    ).length;
    const doneReports = reports.filter(
        (r) => ['RA_EVALUATED', 'HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(r.status)
    ).length;

    return (
        <div className="yap-summary-panel">
            {/* Total Plans chip */}
            <div className="yap-summary-chip yap-summary-chip--neutral">
                <div className="yap-summary-chip-icon yap-summary-chip-icon--blue">
                    <FiUsers size={14} />
                </div>
                <div className="yap-summary-chip-body">
                    <div className="yap-summary-chip-count">{plans.length}</div>
                    <div className="yap-summary-chip-label">Total Plans</div>
                </div>
            </div>

            {/* Pending chip — orange-tinted */}
            <div className="yap-summary-chip yap-summary-chip--pending">
                <div className="yap-summary-chip-icon yap-summary-chip-icon--amber">
                    <FiClock size={14} />
                </div>
                <div className="yap-summary-chip-body">
                    <div className="yap-summary-chip-count">{pendingReports}</div>
                    <div className="yap-summary-chip-label">Pending</div>
                </div>
            </div>

            {/* Evaluated chip — green-tinted */}
            <div className="yap-summary-chip yap-summary-chip--evaluated">
                <div className="yap-summary-chip-icon yap-summary-chip-icon--green">
                    <FiCheckCircle size={14} />
                </div>
                <div className="yap-summary-chip-body">
                    <div className="yap-summary-chip-count">{doneReports}</div>
                    <div className="yap-summary-chip-label">Evaluated</div>
                </div>
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────────────────────
   SECTION 3 — WORKFLOW STEPPER
   Filled green (done) | Orange fill + ring (active) | Grey (upcoming)
   Connector lines: green for passed, grey for upcoming
───────────────────────────────────────────────────────── */
const WorkflowStepper = ({ status }) => {
    const step = getWorkflowStep(status);
    const steps = [
        { icon: <FiFileText />, label: 'Report\nSubmitted' },
        { icon: <FiStar />,     label: 'RA\nEvaluation' },
        { icon: <FiUsers />,    label: 'HRD\nEvaluation' },
        { icon: <FiAward />,    label: 'MD\nFinal' },
        { icon: <FiCheckCircle />, label: 'Completed' },
    ];

    return (
        <div className="yap-stepper">
            {steps.map((s, i) => {
                const done   = step > i;
                const active = step === i;
                return (
                    <div key={i} className="yap-stepper-item">
                        {i > 0 && (
                            <div className={`yap-stepper-line${done ? ' yap-stepper-line--done' : ''}`} />
                        )}
                        <div className={`yap-stepper-dot${done ? ' yap-stepper-dot--done' : ''}${active ? ' yap-stepper-dot--active' : ''}`}>
                            {done ? <FiCheckCircle /> : s.icon}
                        </div>
                        <span
                            className={`yap-stepper-label${active ? ' yap-stepper-label--active' : ''}`}
                            style={{ whiteSpace: 'pre-line', textAlign: 'center' }}
                        >
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

/* ─────────────────────────────────────────────────────────
   SECTION 6 & 17 — KRA REFERENCE TABLE
   Renders plan.kras array as a structured 4-column table.
   Used in: YearlyPlanTab (right column), Plan detail left pane,
            Compare mode left pane.
───────────────────────────────────────────────────────── */
const KRATable = ({ kras }) => {
    if (!kras || kras.length === 0) {
        return (
            <div className="yap-legacy-banner">
                <FiInfo size={15} />
                <span>No KRA data found for this plan. This may be a legacy plan submitted before the KRA update.</span>
            </div>
        );
    }

    return (
        <div className="yap-kra-table-wrapper">
            <table className="yap-kra-table">
                <thead>
                    <tr>
                        <th className="yap-kra-col--num">#</th>
                        <th className="yap-kra-col--desc">KRA Description</th>
                        <th className="yap-kra-col--target">Target / Measurable Outcome</th>
                        <th className="yap-kra-col--timeline">Timeline / Milestone</th>
                    </tr>
                </thead>
                <tbody>
                    {[...kras]
                        .sort((a, b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0))
                        .map((kra, idx) => (
                            <tr key={kra.id || idx} className={idx % 2 === 0 ? 'yap-kra-row--even' : 'yap-kra-row--odd'}>
                                <td className="yap-kra-col--num">
                                    <div className="yap-kra-num-badge">{(kra.kraIndex ?? idx) + 1}</div>
                                </td>
                                <td className="yap-kra-col--desc">{kra.description}</td>
                                <td className="yap-kra-col--target">{kra.target}</td>
                                <td className="yap-kra-col--timeline">
                                    <span className="yap-kra-timeline-badge">{kra.timeline}</span>
                                </td>
                            </tr>
                        ))}
                </tbody>
            </table>
        </div>
    );
};

/* ─────────────────────────────────────────────────────────
   SECTION 4 — KRA ACHIEVEMENT CARD LIST
   Renders appraisal.kraAssessments array as per-KRA cards.
   Used in: Left column of appraisal detail, Compare mode middle pane.
───────────────────────────────────────────────────────── */
const KRAAssessmentCardList = ({ kraAssessments }) => {
    if (!kraAssessments || kraAssessments.length === 0) {
        return (
            <div className="yap-legacy-banner">
                <FiInfo size={15} />
                <span>
                    No KRA-based self-assessment found. This may be a legacy record submitted before the KRA update.
                </span>
            </div>
        );
    }

    return (
        <div className="yap-kra-cards-list">
            {[...kraAssessments]
                .sort((a, b) => (a.kraIndex ?? 0) - (b.kraIndex ?? 0))
                .map((kra, idx) => (
                    <div key={kra.id || idx} className="yap-kra-card">
                        {/* Card Header */}
                        <div className="yap-kra-card-header">
                            <div className="yap-kra-num-badge">
                                {(kra.kraIndex ?? idx) + 1}
                            </div>
                            <div className="yap-kra-card-header-content">
                                <div className="yap-kra-card-desc">{kra.description}</div>
                                <div className="yap-kra-pills">
                                    <span className="yap-kra-pill">
                                        <strong>Target:</strong> {kra.target}
                                    </span>
                                    <span className="yap-kra-pill yap-kra-pill--timeline">
                                        {kra.timeline}
                                    </span>
                                </div>
                            </div>
                        </div>
                        {/* Card Body */}
                        <div className="yap-kra-card-body">
                            <div className="yap-kra-achievement-label">Employee Achievement</div>
                            <p className="yap-kra-achievement-text">
                                {kra.achievement && kra.achievement.trim()
                                    ? kra.achievement
                                    : <em style={{ color: 'var(--text-muted)' }}>No achievement text submitted for this KRA.</em>
                                }
                            </p>
                        </div>
                    </div>
                ))}
        </div>
    );
};

/* ─────────────────────────────────────────────────────────
   SECTION 6 — YEARLY PLAN TAB (Right column panel)
   Fixed to render plan.kras instead of plan.planAndObjectives
───────────────────────────────────────────────────────── */
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
            {/* Status badge + meta */}
            <div className="yap-plan-tab-meta">
                <span className={`yap-plan-status-badge yap-plan-status-badge--${ps.variant}`}>
                    {ps.icon} {ps.badge}
                </span>
                <span className="yap-plan-tab-fy">FY {plan.financialYear} · v{plan.version || 1}</span>
            </div>

            {/* Baseline warning inside tab */}
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

            {/* SECTION 16 FIX: KRA Reference Table instead of planAndObjectives */}
            <div className="yap-block" style={{ marginTop: 12 }}>
                <div className="yap-block-header">
                    <div className="yap-block-icon yap-block-icon--blue"><FiLayers /></div>
                    <div>
                        <h3>KRA Reference Table</h3>
                        <p>Approved yearly KRAs and targets</p>
                    </div>
                </div>
                <div style={{ padding: '14px 18px' }}>
                    <KRATable kras={plan.kras} />
                </div>
            </div>

            {/* Edit History */}
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
                                        <div className="yap-history-date">{formatDate(edit.editedAt)}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

/* ═══════════════════════════════════════
   RESIZE HOOK — VS Code-style split pane
   ═══════════════════════════════════════ */
const SPLIT_KEY = 'ra_yap_split_pct';
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
            } catch (e) {}
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

/* ─────────────────────────────────────────────────────────
   SECTION 5 — SCORING FORM (right column)
   - Live RA total progress bar above fields
   - Two-column field rows (label+desc LEFT, input+max RIGHT)
   - Over-80 warning banner
   - Disabled submit when total > 80
───────────────────────────────────────────────────────── */
const EvaluationForm = ({ evaluationForm, handleEvaluationChange, handleEvaluate, submitting, isLocked, setIsEvaluating }) => {
    const evaluationTotal = (
        getNum(evaluationForm.raWorkKRAScore)
        + getNum(evaluationForm.raAdditionalScore)
        + getNum(evaluationForm.raPersonalAttributes)
        + getNum(evaluationForm.raTeamAttributes)
        + getNum(evaluationForm.raLeadershipAttributes)
    );
    const isOver = evaluationTotal > 80;
    const progressPct = Math.min(100, (evaluationTotal / 80) * 100);

    return (
        <div className="yap-block">
            <div className="yap-block-header">
                <div className="yap-block-icon yap-block-icon--orange"><FiStar /></div>
                <div><h3>RA Evaluation Form</h3><p>Maximum total: 80 points</p></div>
            </div>
            <form className="yap-eval-form" onSubmit={handleEvaluate}>
                {/* Live RA Total Progress Bar */}
                <div className="yap-eval-progress-wrap">
                    <div className="yap-eval-progress-label">
                        <span>RA total:</span>
                        <strong className={isOver ? 'yap-eval-progress-over' : ''}>
                            {evaluationTotal} / 80
                        </strong>
                    </div>
                    <div className="yap-eval-progress-track">
                        <div
                            className={`yap-eval-progress-fill${isOver ? ' yap-eval-progress-fill--over' : ''}`}
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                </div>

                {/* Score input rows */}
                {EVALUATION_FIELDS.map(({ key, label, desc, max }) => (
                    <div key={key} className="yap-eval-field-row">
                        <div className="yap-eval-field-left">
                            <div className="yap-eval-field-label">{label}</div>
                            <div className="yap-eval-field-desc">{desc}</div>
                        </div>
                        <div className="yap-eval-field-right">
                            <input
                                type="number"
                                min="0"
                                max={max}
                                step="0.5"
                                placeholder={`0-${max}`}
                                value={evaluationForm[key]}
                                onChange={(e) => handleEvaluationChange(key, e.target.value)}
                                disabled={isLocked}
                                className="yap-eval-number-input"
                            />
                            <div className="yap-eval-field-max">max {max}</div>
                        </div>
                    </div>
                ))}

                {/* Over-80 warning banner */}
                {isOver && (
                    <div className="yap-eval-over-warning">
                        <FiAlertTriangle size={14} />
                        Total score exceeds 80. Please adjust the values.
                    </div>
                )}

                {/* RA Remarks — unchanged below score fields */}
                <div className="yap-eval-field" style={{ marginTop: 8 }}>
                    <label>RA Remarks</label>
                    <textarea
                        rows={3}
                        placeholder="Add concise appraisal remarks..."
                        value={evaluationForm.raRemarks}
                        onChange={(e) => handleEvaluationChange('raRemarks', e.target.value)}
                        disabled={isLocked}
                    />
                </div>

                <div className="yap-form-actions">
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={submitting || isOver}
                        style={isOver ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                    >
                        {submitting ? 'Submitting...' : 'Submit RA Evaluation'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setIsEvaluating(false)}>
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

/* ─────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────── */
const RAYearlyAppraisalPage = () => {
    const [activeTab, setActiveTab]         = useState('plans');
    const [year, setYear]                   = useState(getCurrentFinancialYear());
    const [plans, setPlans]                 = useState([]);
    const [reports, setReports]             = useState([]);
    const [loading, setLoading]             = useState(true);
    const [selectedView, setSelectedView]   = useState(null);
    const [showHistory, setShowHistory]     = useState(false);
    const [isEvaluating, setIsEvaluating]   = useState(false);
    const [evaluationForm, setEvaluationForm] = useState(emptyEvaluationForm);
    const [submitting, setSubmitting]       = useState(false);
    const [rightTab, setRightTab]           = useState('scoring');
    const [compareMode, setCompareMode]     = useState(false);
    const [syncScroll, setSyncScroll]       = useState(false);
    const leftCompareRef  = useRef(null);
    const midCompareRef   = useRef(null);
    const { leftPct, containerRef, onDividerMouseDown, onDividerDblClick } = useSplitPane();
    const {
        splits: compareSplits,
        containerRef: compareContainerRef,
        onDividerMouseDown: onCompareDividerMouseDown,
        onDividerDblClick: onCompareDividerDblClick,
    } = useCompareSplitPane();

    const fetchData = async () => {
        setLoading(true);
        try {
            const [plansRes, reportsRes] = await Promise.all([
                api.get('/ra/yearly-plans',   { params: { financialYear: year } }),
                api.get('/ra/yearly-reports', { params: { financialYear: year } }),
            ]);
            setPlans(plansRes.data   || []);
            setReports(reportsRes.data || []);

            if (selectedView) {
                const source = activeTab === 'plans' ? plansRes.data : reportsRes.data;
                const next = source.find((i) => i.id === selectedView.id);
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
        setCompareMode(false);
        setRightTab('scoring');
    }, [year]);

    /* Sync-scroll effect for compare mode */
    useEffect(() => {
        if (!syncScroll || !compareMode) return;
        const left = leftCompareRef.current;
        const mid  = midCompareRef.current;
        if (!left || !mid) return;
        const onLeftScroll = () => { mid.scrollTop = left.scrollTop; };
        const onMidScroll  = () => { left.scrollTop = mid.scrollTop; };
        left.addEventListener('scroll', onLeftScroll);
        mid.addEventListener('scroll', onMidScroll);
        return () => {
            left.removeEventListener('scroll', onLeftScroll);
            mid.removeEventListener('scroll', onMidScroll);
        };
    }, [syncScroll, compareMode]);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setSelectedView(null);
        setIsEvaluating(false);
        setShowHistory(false);
        setCompareMode(false);
        setRightTab('scoring');
    };

    const openDetail = (item) => {
        setSelectedView(item);
        setIsEvaluating(false);
        setShowHistory(false);
        setCompareMode(false);
        setRightTab('scoring');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const startEvaluation = (report) => {
        setIsEvaluating(true);
        setEvaluationForm(buildEvaluationForm(report));
    };

    const handleEvaluationChange = (field, value) => {
        const fieldConfig = EVALUATION_FIELDS.find((item) => item.key === field);
        const nextValue   = fieldConfig ? clampScoreValue(value, fieldConfig.max) : value;
        setEvaluationForm((c) => ({ ...c, [field]: nextValue }));
    };

    const evaluationTotal = (
        getNum(evaluationForm.raWorkKRAScore)
        + getNum(evaluationForm.raAdditionalScore)
        + getNum(evaluationForm.raPersonalAttributes)
        + getNum(evaluationForm.raTeamAttributes)
        + getNum(evaluationForm.raLeadershipAttributes)
    );

    const handleEvaluate = async (e) => {
        e.preventDefault();
        for (const field of EVALUATION_FIELDS) {
            const numeric = getNum(evaluationForm[field.key]);
            if (numeric > field.max) {
                toast.error(`${field.label} cannot exceed ${field.max}`);
                return;
            }
        }
        if (evaluationTotal > 80) { toast.error('Total score cannot exceed 80'); return; }
        setSubmitting(true);
        try {
            await api.put(`/ra/yearly-report/${selectedView.id}`, {
                raWorkKRAScore:         getNum(evaluationForm.raWorkKRAScore),
                raAdditionalScore:      getNum(evaluationForm.raAdditionalScore),
                raPersonalAttributes:   getNum(evaluationForm.raPersonalAttributes),
                raTeamAttributes:       getNum(evaluationForm.raTeamAttributes),
                raLeadershipAttributes: getNum(evaluationForm.raLeadershipAttributes),
                raRemarks:              evaluationForm.raRemarks,
            });
            toast.success('Evaluation submitted successfully');
            setIsEvaluating(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* Loading */
    if (loading && !plans.length && !reports.length) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading yearly appraisal data....</p>
            </div>
        );
    }

    /* ═══════════════════════════════════════════════
       LIST VIEW
    ═══════════════════════════════════════════════ */
    if (!selectedView) {
        const items = activeTab === 'plans' ? plans : reports;
        const pendingCount = reports.filter(
            (r) => !['RA_EVALUATED', 'HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(r.status)
        ).length;

        return (
            <div className="yap-page fade-in">

                {/* ── TOP BAR ── */}
                <div className="yap-topbar">
                    <div className="yap-topbar-left">
                        <div className="yap-topbar-eyebrow"><FiAward size={12} /> Yearly Appraisal</div>
                        <h1 className="yap-topbar-title">RA Appraisal Workspace</h1>
                        <p className="yap-topbar-desc">
                            Review employee yearly plans approved by MD and complete RA evaluation stage.
                        </p>
                    </div>
                    <div className="yap-topbar-right">
                        {/* SECTION 1 — Redesigned summary chips */}
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

                {/* ── TABS ── */}
                <div className="yap-tabs">
                    <button
                        className={`yap-tab${activeTab === 'plans' ? ' yap-tab--active' : ''}`}
                        onClick={() => handleTabChange('plans')}
                    >
                        <FiTarget size={15} />
                        Plan Review
                        <span className="yap-tab-badge">{plans.length}</span>
                    </button>
                    <button
                        className={`yap-tab${activeTab === 'reports' ? ' yap-tab--active' : ''}`}
                        onClick={() => handleTabChange('reports')}
                    >
                        <FiBarChart2 size={15} />
                        Appraisal Evaluation
                        {pendingCount > 0 && (
                            <span className="yap-tab-badge yap-tab-badge--alert">{pendingCount} pending</span>
                        )}
                        {pendingCount === 0 && (
                            <span className="yap-tab-badge">{reports.length}</span>
                        )}
                    </button>
                </div>

                {/* ── CARDS GRID ── */}
                {items.length === 0 ? (
                    <div className="yap-empty">
                        <div className="yap-empty-icon">{activeTab === 'plans' ? <FiTarget /> : <FiFileText />}</div>
                        <h3>No {activeTab === 'plans' ? 'yearly plans' : 'appraisal reports'} found</h3>
                        <p>No data available for Financial Year {year}</p>
                    </div>
                ) : (
                    <div className="yap-cards-grid">
                        {items.map((item) => {
                            const employee   = item.employee;
                            const isPlan     = activeTab === 'plans';
                            const needsEval  = !isPlan && !['RA_EVALUATED', 'HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(item.status);
                            const hasRAEval  = item.raTotalScore != null;
                            const kraCount   = !isPlan ? (item.kraAssessments?.length ?? 0) : (item.kras?.length ?? 0);

                            return (
                                <div
                                    key={item.id}
                                    className={`yap-card${needsEval ? ' yap-card--action-required' : ''}`}
                                    onClick={() => openDetail(item)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => e.key === 'Enter' && openDetail(item)}
                                >
                                    {/* ── SECTION 2: Redesigned card header ── */}
                                    <div className="yap-card-head">
                                        <div className="yap-card-avatar">{getInitials(employee?.name)}</div>
                                        <div className="yap-card-identity">
                                            <div className="yap-card-name">{employee?.name || 'Unknown'}</div>
                                            <div className="yap-card-sub">
                                                {employee?.employeeCode || 'N/A'} | FY {item.financialYear}
                                                {kraCount > 0 && (
                                                    <span className="yap-card-kra-count">
                                                        <FiLayers size={10} /> {kraCount} KRA{kraCount !== 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="yap-card-head-right">
                                            <StatusBadge status={item.status} />
                                            {needsEval && (
                                                <div className="yap-card-action-pill">
                                                    <FiZap size={10} /> Action required
                                                </div>
                                            )}
                                        </div>
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

                                    {/* SECTION 2: Three score mini-cards for report cards */}
                                    {!isPlan && (
                                        <div className="yap-score-mini-cards">
                                            <div className="yap-score-mini-card yap-score-mini-card--ra">
                                                <div className="yap-score-mini-stage">RA score</div>
                                                <div className="yap-score-mini-value">
                                                    {item.raTotalScore != null ? item.raTotalScore : '—'} / 80
                                                </div>
                                                <div className="yap-score-mini-status">
                                                    {item.raTotalScore != null ? 'RA evaluated' : 'Pending your evaluation'}
                                                </div>
                                            </div>
                                            <div className="yap-score-mini-card yap-score-mini-card--hrd">
                                                <div className="yap-score-mini-stage">HRD score</div>
                                                <div className="yap-score-mini-value">
                                                    {item.hrdTotalScore != null ? item.hrdTotalScore : '—'} / 5
                                                </div>
                                                <div className="yap-score-mini-status">
                                                    {item.hrdTotalScore != null ? 'HRD evaluated' : 'Awaiting HRD completion'}
                                                </div>
                                            </div>
                                            <div className="yap-score-mini-card yap-score-mini-card--md">
                                                <div className="yap-score-mini-stage">MD score</div>
                                                <div className="yap-score-mini-value">
                                                    {item.mdFinalScore != null ? item.mdFinalScore : '—'} / 15
                                                </div>
                                                <div className="yap-score-mini-status">
                                                    {item.mdFinalScore != null ? 'MD evaluated' : 'Awaiting MD completion'}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* SECTION 2: Full-width CTA footer */}
                                    <div className="yap-card-footer">
                                        {isPlan ? (
                                            <button
                                                className="yap-card-btn yap-card-btn--secondary"
                                                onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                                            >
                                                <FiEye size={13} /> View Plan
                                            </button>
                                        ) : !hasRAEval ? (
                                            <button
                                                className="yap-card-btn yap-card-btn--primary"
                                                onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                                            >
                                                <FiStar size={13} /> Start RA Evaluation
                                            </button>
                                        ) : (
                                            <button
                                                className="yap-card-btn yap-card-btn--secondary"
                                                onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                                            >
                                                <FiEdit3 size={13} /> View / Update Evaluation
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    /* ═══════════════════════════════════════════════
       DETAIL VIEW
    ═══════════════════════════════════════════════ */
    const item       = selectedView;
    const employee   = item.employee;
    const isPlan     = activeTab === 'plans';
    const hasRAEval  = item.raTotalScore != null;
    const isLocked   = ['MD_EVALUATED', 'COMPLETED'].includes(item.status);
    // linkedYearlyPlan is the Sequelize alias for the joined plan on the report
    const linkedPlan = !isPlan ? (item.linkedYearlyPlan || null) : null;
    const hasLinkedPlan = !!linkedPlan;

    return (
        <div className="yap-detail-page fade-in">

            {/* ── FIXED HEADER CHROME ── */}
            <div className="yap-detail-header">
                {/* Back */}
                <button
                    className="yap-back-btn"
                    onClick={() => { setSelectedView(null); setIsEvaluating(false); setCompareMode(false); }}
                >
                    <FiArrowLeft size={14} /> Back to List
                </button>

                {/* SECTION 3 — Workflow Stepper */}
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
                        {/* Compare button — report only, desktop only */}
                        {!isPlan && hasLinkedPlan && (
                            <button
                                className={`yap-compare-btn${compareMode ? ' yap-compare-btn--active' : ''}`}
                                onClick={() => setCompareMode(m => !m)}
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
                            isLocked ? (
                                <span className="yap-locked-badge">
                                    <FiCheckCircle size={13} /> Finalized - Read Only
                                </span>
                            ) : !hasRAEval ? (
                                <button className="yap-cta-btn" onClick={() => startEvaluation(item)}>
                                    <FiStar size={14} /> Start RA Evaluation
                                </button>
                            ) : (
                                <button className="yap-cta-btn yap-cta-btn--secondary" onClick={() => startEvaluation(item)}>
                                    <FiEdit3 size={14} /> View / Update Evaluation
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Phase 3: Baseline banner */}
                {!isPlan && <PlanBaselineBanner plan={linkedPlan} />}

                {/* MD Rejection Alert */}
                {item.status === 'REJECTED' && <RejectionAlert remark={item.mdRemarks} />}
            </div>

            {/* ── SCROLLABLE BODY ── */}
            {compareMode && !isPlan ? (
                /* ═══════════════════════════════════════════
                   SECTION 8 — 3-COLUMN COMPARE MODE
                ═══════════════════════════════════════════ */
                <div className="yap-compare-body" ref={compareContainerRef}>

                    {/* Left: KRA Reference Table from linkedPlan.kras */}
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
                        <div className="yap-compare-pane-hd">📋 YEARLY PLAN — KRA REFERENCE</div>
                        <div style={{ padding: '16px 20px 40px' }}>
                            {linkedPlan ? (
                                <KRATable kras={linkedPlan.kras} />
                            ) : (
                                <span className="yap-muted" style={{ display: 'block' }}>No plan linked.</span>
                            )}
                        </div>
                    </div>

                    {/* DIVIDER 1 */}
                    <div
                        className="yap-split-divider"
                        onMouseDown={(e) => onCompareDividerMouseDown(e, 'left')}
                        onDoubleClick={onCompareDividerDblClick}
                        title="Drag to resize · Double-click to reset"
                    />

                    {/* Middle: Per-KRA Achievement Cards from appraisal.kraAssessments */}
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
                            <span>📝 SELF-ASSESSMENT — KRA ACHIEVEMENTS</span>
                            <button
                                className={`yap-sync-btn${syncScroll ? ' yap-sync-btn--on' : ''}`}
                                onClick={() => setSyncScroll(s => !s)}
                                style={{ margin: '-4px 0' }}
                            >
                                <FiLink size={12} />
                                Sync Scroll: {syncScroll ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        <div style={{ padding: '16px 20px 40px' }}>
                            <KRAAssessmentCardList kraAssessments={item.kraAssessments} />
                            {/* Additional Assignments in compare middle pane */}
                            <div style={{ marginTop: 16 }}>
                                <div className="yap-additional-block">
                                    <div className="yap-additional-block-label">Additional Assignments</div>
                                    <p className="yap-additional-block-text">
                                        {item.additionalAssignments && item.additionalAssignments.trim()
                                            ? item.additionalAssignments
                                            : <em>No additional assignments reported.</em>
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* DIVIDER 2 */}
                    <div
                        className="yap-split-divider"
                        onMouseDown={(e) => onCompareDividerMouseDown(e, 'right')}
                        onDoubleClick={onCompareDividerDblClick}
                        title="Drag to resize · Double-click to reset"
                    />

                    {/* Right: Scoring sidebar — unchanged */}
                    <div className="yap-compare-pane yap-compare-pane--scoring" style={{ flex: 1, minWidth: 260 }}>
                        <div className="yap-compare-pane-hd">⭐ SCORING</div>
                        <div style={{ padding: '0 0 40px' }}>
                            {/* Score Dashboard */}
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-icon--orange"><FiTrendingUp /></div>
                                    <div><h3>Score Dashboard</h3><p>All stages</p></div>
                                </div>
                                <div className="yap-score-grid">
                                    <ScoreCard label="RA Score"    value={item.raTotalScore}  max={80}  color="primary" />
                                    <ScoreCard label="HRD Score"   value={item.hrdTotalScore} max={5}   color="teal" />
                                    <ScoreCard label="MD Score"    value={item.mdFinalScore}  max={15}  color="indigo" />
                                    <ScoreCard label="Grand Total" value={item.grandTotal}    max={100} color="success" highlight />
                                </div>
                            </div>
                            {isEvaluating ? (
                                <EvaluationForm
                                    evaluationForm={evaluationForm}
                                    handleEvaluationChange={handleEvaluationChange}
                                    handleEvaluate={handleEvaluate}
                                    submitting={submitting}
                                    isLocked={isLocked}
                                    setIsEvaluating={setIsEvaluating}
                                />
                            ) : (
                                <>
                                    {isLocked ? (
                                        <div className="yap-locked-block" style={{ margin: '12px 18px' }}>
                                            <FiCheckCircle className="yap-locked-block-icon" />
                                            <div><strong>Finalized</strong><p>No further updates allowed.</p></div>
                                        </div>
                                    ) : !hasRAEval ? (
                                        <div className="yap-cta-block" style={{ margin: '12px 18px' }}>
                                            <div className="yap-cta-block-icon"><FiStar /></div>
                                            <div className="yap-cta-block-text">
                                                <strong>Evaluation Required</strong>
                                                <p>Click to begin RA scoring.</p>
                                            </div>
                                            <button className="yap-cta-btn" onClick={() => startEvaluation(item)}>Start Evaluation</button>
                                        </div>
                                    ) : (
                                        <div className="yap-eval-edit" style={{ margin: '12px 18px' }}>
                                            <button className="yap-btn-sm yap-btn-sm--ghost" onClick={() => startEvaluation(item)}>
                                                <FiEdit3 /> View / Update Evaluation
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                /* ═══════════════════════════════════════════
                   STANDARD 2-PANE SPLIT
                ═══════════════════════════════════════════ */
                <div className="yap-detail-body" ref={containerRef}>

                    {/* LEFT — independently scrollable */}
                    <div className="yap-detail-left" style={{ flexBasis: `${leftPct}%`, flexGrow: 0, flexShrink: 0 }}>
                        {isPlan ? (
                            <>
                                {/* SECTION 7 — Plan detail left pane: KRA table instead of planAndObjectives */}
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--blue">
                                        <div className="yap-section-hd-icon"><FiLayers /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Yearly Plan KRAs</div>
                                            <div className="yap-section-hd-sub">
                                                Employee's Key Result Areas for FY {item.financialYear}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="yap-section-body" style={{ padding: '12px' }}>
                                        <KRATable kras={item.kras} />
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
                                        <div className="yap-section-body yap-text-content--approved">{item.mdRemarks}</div>
                                    </div>
                                )}

                                {/* Edit History */}
                                {item.editHistory?.length > 0 && (
                                    <div className="yap-section">
                                        <div
                                            className="yap-section-hd yap-section-hd--amber"
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => setShowHistory(!showHistory)}
                                        >
                                            <div className="yap-section-hd-icon"><FiPenTool /></div>
                                            <div>
                                                <div className="yap-section-hd-title">Edit History</div>
                                                <div className="yap-section-hd-sub">{item.editHistory.length} revision{item.editHistory.length !== 1 ? 's' : ''} recorded</div>
                                            </div>
                                            <div className="yap-toggle-icon" style={{ marginLeft: 'auto' }}>
                                                {showHistory ? <FiChevronUp /> : <FiChevronDown />}
                                            </div>
                                        </div>
                                        {showHistory && (
                                            <div className="yap-section-body">
                                                <ul className="yap-history-list" style={{ padding: 0 }}>
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
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                {/* SECTION 4 — KRA Achievement Cards (replaces workKRA text) */}
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--blue">
                                        <div className="yap-section-hd-icon"><FiLayers /></div>
                                        <div>
                                            <div className="yap-section-hd-title">KRA Self-Assessment</div>
                                            <div className="yap-section-hd-sub">
                                                Employee's self-reported achievement against each KRA
                                            </div>
                                        </div>
                                    </div>
                                    <KRAAssessmentCardList kraAssessments={item.kraAssessments} />
                                </div>

                                {/* SECTION 9 — Additional Assignments */}
                                <div className="yap-section">
                                    <div className="yap-section-hd yap-section-hd--teal">
                                        <div className="yap-section-hd-icon"><FiPlus /></div>
                                        <div>
                                            <div className="yap-section-hd-title">Additional Assignments</div>
                                            <div className="yap-section-hd-sub">Extra responsibilities handled outside the planned KRA</div>
                                        </div>
                                    </div>
                                    <div className="yap-additional-block">
                                        <p className="yap-additional-block-text">
                                            {item.additionalAssignments && item.additionalAssignments.trim()
                                                ? item.additionalAssignments
                                                : <em>No additional assignments reported.</em>
                                            }
                                        </p>
                                    </div>
                                </div>

                                {/* SECTION 10 — Evaluator Remarks History (unchanged logic) */}
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
                                            { role: 'RA Remarks',  cls: 'ra',  text: item.raRemarks  },
                                            { role: 'HRD Remarks', cls: 'hrd', text: item.hrdRemarks },
                                            { role: 'MD Remarks',  cls: 'md',  text: item.mdRemarks  },
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

                    {/* RIGHT — independently scrollable */}
                    <div className="yap-detail-right" style={{ flex: 1, minWidth: 280 }}>
                        {isPlan ? (
                            /* Plan summary sidebar — unchanged */
                            <div className="yap-block">
                                <div className="yap-block-header">
                                    <div className="yap-block-icon yap-block-icon--indigo"><FiCalendar /></div>
                                    <div><h3>Plan Summary</h3><p>Submission &amp; approval details</p></div>
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
                                {/* Right-panel tab switcher */}
                                <div className="yap-right-tabs">
                                    <button
                                        className={`yap-right-tab${rightTab === 'plan' ? ' yap-right-tab--active' : ''}`}
                                        onClick={() => setRightTab('plan')}
                                    >
                                        📋 Yearly Plan
                                    </button>
                                    <button
                                        className={`yap-right-tab${rightTab === 'scoring' ? ' yap-right-tab--active' : ''}`}
                                        onClick={() => setRightTab('scoring')}
                                    >
                                        ⭐ Scoring
                                    </button>
                                </div>

                                {rightTab === 'plan' ? (
                                    /* SECTION 6 — YearlyPlanTab with KRA table */
                                    <YearlyPlanTab
                                        plan={linkedPlan}
                                        showHistory={showHistory}
                                        setShowHistory={setShowHistory}
                                    />
                                ) : (
                                    /* SECTION 5 — Scoring Panel */
                                    <>
                                        {/* Score Dashboard */}
                                        <div className="yap-block">
                                            <div className="yap-block-header">
                                                <div className="yap-block-icon yap-block-icon--orange"><FiTrendingUp /></div>
                                                <div><h3>Score Dashboard</h3><p>Evaluation scores across all stages</p></div>
                                            </div>
                                            <div className="yap-score-grid">
                                                <ScoreCard label="RA Score"    value={item.raTotalScore}  max={80}  color="primary" />
                                                <ScoreCard label="HRD Score"   value={item.hrdTotalScore} max={5}   color="teal" />
                                                <ScoreCard label="MD Score"    value={item.mdFinalScore}  max={15}  color="indigo" />
                                                <ScoreCard label="Grand Total" value={item.grandTotal}    max={100} color="success" highlight />
                                            </div>
                                        </div>

                                        {/* SECTION 15 — Locked state banner (unchanged logic) */}
                                        {isLocked && (
                                            <div className="yap-locked-block" style={{ margin: '4px 0' }}>
                                                <FiCheckCircle className="yap-locked-block-icon" />
                                                <div>
                                                    <strong>Appraisal Finalized</strong>
                                                    <p>MD has completed evaluation. No further updates allowed.</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Evaluation form or CTA */}
                                        {!isLocked && (
                                            isEvaluating ? (
                                                <EvaluationForm
                                                    evaluationForm={evaluationForm}
                                                    handleEvaluationChange={handleEvaluationChange}
                                                    handleEvaluate={handleEvaluate}
                                                    submitting={submitting}
                                                    isLocked={isLocked}
                                                    setIsEvaluating={setIsEvaluating}
                                                />
                                            ) : !hasRAEval ? (
                                                <div className="yap-cta-block">
                                                    <div className="yap-cta-block-icon"><FiStar /></div>
                                                    <div className="yap-cta-block-text">
                                                        <strong>Evaluation Required</strong>
                                                        <p>This report is awaiting your RA-stage scoring. Click to begin.</p>
                                                    </div>
                                                    <button className="yap-cta-btn" onClick={() => startEvaluation(item)}>
                                                        Start RA Evaluation
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="yap-eval-edit">
                                                    <button className="yap-btn-sm yap-btn-sm--ghost" onClick={() => startEvaluation(item)}>
                                                        <FiEdit3 /> View / Update Evaluation
                                                    </button>
                                                </div>
                                            )
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RAYearlyAppraisalPage;
