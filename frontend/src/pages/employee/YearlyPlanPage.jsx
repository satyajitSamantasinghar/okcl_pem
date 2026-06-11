import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiAlertCircle,
    FiAlertTriangle,
    FiCheckCircle,
    FiChevronDown,
    FiChevronUp,
    FiClock,
    FiDownload,
    FiEdit3,
    FiEye,
    FiFileText,
    FiFilter,
    FiRefreshCw,
    FiSave,
    FiSearch,
    FiSend,
    FiTarget,
    FiX,
} from 'react-icons/fi';
import './YearlyPlanPage.css';
import KRATable from './KRATable';
import KRAAssessmentCards from './KRAAssessmentCards';

const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];
const PAGE_SIZE = 5;
const DEFAULT_KRA = () => [{ description: '', target: '', timeline: '' }];

const PLAN_STATUS_OPTIONS = [
    { value: 'ALL', label: 'All Status' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
];

const REPORT_STATUS_OPTIONS = [
    { value: 'ALL', label: 'All Status' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'RA_EVALUATED', label: 'RA Evaluated' },
    { value: 'HRD_EVALUATED', label: 'HRD Evaluated' },
    { value: 'MD_EVALUATED', label: 'MD Evaluated' },
    { value: 'COMPLETED', label: 'Completed' },
];

const SORT_OPTIONS = [
    { value: 'latest', label: 'Latest first' },
    { value: 'oldest', label: 'Oldest first' },
];

function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function getPlanStatusInfo(status) {
    const map = {
        DRAFT: { label: 'Draft', cls: 'draft', icon: <FiSave /> },
        PENDING: { label: 'Pending Review', cls: 'pending', icon: <FiClock /> },
        APPROVED: { label: 'Approved', cls: 'approved', icon: <FiCheckCircle /> },
        REJECTED: { label: 'Rejected', cls: 'rejected', icon: <FiAlertCircle /> },
    };
    return map[status] || { label: status || 'Unknown', cls: 'draft', icon: <FiClock /> };
}

function getReportStatusInfo(status) {
    const map = {
        DRAFT: { label: 'Draft', cls: 'draft', icon: <FiSave /> },
        SUBMITTED: { label: 'Submitted', cls: 'pending', icon: <FiClock /> },
        RA_EVALUATED: { label: 'RA Evaluated', cls: 'review', icon: <FiCheckCircle /> },
        HRD_EVALUATED: { label: 'HRD Evaluated', cls: 'review', icon: <FiCheckCircle /> },
        MD_EVALUATED: { label: 'MD Evaluated', cls: 'review', icon: <FiCheckCircle /> },
        COMPLETED: { label: 'Completed', cls: 'approved', icon: <FiCheckCircle /> },
    };
    return map[status] || { label: status || 'Submitted', cls: 'pending', icon: <FiClock /> };
}

function getRAStatusInfo(report) {
    const isDone = report?.raTotalScore != null || ['RA_EVALUATED', 'HRD_EVALUATED', 'MD_EVALUATED', 'COMPLETED'].includes(report?.status);
    return isDone
        ? { label: 'Evaluated', cls: 'approved', icon: <FiCheckCircle /> }
        : { label: 'Awaiting Review', cls: 'pending', icon: <FiClock /> };
}

function getPlanLastUpdated(plan) {
    const lastRevision = plan?.revisionLog?.length ? plan.revisionLog[plan.revisionLog.length - 1]?.revisedAt : null;
    const lastEdit = plan?.editHistory?.length ? plan.editHistory[plan.editHistory.length - 1]?.editedAt : null;
    return lastRevision || lastEdit || plan?.submittedAt;
}

function getSearchTextForPlan(plan) {
    const kraText = Array.isArray(plan.kras) ? plan.kras.map(k => `${k.description} ${k.target} ${k.timeline}`).join(' ') : '';
    return normalizeText([
        plan.financialYear,
        plan.status,
        plan.version,
        kraText,
        plan.mdRemarks,
    ].join(' '));
}

function getSearchTextForReport(report) {
    // Support both old workKRA (legacy) and new kraAssessments
    const kraText = Array.isArray(report.kraAssessments) && report.kraAssessments.length > 0
        ? report.kraAssessments.map(k => `${k.description} ${k.target} ${k.timeline} ${k.achievement}`).join(' ')
        : (report.workKRA || '');
    return normalizeText([
        report.financialYear,
        report.status,
        kraText,
        report.additionalAssignments,
        report.raRemarks,
        report.hrdRemarks,
        report.mdRemarks,
    ].join(' '));
}

function sortItems(items, order, getDate) {
    return [...items].sort((a, b) => {
        const aTime = new Date(getDate(a) || 0).getTime();
        const bTime = new Date(getDate(b) || 0).getTime();
        return order === 'oldest' ? aTime - bTime : bTime - aTime;
    });
}

function paginate(items, page) {
    const start = (page - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
}

// ─── Small reusable atoms ──────────────────────────────────────────────────────

const StatusBadge = ({ status, type = 'plan' }) => {
    const info = type === 'report' ? getReportStatusInfo(status) : getPlanStatusInfo(status);
    return (
        <span className={`yp-badge yp-badge--${info.cls}`}>
            {info.icon}
            {info.label}
        </span>
    );
};

const RAStatusBadge = ({ report }) => {
    const info = getRAStatusInfo(report);
    return (
        <span className={`yp-badge yp-badge--${info.cls}`}>
            {info.icon}
            {info.label}
        </span>
    );
};

// ─── 3-step stepper indicator ─────────────────────────────────────────────────

const ReportStepper = ({ currentStep }) => (
    <div className="yp-stepper" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={3} aria-label="Appraisal submission progress">
        {[1, 2, 3].map(step => (
            <div
                key={step}
                className={[
                    'yp-stepper-bar',
                    step < currentStep  ? 'is-done'   : '',
                    step === currentStep ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                aria-label={`Step ${step}${step < currentStep ? ' (completed)' : step === currentStep ? ' (current)' : ''}`}
            />
        ))}
    </div>
);

// ─── Modal shell ──────────────────────────────────────────────────────────────

const ModalShell = ({ title, subtitle, icon, stepper, onClose, children }) => {
    const content = (
        <div className="yp-modal-overlay" onClick={onClose}>
            <div className="yp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
                <div className="yp-modal-header">
                    <div className="yp-modal-title-wrap">
                        <div className="yp-modal-icon">{icon}</div>
                        <div>
                            <h2>{title}</h2>
                            <p>{subtitle}</p>
                            {stepper && <div className="yp-modal-stepper">{stepper}</div>}
                        </div>
                    </div>
                    <button className="yp-modal-close" type="button" onClick={onClose} aria-label="Close modal">
                        <FiX />
                    </button>
                </div>
                <div className="yp-modal-body">{children}</div>
            </div>
        </div>
    );
    return createPortal(content, document.body);
};

// ─── Filter bar ───────────────────────────────────────────────────────────────

const FilterBar = ({
    years, year, status, search, sort,
    statusOptions, searchPlaceholder,
    onYearChange, onStatusChange, onSearchChange, onSortChange,
}) => (
    <div className="yp-toolbar">
        <div className="yp-toolbar-filters">
            <label className="yp-filter-control">
                <span><FiFilter /> Year</span>
                <select value={year} onChange={(e) => onYearChange(e.target.value)}>
                    <option value="ALL">All Years</option>
                    {years.map((item) => (
                        <option key={item} value={item}>{`FY ${item}`}</option>
                    ))}
                </select>
            </label>

            <label className="yp-filter-control">
                <span>Status</span>
                <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
                    {statusOptions.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                </select>
            </label>

            <label className="yp-search-control">
                <FiSearch />
                <input
                    type="text"
                    placeholder={searchPlaceholder}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </label>
        </div>

        <label className="yp-sort-control">
            <span>Sort</span>
            <select value={sort} onChange={(e) => onSortChange(e.target.value)}>
                {SORT_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                ))}
            </select>
        </label>
    </div>
);

// ─── Pagination ───────────────────────────────────────────────────────────────

const Pagination = ({ totalItems, page, onPageChange }) => {
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const start = totalItems === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);

    if (totalPages <= 1) return null;

    return (
        <div className="yp-pagination">
            <div className="yp-pagination-summary">{`Showing ${start}–${end} of ${totalItems}`}</div>
            <button type="button" className="yp-page-btn" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                Previous
            </button>
            <div className="yp-page-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                        type="button"
                        key={n}
                        className={`yp-page-number${n === page ? ' is-active' : ''}`}
                        onClick={() => onPageChange(n)}
                    >
                        {n}
                    </button>
                ))}
            </div>
            <button type="button" className="yp-page-btn" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
                Next
            </button>
        </div>
    );
};

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ icon, title, message, actionLabel, onAction }) => (
    <div className="yp-empty-state">
        <div className="yp-empty-icon">{icon}</div>
        <h3>{title}</h3>
        <p>{message}</p>
        <button type="button" className="btn btn-primary" onClick={onAction}>
            {actionLabel}
        </button>
    </div>
);

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const LoadingSkeleton = () => (
    <div className="yp-page yp-page--loading">
        <section className="yp-hero yp-hero--skeleton">
            <div className="yp-hero-copy">
                <div className="yp-skeleton yp-skeleton--kicker" />
                <div className="yp-skeleton yp-skeleton--title" />
                <div className="yp-skeleton yp-skeleton--subtitle" />
            </div>
            <div className="yp-hero-actions">
                <div className="yp-skeleton yp-skeleton--button" />
                <div className="yp-skeleton yp-skeleton--button" />
                <div className="yp-skeleton yp-skeleton--icon" />
            </div>
        </section>
        <section className="yp-summary-strip">
            {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="yp-summary-card">
                    <div className="yp-skeleton yp-skeleton--stat-label" />
                    <div className="yp-skeleton yp-skeleton--stat-value" />
                </div>
            ))}
        </section>
        <section className="yp-panel">
            <div className="yp-toolbar">
                <div className="yp-toolbar-filters">
                    <div className="yp-skeleton yp-skeleton--control" />
                    <div className="yp-skeleton yp-skeleton--control" />
                    <div className="yp-skeleton yp-skeleton--search" />
                </div>
                <div className="yp-skeleton yp-skeleton--control" />
            </div>
            <div className="yp-list-shell">
                {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="yp-skeleton-row">
                        <div className="yp-skeleton yp-skeleton--row-large" />
                        <div className="yp-skeleton yp-skeleton--row-small" />
                        <div className="yp-skeleton yp-skeleton--row-badge" />
                        <div className="yp-skeleton yp-skeleton--row-small" />
                        <div className="yp-skeleton yp-skeleton--row-small" />
                        <div className="yp-skeleton yp-skeleton--row-action" />
                    </div>
                ))}
            </div>
        </section>
    </div>
);

// ─── Generic accordion table ──────────────────────────────────────────────────

const AccordionTable = ({ columns, rows, expandedId, onToggle, renderExpanded, emptyState }) => {
    if (rows.length === 0) return emptyState;

    return (
        <div className="yp-list-shell">
            <div className="yp-table-desktop">
                <table className="yp-table">
                    <thead>
                        <tr>
                            {columns.map((col) => (
                                <th key={col.key} className={col.headerClassName}>{col.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const isExpanded = expandedId === row.id;
                            return (
                                <tr key={row.id} className="yp-table-group-row">
                                    <td colSpan={columns.length}>
                                        <div className={`yp-table-row-wrap${isExpanded ? ' is-expanded' : ''}`}>
                                            <table className="yp-table yp-table--inner">
                                                <tbody>
                                                    <tr className="yp-table-row">
                                                        {columns.map((col) => (
                                                            <td key={col.key} className={col.cellClassName}>
                                                                {col.render(row, isExpanded, onToggle)}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                </tbody>
                                            </table>
                                            <div className={`yp-accordion${isExpanded ? ' is-open' : ''}`}>
                                                <div className="yp-accordion-inner">{renderExpanded(row)}</div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="yp-table-mobile">
                {rows.map((row) => {
                    const isExpanded = expandedId === row.id;
                    return (
                        <div key={row.id} className={`yp-mobile-card${isExpanded ? ' is-expanded' : ''}`}>
                            <div className="yp-mobile-grid">
                                {columns.map((col) => (
                                    <div key={col.key} className="yp-mobile-field">
                                        <span className="yp-mobile-label">{col.label}</span>
                                        <div className="yp-mobile-value">{col.render(row, isExpanded, onToggle)}</div>
                                    </div>
                                ))}
                            </div>
                            <div className={`yp-accordion${isExpanded ? ' is-open' : ''}`}>
                                <div className="yp-accordion-inner">{renderExpanded(row)}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main page component
// ═══════════════════════════════════════════════════════════════════════════════

const YearlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('plans');

    // ── Plan modal state ──────────────────────────────────────────────────────
    const [showPlanForm, setShowPlanForm] = useState(false);
    const [financialYear, setFinancialYear] = useState('');
    const [kras, setKras] = useState(DEFAULT_KRA());
    const [submitting, setSubmitting] = useState(false);

    // ── Inline edit state (DRAFT plans) ──────────────────────────────────────
    const [editingPlanId, setEditingPlanId] = useState(null);
    const [editKras, setEditKras] = useState(DEFAULT_KRA());

    // ── Resubmit state (REJECTED plans) ──────────────────────────────────────
    const [resubmittingPlanId, setResubmittingPlanId] = useState(null);
    const [resubmitKras, setResubmitKras] = useState(DEFAULT_KRA());
    const [revisionReason, setRevisionReason] = useState('');

    // ── Report modal state ────────────────────────────────────────────────────
    const [showReportForm, setShowReportForm] = useState(false);
    const [reportYear, setReportYear] = useState('');
    const [additionalAssignments, setAdditionalAssignments] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [approvedPlansForYear, setApprovedPlansForYear] = useState([]);
    const [noApprovedPlan, setNoApprovedPlan] = useState(false);
    const [linkedKras, setLinkedKras] = useState([]);

    // ── Stepper state for report modal ────────────────────────────────────────
    // Step 1 — Context  |  Step 2 — KRA Achievements  |  Step 3 — Review + Submit
    const [reportStep, setReportStep] = useState(1);
    const [kraAchievements, setKraAchievements] = useState({}); // { [index]: text }
    const [reportDraftId, setReportDraftId] = useState(null);
    const [savingDraft, setSavingDraft] = useState(false);
    const [draftSavedMsg, setDraftSavedMsg] = useState(false);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [expandedPlanId, setExpandedPlanId] = useState(null);
    const [expandedReportId, setExpandedReportId] = useState(null);

    const [planYearFilter, setPlanYearFilter] = useState('ALL');
    const [planStatusFilter, setPlanStatusFilter] = useState('ALL');
    const [planSearch, setPlanSearch] = useState('');
    const [planSort, setPlanSort] = useState('latest');
    const [planPage, setPlanPage] = useState(1);

    const [reportYearFilter, setReportYearFilter] = useState('ALL');
    const [reportStatusFilter, setReportStatusFilter] = useState('ALL');
    const [reportSearch, setReportSearch] = useState('');
    const [reportSort, setReportSort] = useState('latest');
    const [reportPage, setReportPage] = useState(1);

    // ── Derived KRA achievement values ────────────────────────────────────────
    const totalKras   = linkedKras.length;
    const filledKras  = linkedKras.filter((_, i) => String(kraAchievements[i] || '').trim()).length;
    const allKrasFilled = totalKras === 0 || filledKras === totalKras;
    const emptyKrasCount = totalKras - filledKras;

    // ─────────────────────────────────────────────────────────────────────────
    const fetchData = async () => {
        setLoading(true);
        try {
            const [plansRes, reportsRes] = await Promise.all([
                api.get('/employee/yearly-plans'),
                api.get('/employee/yearly-appraisal-reports'),
            ]);
            setPlans(plansRes.data || []);
            setReports(reportsRes.data || []);
        } catch {
            toast.error('Failed to load yearly plan data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // Body scroll lock when modals are open
    useEffect(() => {
        const isOpen = showPlanForm || showReportForm;
        const prev = document.body.style.overflow;
        document.body.style.overflow = isOpen ? 'hidden' : prev;
        return () => { document.body.style.overflow = prev; };
    }, [showPlanForm, showReportForm]);

    // Reset pagination on filter change
    useEffect(() => { setPlanPage(1); }, [planYearFilter, planStatusFilter, planSearch, planSort]);
    useEffect(() => { setReportPage(1); }, [reportYearFilter, reportStatusFilter, reportSearch, reportSort]);

    // Auto-fetch approved plans when reportYear changes
    useEffect(() => {
        if (!reportYear) {
            setApprovedPlansForYear([]);
            setSelectedPlanId('');
            setLinkedKras([]);
            setNoApprovedPlan(false);
            return;
        }
        const fetch = async () => {
            try {
                const res = await api.get(`/employee/yearly-plans/approved?financialYear=${reportYear}`);
                const approved = res.data || [];
                setApprovedPlansForYear(approved);
                if (approved.length > 0) {
                    const latest = approved[0];
                    setSelectedPlanId(latest.id);
                    setLinkedKras(latest.kras || []);
                    setNoApprovedPlan(false);
                } else {
                    setSelectedPlanId('');
                    setLinkedKras([]);
                    setNoApprovedPlan(true);
                }
            } catch {
                setApprovedPlansForYear([]);
                setNoApprovedPlan(false);
            }
        };
        fetch();
    }, [reportYear]);

    // Update KRA reference when selected plan changes
    useEffect(() => {
        if (!selectedPlanId) { setLinkedKras([]); return; }
        const found = approvedPlansForYear.find(p => p.id === selectedPlanId);
        if (found) setLinkedKras(found.kras || []);
    }, [selectedPlanId, approvedPlansForYear]);

    // ── Derived filter / sort / paginate ──────────────────────────────────────

    const availableYears = useMemo(() => {
        const vals = new Set(yearOptions);
        plans.forEach((p) => vals.add(p.financialYear));
        reports.forEach((r) => vals.add(r.financialYear));
        return [...vals].filter(Boolean).sort((a, b) => b.localeCompare(a));
    }, [plans, reports]);

    const filteredPlans = useMemo(() => {
        const query = normalizeText(planSearch);
        const items = plans.filter((plan) => {
            const yearMatches   = planYearFilter   === 'ALL' || plan.financialYear === planYearFilter;
            const statusMatches = planStatusFilter === 'ALL' || plan.status        === planStatusFilter;
            const searchMatches = !query || getSearchTextForPlan(plan).includes(query);
            return yearMatches && statusMatches && searchMatches;
        });
        return sortItems(items, planSort, getPlanLastUpdated);
    }, [plans, planYearFilter, planStatusFilter, planSearch, planSort]);

    const filteredReports = useMemo(() => {
        const query = normalizeText(reportSearch);
        const items = reports.filter((report) => {
            const yearMatches   = reportYearFilter   === 'ALL' || report.financialYear === reportYearFilter;
            const statusMatches = reportStatusFilter === 'ALL' || report.status        === reportStatusFilter;
            const searchMatches = !query || getSearchTextForReport(report).includes(query);
            return yearMatches && statusMatches && searchMatches;
        });
        return sortItems(items, reportSort, (r) => r.updatedAt || r.submittedAt);
    }, [reports, reportYearFilter, reportStatusFilter, reportSearch, reportSort]);

    const pagedPlans   = useMemo(() => paginate(filteredPlans,   planPage),   [filteredPlans,   planPage]);
    const pagedReports = useMemo(() => paginate(filteredReports, reportPage), [filteredReports, reportPage]);

    useEffect(() => {
        const total = Math.max(1, Math.ceil(filteredPlans.length / PAGE_SIZE));
        if (planPage > total) setPlanPage(total);
    }, [filteredPlans.length, planPage]);

    useEffect(() => {
        const total = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
        if (reportPage > total) setReportPage(total);
    }, [filteredReports.length, reportPage]);

    // ── Summary counts ────────────────────────────────────────────────────────
    const draftPlanCount    = useMemo(() => plans.filter(p => p.status === 'DRAFT').length, [plans]);
    const submittedPlanCount = useMemo(() => plans.filter(p => ['PENDING', 'APPROVED', 'REJECTED'].includes(p.status)).length, [plans]);
    const completedReportCount = useMemo(() => reports.filter(r => r.status === 'COMPLETED').length, [reports]);

    // ── Modal helpers ─────────────────────────────────────────────────────────

    const openPlanModal = () => {
        setKras(DEFAULT_KRA());
        setFinancialYear('');
        setShowPlanForm(true);
        setShowReportForm(false);
    };

    const openReportModal = () => {
        setReportYear('');
        setAdditionalAssignments('');
        setSelectedPlanId('');
        setLinkedKras([]);
        setNoApprovedPlan(false);
        setReportStep(1);
        setKraAchievements({});
        setReportDraftId(null);
        setSavingDraft(false);
        setDraftSavedMsg(false);
        setShowReportForm(true);
        setShowPlanForm(false);
    };

    const editDraftReport = (report) => {
        setReportYear(report.financialYear);
        setAdditionalAssignments(report.additionalAssignments || '');
        if (report.linkedYearlyPlan) {
            setSelectedPlanId(report.linkedYearlyPlan.id || report.linkedYearlyPlan);
            setLinkedKras(report.linkedYearlyPlan.kras || []);
        } else {
            setSelectedPlanId('');
            setLinkedKras([]);
        }
        setNoApprovedPlan(false);
        setReportStep(1);
        
        const achMap = {};
        if (Array.isArray(report.kraAssessments)) {
            report.kraAssessments.forEach(k => {
                if (k.kraIndex != null) achMap[k.kraIndex] = k.achievement;
            });
        }
        setKraAchievements(achMap);
        
        setReportDraftId(report.id);
        setSavingDraft(false);
        setDraftSavedMsg(false);
        setShowReportForm(true);
        setShowPlanForm(false);
    };

    const closePlanModal   = () => setShowPlanForm(false);
    const closeReportModal = () => setShowReportForm(false);

    // ── KRA validation helper ─────────────────────────────────────────────────

    const validateKras = (rows) => {
        if (!Array.isArray(rows) || rows.length === 0) return 'At least one KRA row is required.';
        for (const kra of rows) {
            if (!kra.description?.trim() || !kra.target?.trim() || !kra.timeline?.trim()) {
                return 'Each KRA must have a description, target, and timeline.';
            }
        }
        return null;
    };

    // ── Build kraAssessments array from state ─────────────────────────────────

    const buildKraAssessments = () =>
        linkedKras.map((kra, i) => ({
            kraIndex:    i,
            description: kra.description,
            target:      kra.target,
            timeline:    kra.timeline,
            achievement: String(kraAchievements[i] || '').trim(),
        }));

    // ── Submit Plan (new) ─────────────────────────────────────────────────────

    const handleSubmitPlan = async (e, asDraft = false) => {
        e.preventDefault();
        if (!financialYear) { toast.error('Please select a financial year.'); return; }
        if (!asDraft) {
            const err = validateKras(kras);
            if (err) { toast.error(err); return; }
        }
        if (asDraft && (!Array.isArray(kras) || kras.length === 0)) {
            toast.error('Add at least one KRA before saving a draft.');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-plan', {
                financialYear,
                kras,
                status: asDraft ? 'DRAFT' : 'PENDING',
            });
            toast.success(asDraft ? 'Draft saved successfully.' : 'Yearly plan submitted for review.');
            setShowPlanForm(false);
            await fetchData();
            setActiveTab('plans');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Edit DRAFT plan inline ────────────────────────────────────────────────

    const startEditing = (plan) => {
        setExpandedPlanId(plan.id);
        setResubmittingPlanId(null);
        setEditingPlanId(plan.id);
        setEditKras(plan.kras && plan.kras.length > 0 ? plan.kras : DEFAULT_KRA());
    };

    const handleEditPlan = async (e, asDraft = false) => {
        e.preventDefault();
        if (!asDraft) {
            const err = validateKras(editKras);
            if (err) { toast.error(err); return; }
        }
        setSubmitting(true);
        try {
            await api.put(`/employee/yearly-plan/${editingPlanId}`, {
                kras: editKras,
                status: asDraft ? 'DRAFT' : 'PENDING',
            });
            toast.success(asDraft ? 'Draft updated.' : 'Plan submitted for review.');
            setEditingPlanId(null);
            setEditKras(DEFAULT_KRA());
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Update failed');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Resubmit REJECTED plan ────────────────────────────────────────────────

    const handleResubmitPlan = async (e) => {
        e.preventDefault();
        const kraErr = validateKras(resubmitKras);
        if (kraErr) { toast.error(kraErr); return; }
        if (!revisionReason.trim()) { toast.error('Reason for revision is required.'); return; }
        setSubmitting(true);
        try {
            await api.post(`/employee/yearly-plan/${resubmittingPlanId}/resubmit`, {
                kras: resubmitKras,
                revisionReason: revisionReason.trim(),
            });
            toast.success('Yearly plan resubmitted successfully.');
            setResubmittingPlanId(null);
            setResubmitKras(DEFAULT_KRA());
            setRevisionReason('');
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Resubmission failed');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Save appraisal draft ──────────────────────────────────────────────────

    const handleSaveDraftReport = async () => {
        if (!reportYear) { toast.error('Please select a financial year first.'); return; }
        const kraAssessments = buildKraAssessments();
        setSavingDraft(true);
        try {
            if (reportDraftId) {
                // Update existing draft via PUT
                await api.put(`/employee/yearly-appraisal-report/${reportDraftId}`, {
                    kraAssessments,
                    additionalAssignments: additionalAssignments || null,
                    status: 'DRAFT',
                });
            } else {
                // Create new draft via POST
                const res = await api.post('/employee/yearly-appraisal-report', {
                    linkedYearlyPlan: selectedPlanId || null,
                    financialYear:    reportYear,
                    kraAssessments,
                    additionalAssignments: additionalAssignments || null,
                    status: 'DRAFT',
                });
                if (res.data?.reportId) setReportDraftId(res.data.reportId);
            }
            setDraftSavedMsg(true);
            setTimeout(() => setDraftSavedMsg(false), 2000);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Draft save failed');
        } finally {
            setSavingDraft(false);
        }
    };

    // ── Submit appraisal report ───────────────────────────────────────────────

    const handleSubmitReport = async () => {
        if (!reportYear) { toast.error('Please select a financial year.'); return; }
        if (noApprovedPlan) { toast.error('An approved yearly plan is required to submit an appraisal.'); return; }
        if (!allKrasFilled) {
            toast.error(`Please complete all ${emptyKrasCount} remaining KRA achievement${emptyKrasCount !== 1 ? 's' : ''} before submitting.`);
            return;
        }

        const kraAssessments = buildKraAssessments();

        setSubmitting(true);
        try {
            if (reportDraftId) {
                await api.put(`/employee/yearly-appraisal-report/${reportDraftId}`, {
                    kraAssessments,
                    additionalAssignments: additionalAssignments || null,
                    status: 'SUBMITTED',
                });
            } else {
                await api.post('/employee/yearly-appraisal-report', {
                    linkedYearlyPlan:      selectedPlanId || null,
                    financialYear:         reportYear,
                    kraAssessments,
                    additionalAssignments: additionalAssignments || null,
                    status: 'SUBMITTED',
                });
            }
            toast.success('Appraisal report submitted successfully.');
            setShowReportForm(false);
            await fetchData();
            setActiveTab('reports');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Professional PDF print ────────────────────────────────────────────────

    const printReport = (report) => {
        const printWin = window.open('', '_blank');
        if (!printWin) { toast.error('Please allow popups to download the report'); return; }

        // Per-KRA achievement blocks
        const kraAssessments = Array.isArray(report.kraAssessments) ? report.kraAssessments : [];
        const kraBlocksHTML = kraAssessments.length > 0
            ? kraAssessments.map((k) => `
                <div class="kra-block">
                    <div class="kra-block-header">
                        <span class="kra-block-num">${k.kraIndex + 1}</span>
                        <div class="kra-block-meta">
                            <div class="kra-block-desc">${k.description || '—'}</div>
                            <div class="kra-block-pills">
                                <span class="kra-pill">Target: ${k.target || '—'}</span>
                                <span class="kra-pill">Timeline: ${k.timeline || '—'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="kra-block-achievement">
                        <div class="kra-block-achievement-label">Achievement / Progress</div>
                        <div class="kra-block-achievement-text">${k.achievement || '—'}</div>
                    </div>
                </div>
            `).join('')
            : '<p class="muted">No KRA assessments recorded.</p>';

        const evaluatorBlock = (role, remarks) => `
            <div class="eval-block">
                <div class="eval-role">${role}</div>
                <div class="${remarks ? 'eval-remark' : 'eval-awaiting'}">${remarks || 'Awaiting evaluation.'}</div>
            </div>
        `;

        printWin.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>Annual Appraisal Report — FY ${report.financialYear}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1a1a2e; font-size: 13px; line-height: 1.6; }
        .page { max-width: 900px; margin: 0 auto; padding: 40px 48px; }

        .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #f97316; padding-bottom: 20px; margin-bottom: 28px; }
        .org-name { font-size: 22px; font-weight: 800; color: #f97316; letter-spacing: -0.03em; }
        .doc-title { font-size: 14px; color: #555; margin-top: 4px; }
        .header-meta { text-align: right; font-size: 12px; color: #777; line-height: 1.8; }
        .header-meta strong { color: #1a1a2e; }

        .section { margin-bottom: 28px; }
        .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: #f97316; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #ffe8d6; }

        /* KRA blocks */
        .kra-block { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 12px; page-break-inside: avoid; }
        .kra-block-header { display: flex; align-items: flex-start; gap: 12px; background: #f8fafc; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; }
        .kra-block-num { width: 24px; height: 24px; border-radius: 50%; background: #fff7ed; border: 1.5px solid #fed7aa; color: #ea580c; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .kra-block-meta { flex: 1; }
        .kra-block-desc { font-size: 12.5px; font-weight: 600; color: #1a1a2e; margin-bottom: 6px; }
        .kra-block-pills { display: flex; gap: 8px; flex-wrap: wrap; }
        .kra-pill { font-size: 10px; font-weight: 600; color: #6b7280; background: #fff; border: 1px solid #e5e7eb; border-radius: 999px; padding: 2px 8px; }
        .kra-block-achievement { padding: 12px 14px; }
        .kra-block-achievement-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 6px; }
        .kra-block-achievement-text { font-size: 12px; color: #374151; line-height: 1.75; white-space: pre-wrap; }

        .assessment-text { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; white-space: pre-wrap; font-size: 12.5px; color: #374151; line-height: 1.75; }
        .eval-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .eval-block { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .eval-role { background: #f3f4f6; padding: 7px 12px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #374151; border-bottom: 1px solid #e5e7eb; }
        .eval-remark { padding: 10px 12px; font-size: 12px; color: #1f2937; line-height: 1.65; border-left: 3px solid #f97316; }
        .eval-awaiting { padding: 10px 12px; font-size: 12px; color: #9ca3af; font-style: italic; }
        .muted { color: #9ca3af; font-style: italic; font-size: 12px; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
        @media print { .page { padding: 20px 28px; } }
    </style>
</head>
<body>
<div class="page">
    <div class="header">
        <div>
            <div class="org-name">Performance Evaluation System</div>
            <div class="doc-title">Annual Appraisal Report</div>
        </div>
        <div class="header-meta">
            <div><strong>Financial Year</strong> FY ${report.financialYear}</div>
            <div><strong>Status</strong> ${report.status || 'SUBMITTED'}</div>
            <div><strong>Submitted</strong> ${formatDate(report.submittedAt)}</div>
            <div><strong>Generated</strong> ${formatDate(new Date())}</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">KRA Self-Assessment — Achievement Against Key Result Areas</div>
        ${kraBlocksHTML}
    </div>

    ${report.additionalAssignments ? `
    <div class="section">
        <div class="section-title">Additional Assignments</div>
        <div class="assessment-text">${report.additionalAssignments}</div>
    </div>` : ''}

    <div class="section">
        <div class="section-title">Evaluator Remarks</div>
        <div class="eval-grid">
            ${evaluatorBlock('Reporting Authority (RA)', report.raRemarks)}
            ${evaluatorBlock('HRD', report.hrdRemarks)}
            ${evaluatorBlock('Managing Director (MD)', report.mdRemarks)}
        </div>
    </div>

    <div class="footer">
        <span>Confidential — For internal HR use only</span>
        <span>Performance Evaluation System</span>
    </div>
</div>
</body>
</html>`);
        printWin.document.close();
        setTimeout(() => printWin.print(), 400);
    };

    // ── Plan accordion columns ────────────────────────────────────────────────

    const planColumns = [
        {
            key: 'financialYear',
            label: 'Financial Year',
            render: (plan) => (
                <div className="yp-cell-primary">
                    <strong>{`FY ${plan.financialYear}`}</strong>
                </div>
            ),
        },
        {
            key: 'version',
            label: 'Version',
            render: (plan) => <span className="yp-version-chip">v{plan.version || 1}</span>,
        },
        {
            key: 'status',
            label: 'Status',
            render: (plan) => <StatusBadge status={plan.status} type="plan" />,
        },
        {
            key: 'submittedAt',
            label: 'Submitted Date',
            render: (plan) => <span>{formatDate(plan.submittedAt)}</span>,
        },
        {
            key: 'lastUpdated',
            label: 'Last Updated',
            render: (plan) => <span>{formatDate(getPlanLastUpdated(plan))}</span>,
        },
        {
            key: 'action',
            label: 'Action',
            cellClassName: 'yp-cell-action',
            render: (plan, isExpanded, onToggle) => (
                <button
                    type="button"
                    className={`yp-view-btn${isExpanded ? ' is-open' : ''}`}
                    onClick={() => onToggle(isExpanded ? null : plan.id)}
                >
                    <FiEye />
                    {isExpanded ? 'Hide' : 'View'}
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            ),
        },
    ];

    // ── Report accordion columns ──────────────────────────────────────────────

    const reportColumns = [
        {
            key: 'financialYear',
            label: 'Financial Year',
            render: (report) => (
                <div className="yp-cell-primary">
                    <strong>{`FY ${report.financialYear}`}</strong>
                </div>
            ),
        },
        {
            key: 'status',
            label: 'Status',
            render: (report) => <StatusBadge status={report.status} type="report" />,
        },
        {
            key: 'submittedAt',
            label: 'Submitted Date',
            render: (report) => <span>{formatDate(report.submittedAt)}</span>,
        },
        {
            key: 'raStatus',
            label: 'RA Status',
            render: (report) => <RAStatusBadge report={report} />,
        },
        {
            key: 'action',
            label: 'Action',
            cellClassName: 'yp-cell-action',
            render: (report, isExpanded, onToggle) => (
                <button
                    type="button"
                    className={`yp-view-btn${isExpanded ? ' is-open' : ''}`}
                    onClick={() => onToggle(isExpanded ? null : report.id)}
                >
                    <FiEye />
                    {isExpanded ? 'Hide' : 'View'}
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            ),
        },
    ];

    // ── Render expanded plan row ──────────────────────────────────────────────

    const renderPlanExpanded = (plan) => {
        const isEditing    = editingPlanId === plan.id;
        const canEdit      = plan.status === 'DRAFT' || plan.status === 'REJECTED';
        const isRejected   = plan.status === 'REJECTED';
        const isApproved   = plan.status === 'APPROVED';
        const hasRevisions = Array.isArray(plan.revisionLog) && plan.revisionLog.length > 0;

        return (
            <div className="yp-detail-panel">
                <div className="yp-detail-grid">
                    {/* Left — KRA Table */}
                    <div className="yp-detail-card yp-detail-card--main">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Key Result Areas (KRAs)</h4>
                                <p>Structured KRA plan submitted for MD review.</p>
                            </div>
                            {canEdit && !isEditing && !isRejected && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditing(plan)}>
                                    <FiEdit3 /> Edit / Submit Draft
                                </button>
                            )}
                        </div>

                        {isEditing ? (
                            <div className="yp-form" style={{ padding: '16px 18px' }}>
                                <KRATable rows={editKras} onChange={setEditKras} />
                                <div className="yp-form-actions">
                                    <button type="button" className="btn btn-primary" disabled={submitting} onClick={(e) => handleEditPlan(e, false)}>
                                        {submitting ? 'Submitting...' : <><FiSend /> Submit Plan</>}
                                    </button>
                                    <button type="button" className="btn btn-secondary" disabled={submitting} onClick={(e) => handleEditPlan(e, true)}>
                                        {submitting ? 'Saving...' : <><FiSave /> Save Draft</>}
                                    </button>
                                    <button type="button" className="btn btn-ghost" onClick={() => { setEditingPlanId(null); setEditKras(DEFAULT_KRA()); }}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <KRATable rows={plan.kras || []} readOnly />
                        )}
                    </div>

                    {/* Right — Submission Summary */}
                    <div className="yp-detail-card yp-detail-card--side">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Submission Summary</h4>
                                <p>Versioning and approval metadata.</p>
                            </div>
                        </div>
                        <div className="yp-meta-list">
                            <div className="yp-meta-row"><span>Financial Year</span><strong>{`FY ${plan.financialYear}`}</strong></div>
                            <div className="yp-meta-row"><span>Version</span><strong>{`v${plan.version || 1}`}</strong></div>
                            <div className="yp-meta-row"><span>Status</span><StatusBadge status={plan.status} type="plan" /></div>
                            <div className="yp-meta-row"><span>Submitted</span><strong>{formatDate(plan.submittedAt)}</strong></div>
                            <div className="yp-meta-row"><span>Last Updated</span><strong>{formatDate(getPlanLastUpdated(plan))}</strong></div>
                            <div className="yp-meta-row">
                                <span>MD Remarks</span>
                                <span className={`yp-remarks-inline${plan.mdRemarks ? '' : ' yp-remarks-inline--awaiting'}`}>
                                    {plan.mdRemarks || 'Awaiting review.'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {isApproved && (
                    <div className="yp-note-banner is-approved">
                        <strong>Plan Approved by Managing Director</strong>
                        <p>{plan.mdRemarks || 'Your yearly plan has been approved. Proceed to submit your appraisal report.'}</p>
                    </div>
                )}

                {hasRevisions && (
                    <div className="yp-detail-card">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Revision History</h4>
                                <p>{plan.revisionLog.length} revision{plan.revisionLog.length !== 1 ? 's' : ''} recorded.</p>
                            </div>
                        </div>
                        <div className="yp-revision-timeline">
                            {plan.revisionLog.map((entry, idx) => (
                                <div key={idx} className="yp-revision-entry">
                                    <div className="yp-revision-version">v{entry.version}</div>
                                    <div className="yp-revision-body">
                                        <strong>{formatDateTime(entry.revisedAt)}</strong>
                                        <p>{entry.reason}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {isRejected && (
                    <div className="yp-alert-panel">
                        <div className="yp-alert-header">
                            <FiAlertCircle className="yp-alert-icon" />
                            <div>
                                <h4>Plan Rejected by Managing Director</h4>
                                <p>Revise your KRAs against the MD feedback and resubmit for review. A revision reason is required.</p>
                            </div>
                        </div>
                        {resubmittingPlanId === plan.id ? (
                            <form className="yp-form" onSubmit={handleResubmitPlan}>
                                <div className="yp-form-group">
                                    <label>Reason for Revision <span className="required">*</span></label>
                                    <input
                                        type="text"
                                        placeholder="Briefly describe what you changed and why"
                                        value={revisionReason}
                                        onChange={e => setRevisionReason(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="yp-form-group">
                                    <label>Revised KRAs <span className="required">*</span></label>
                                    <KRATable rows={resubmitKras} onChange={setResubmitKras} />
                                </div>
                                <div className="yp-form-actions">
                                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                                        <FiRefreshCw />
                                        {submitting ? 'Resubmitting...' : 'Resubmit Plan'}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setResubmittingPlanId(null);
                                            setResubmitKras(DEFAULT_KRA());
                                            setRevisionReason('');
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                    setResubmittingPlanId(plan.id);
                                    setResubmitKras(plan.kras && plan.kras.length > 0 ? plan.kras : DEFAULT_KRA());
                                    setExpandedPlanId(plan.id);
                                }}
                            >
                                <FiRefreshCw /> Resubmit Plan
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // ── Render expanded report row ────────────────────────────────────────────

    const renderReportExpanded = (report) => {
        const kraAssessments   = Array.isArray(report.kraAssessments) ? report.kraAssessments : [];
        const hasKraAssessments = kraAssessments.length > 0;

        // Convert kraAssessments to props for KRAAssessmentCards (read-only mode)
        // kras prop: array of { description, target, timeline }
        // values prop: { [index]: achievementText }
        const krasForDisplay = kraAssessments.map(k => ({
            description: k.description,
            target:      k.target,
            timeline:    k.timeline,
        }));
        const valuesForDisplay = Object.fromEntries(kraAssessments.map((k, i) => [i, k.achievement]));

        return (
            <div className="yp-detail-panel">
                <div className="yp-detail-grid">
                    {/* Left — KRA Achievement Cards (read-only) */}
                    <div className="yp-detail-card yp-detail-card--main">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>KRA Self-Assessment</h4>
                                <p>Employee's achievement against each Key Result Area from the approved yearly plan.</p>
                            </div>
                            {report.status === 'DRAFT' && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => editDraftReport(report)}>
                                    <FiEdit3 /> Edit / Submit Draft
                                </button>
                            )}
                        </div>
                        <div style={{ padding: '16px 18px' }}>
                            {hasKraAssessments ? (
                                <KRAAssessmentCards
                                    kras={krasForDisplay}
                                    values={valuesForDisplay}
                                    readOnly
                                />
                            ) : (
                                /* Graceful fallback for legacy reports with workKRA */
                                report.workKRA ? (
                                    <div className="yp-prose-block">{report.workKRA}</div>
                                ) : (
                                    <p className="kra-ac-no-kras">No KRA assessments recorded.</p>
                                )
                            )}
                        </div>
                    </div>

                    {/* Right — Report Summary */}
                    <div className="yp-detail-card yp-detail-card--side">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Report Summary</h4>
                                <p>Current evaluation status across workflow stages.</p>
                            </div>
                        </div>
                        <div className="yp-meta-list">
                            <div className="yp-meta-row"><span>Financial Year</span><strong>{`FY ${report.financialYear}`}</strong></div>
                            <div className="yp-meta-row"><span>Status</span><StatusBadge status={report.status} type="report" /></div>
                            <div className="yp-meta-row"><span>RA Status</span><RAStatusBadge report={report} /></div>
                            <div className="yp-meta-row"><span>Submitted</span><strong>{formatDate(report.submittedAt)}</strong></div>
                            <div className="yp-meta-row"><span>Last Updated</span><strong>{formatDate(report.updatedAt || report.submittedAt)}</strong></div>
                        </div>
                    </div>
                </div>

                {/* Additional Assignments */}
                {report.additionalAssignments && (
                    <div className="yp-detail-card">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Additional Assignments</h4>
                                <p>Extra responsibilities handled outside the base KRA scope.</p>
                            </div>
                        </div>
                        <div className="yp-prose-block">{report.additionalAssignments}</div>
                    </div>
                )}

                {/* Evaluator Remarks */}
                <div className="yp-detail-card">
                    <div className="yp-detail-card-header">
                        <div>
                            <h4>Evaluator Remarks</h4>
                            <p>Remarks visible to the employee across all review stages.</p>
                        </div>
                    </div>
                    <div className="yp-remarks-stack">
                        <div className="yp-remark-card">
                            <span className="yp-remark-role">Reporting Authority (RA) Remarks</span>
                            <p className={!report.raRemarks ? 'yp-awaiting' : ''}>{report.raRemarks || 'Awaiting evaluation.'}</p>
                        </div>
                        <div className="yp-remark-card">
                            <span className="yp-remark-role">HRD Remarks</span>
                            <p className={!report.hrdRemarks ? 'yp-awaiting' : ''}>{report.hrdRemarks || 'Awaiting evaluation.'}</p>
                        </div>
                        <div className="yp-remark-card">
                            <span className="yp-remark-role">MD Remarks</span>
                            <p className={!report.mdRemarks ? 'yp-awaiting' : ''}>{report.mdRemarks || 'Awaiting evaluation.'}</p>
                        </div>
                    </div>
                </div>

                {report.status === 'COMPLETED' && (
                    <div className="yp-detail-actions">
                        <button type="button" className="btn btn-primary" onClick={() => printReport(report)}>
                            <FiDownload /> Download PDF
                        </button>
                    </div>
                )}
            </div>
        );
    };

    // ── Step labels ───────────────────────────────────────────────────────────

    const STEP_SUBTITLES = [
        'Select the financial year — your approved plan will be auto-linked.',
        'Document what you delivered against each KRA from your approved plan.',
        'Review your entries and capture any additional assignments before submitting.',
    ];

    // ─────────────────────────────────────────────────────────────────────────
    if (loading) return <LoadingSkeleton />;

    return (
        <div className="yp-page fade-in">
            {/* ── Hero ──────────────────────────────────────────────────────── */}
            <section className="yp-hero">
                <div className="yp-hero-copy">
                    <span className="yp-hero-kicker">Performance Workspace</span>
                    <h1>Yearly Plan and Appraisal</h1>
                    <p>Manage structured KRA-based yearly plans and appraisal reports through an enterprise-ready review workflow.</p>
                </div>
                <div className="yp-hero-actions">
                    <button type="button" className="btn btn-primary" onClick={openPlanModal}>
                        <FiSend /> Submit Yearly Plan
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={openReportModal}>
                        <FiFileText /> Submit Appraisal Report
                    </button>
                    <button type="button" className="yp-icon-btn" onClick={fetchData} aria-label="Refresh">
                        <FiRefreshCw />
                    </button>
                </div>
            </section>

            {/* ── Summary Strip ─────────────────────────────────────────────── */}
            <section className="yp-summary-strip">
                <div className="yp-summary-card">
                    <span>Plans Submitted</span>
                    <strong>{submittedPlanCount}</strong>
                </div>
                <div className="yp-summary-card">
                    <span>Appraisal Submitted</span>
                    <strong>{reports.length}</strong>
                </div>
                <div className="yp-summary-card">
                    <span>Completed Reports</span>
                    <strong>{completedReportCount}</strong>
                </div>
                {draftPlanCount > 0 && (
                    <div className="yp-summary-card yp-summary-card--draft">
                        <span>Draft Plans</span>
                        <strong>{draftPlanCount}</strong>
                    </div>
                )}
            </section>

            {/* ── Tabs ──────────────────────────────────────────────────────── */}
            <div className="yp-tabs">
                <button type="button" className={`yp-tab${activeTab === 'plans' ? ' active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <FiTarget /> Yearly Plans <span className="yp-tab-count">{plans.length}</span>
                </button>
                <button type="button" className={`yp-tab${activeTab === 'reports' ? ' active' : ''}`} onClick={() => setActiveTab('reports')}>
                    <FiFileText /> Appraisal Reports <span className="yp-tab-count">{reports.length}</span>
                </button>
            </div>

            {/* ── Plans Tab ─────────────────────────────────────────────────── */}
            {activeTab === 'plans' && (
                <section className="yp-panel">
                    <div className="yp-panel-header">
                        <div>
                            <h2>Yearly Plan List</h2>
                            <p>Track KRA-based yearly plan versions, approval status, and revision history in one place.</p>
                        </div>
                    </div>
                    <FilterBar
                        years={availableYears}
                        year={planYearFilter}
                        status={planStatusFilter}
                        search={planSearch}
                        sort={planSort}
                        statusOptions={PLAN_STATUS_OPTIONS}
                        searchPlaceholder="Search year, KRA description, or remarks"
                        onYearChange={setPlanYearFilter}
                        onStatusChange={setPlanStatusFilter}
                        onSearchChange={setPlanSearch}
                        onSortChange={setPlanSort}
                    />
                    <AccordionTable
                        columns={planColumns}
                        rows={pagedPlans}
                        expandedId={expandedPlanId}
                        onToggle={(nextId) => {
                            setExpandedPlanId(nextId);
                            if (!nextId) {
                                setEditingPlanId(null);
                                setResubmittingPlanId(null);
                                setRevisionReason('');
                            }
                        }}
                        renderExpanded={renderPlanExpanded}
                        emptyState={(
                            <EmptyState
                                icon={<FiTarget />}
                                title="No Yearly Plan Submitted Yet"
                                message="Create your first KRA-based yearly plan to start the annual planning workflow."
                                actionLabel="Submit Yearly Plan"
                                onAction={openPlanModal}
                            />
                        )}
                    />
                    <Pagination totalItems={filteredPlans.length} page={planPage} onPageChange={setPlanPage} />
                </section>
            )}

            {/* ── Reports Tab ───────────────────────────────────────────────── */}
            {activeTab === 'reports' && (
                <section className="yp-panel">
                    <div className="yp-panel-header">
                        <div>
                            <h2>Appraisal Report List</h2>
                            <p>Review your yearly appraisal submissions, evaluation progress, and final remarks.</p>
                        </div>
                    </div>
                    <FilterBar
                        years={availableYears}
                        year={reportYearFilter}
                        status={reportStatusFilter}
                        search={reportSearch}
                        sort={reportSort}
                        statusOptions={REPORT_STATUS_OPTIONS}
                        searchPlaceholder="Search year, KRA content, or evaluator remarks"
                        onYearChange={setReportYearFilter}
                        onStatusChange={setReportStatusFilter}
                        onSearchChange={setReportSearch}
                        onSortChange={setReportSort}
                    />
                    <AccordionTable
                        columns={reportColumns}
                        rows={pagedReports}
                        expandedId={expandedReportId}
                        onToggle={setExpandedReportId}
                        renderExpanded={renderReportExpanded}
                        emptyState={(
                            <EmptyState
                                icon={<FiFileText />}
                                title="No Appraisal Report Submitted Yet"
                                message="Submit a yearly appraisal report once your KRA-based plan is approved."
                                actionLabel="Submit Appraisal Report"
                                onAction={openReportModal}
                            />
                        )}
                    />
                    <Pagination totalItems={filteredReports.length} page={reportPage} onPageChange={setReportPage} />
                </section>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Submit Yearly Plan Modal
            ══════════════════════════════════════════════════════════════════ */}
            {showPlanForm && (
                <ModalShell
                    title="Submit Yearly Plan"
                    subtitle="Define your KRA-based yearly targets, measurable outcomes, and timelines."
                    icon={<FiTarget />}
                    onClose={closePlanModal}
                >
                    <form className="yp-modal-form" onSubmit={(e) => handleSubmitPlan(e, false)}>
                        <div className="yp-modal-form-body">
                            <div className="yp-form-section">
                                <div className="yp-form-section-header">
                                    <h3>Planning Context</h3>
                                    <p>Select the financial year for this plan.</p>
                                </div>
                                <div className="yp-form-group">
                                    <label>Financial Year <span className="required">*</span></label>
                                    <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} required>
                                        <option value="">Select Financial Year</option>
                                        {yearOptions.map((year) => (
                                            <option key={year} value={year}>{year}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="yp-form-section">
                                <div className="yp-form-section-header">
                                    <h3>Key Result Areas (KRAs)</h3>
                                    <p>Define each KRA with a clear description, a measurable target, and a timeline. At least one KRA is required to submit.</p>
                                </div>
                                <KRATable rows={kras} onChange={setKras} />
                            </div>
                        </div>

                        <div className="yp-modal-form-footer">
                            <div className="yp-form-actions">
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : <><FiSend /> Submit Plan</>}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={submitting}
                                    onClick={(e) => handleSubmitPlan(e, true)}
                                >
                                    {submitting ? 'Saving...' : <><FiSave /> Save as Draft</>}
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={closePlanModal}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                </ModalShell>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Submit Appraisal Report Modal — 3-step stepper
            ══════════════════════════════════════════════════════════════════ */}
            {showReportForm && (
                <ModalShell
                    title="Submit Appraisal Report"
                    subtitle={STEP_SUBTITLES[reportStep - 1]}
                    icon={<FiFileText />}
                    stepper={<ReportStepper currentStep={reportStep} />}
                    onClose={closeReportModal}
                >
                    <div className="yp-modal-form">
                        <div className="yp-modal-form-body">

                            {/* ── Step 1 — Context ────────────────────────────── */}
                            {reportStep === 1 && (
                                <div className="yp-form-section" style={{ paddingTop: 0, borderBottom: 'none' }}>
                                    <div className="yp-form-section-header">
                                        <h3>Submission Context</h3>
                                        <p>Select the financial year — your approved yearly plan will be auto-linked.</p>
                                    </div>

                                    <div className="yp-form-row">
                                        <div className="yp-form-group">
                                            <label>Financial Year <span className="required">*</span></label>
                                            <select value={reportYear} onChange={(e) => setReportYear(e.target.value)} required>
                                                <option value="">Select Financial Year</option>
                                                {yearOptions.map((year) => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="yp-form-group">
                                            <label>Linked Yearly Plan</label>
                                            <select
                                                value={selectedPlanId}
                                                onChange={(e) => setSelectedPlanId(e.target.value)}
                                                disabled={approvedPlansForYear.length === 0}
                                            >
                                                <option value="">
                                                    {reportYear
                                                        ? (approvedPlansForYear.length === 0 ? 'No approved plan found' : 'Select plan')
                                                        : 'Select FY first'}
                                                </option>
                                                {approvedPlansForYear.map((plan) => (
                                                    <option key={plan.id} value={plan.id}>
                                                        {`FY ${plan.financialYear} — v${plan.version || 1} (Approved)`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {noApprovedPlan && reportYear && (
                                        <div className="yp-warning-banner">
                                            <FiAlertTriangle className="yp-warning-icon" />
                                            <div>
                                                <strong>No approved yearly plan found for FY {reportYear}</strong>
                                                <p>Please get your yearly plan approved by the MD before submitting an appraisal report.</p>
                                            </div>
                                        </div>
                                    )}

                                    {linkedKras.length > 0 && (
                                        <div style={{ marginTop: '8px' }}>
                                            <div className="yp-form-section-header" style={{ marginBottom: '12px' }}>
                                                <h3>Linked Plan — KRA Reference</h3>
                                                <p>The KRAs below will appear in Step 2 for individual achievement input.</p>
                                            </div>
                                            <KRATable rows={linkedKras} readOnly />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Step 2 — KRA Achievements ───────────────────── */}
                            {reportStep === 2 && (
                                <div className="yp-form-section" style={{ paddingTop: 0, borderBottom: 'none' }}>
                                    <div className="yp-form-section-header">
                                        <h3>KRA Achievement Input</h3>
                                        <p>Describe what you delivered against each KRA. Fill all cards to proceed.</p>
                                    </div>
                                    <KRAAssessmentCards
                                        kras={linkedKras}
                                        values={kraAchievements}
                                        onChange={(index, text) =>
                                            setKraAchievements(prev => ({ ...prev, [index]: text }))
                                        }
                                        readOnly={false}
                                    />
                                </div>
                            )}

                            {/* ── Step 3 — Review + Additional Assignments ─────── */}
                            {reportStep === 3 && (
                                <>
                                    <div className="yp-form-section" style={{ paddingTop: 0 }}>
                                        <div className="yp-form-section-header">
                                            <h3>Review — KRA Achievements</h3>
                                            <p>A read-only summary of your entries. Go back to edit.</p>
                                        </div>
                                        <KRAAssessmentCards
                                            kras={linkedKras}
                                            values={kraAchievements}
                                            readOnly
                                        />
                                    </div>

                                    <div className="yp-form-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                                        <div className="yp-form-section-header">
                                            <h3>Additional Assignments</h3>
                                            <p>Capture extra responsibilities handled beyond your planned KRAs.</p>
                                        </div>
                                        <div className="yp-form-group">
                                            <textarea
                                                placeholder="Describe any additional assignments, initiatives, or contributions made outside the KRA scope."
                                                value={additionalAssignments}
                                                onChange={(e) => setAdditionalAssignments(e.target.value)}
                                                style={{ minHeight: '150px' }}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                        </div>

                        {/* ── Sticky footer ──────────────────────────────────── */}
                        <div className="yp-modal-form-footer">
                            <div className="yp-step-footer">

                                {/* Left: Cancel (step 1) or Back (steps 2+) */}
                                <div className="yp-step-footer-left">
                                    {reportStep === 1 ? (
                                        <button type="button" className="btn btn-ghost" onClick={closeReportModal}>
                                            Cancel
                                        </button>
                                    ) : (
                                        <button type="button" className="btn btn-ghost" onClick={() => setReportStep(s => s - 1)}>
                                            ← Back
                                        </button>
                                    )}
                                </div>

                                {/* Right: context-aware actions */}
                                <div className="yp-step-footer-right">

                                    {/* Draft saved flash */}
                                    {draftSavedMsg && (
                                        <span className="yp-draft-saved" role="status">
                                            <FiCheckCircle /> Draft saved
                                        </span>
                                    )}

                                    {/* Save Draft (steps 2 & 3 only) */}
                                    {reportStep > 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={handleSaveDraftReport}
                                            disabled={savingDraft || submitting}
                                        >
                                            {savingDraft ? 'Saving…' : <><FiSave /> Save Draft</>}
                                        </button>
                                    )}

                                    {/* Step 1 Next */}
                                    {reportStep === 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            disabled={!reportYear || noApprovedPlan}
                                            onClick={() => setReportStep(2)}
                                        >
                                            Next →
                                        </button>
                                    )}

                                    {/* Step 2 Next — disabled until all KRAs filled */}
                                    {reportStep === 2 && (
                                        <>
                                            {!allKrasFilled && (
                                                <span className="yp-step-empty-warn" role="alert">
                                                    <FiAlertCircle />
                                                    {emptyKrasCount} KRA{emptyKrasCount !== 1 ? 's' : ''} still empty
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                disabled={!allKrasFilled}
                                                onClick={() => setReportStep(3)}
                                                title={!allKrasFilled ? `${emptyKrasCount} KRA${emptyKrasCount !== 1 ? 's' : ''} still need achievement text` : undefined}
                                            >
                                                Next →
                                            </button>
                                        </>
                                    )}

                                    {/* Step 3 Submit */}
                                    {reportStep === 3 && (
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            disabled={submitting || noApprovedPlan}
                                            onClick={handleSubmitReport}
                                        >
                                            {submitting ? 'Submitting…' : <><FiSend /> Submit Report</>}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </ModalShell>
            )}
        </div>
    );
};

export default YearlyPlanPage;