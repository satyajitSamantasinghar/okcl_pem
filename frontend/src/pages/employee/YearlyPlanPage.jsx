import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Returns the current Indian Financial Year string, e.g. "2026-27"
// Indian FY runs April → March, so months 1–3 belong to the previous FY start.
function getCurrentFinancialYear() {
    const now   = new Date();
    const month = now.getMonth() + 1; // 1-indexed
    const year  = now.getFullYear();
    const fyStart = month >= 4 ? year : year - 1;
    return `${fyStart}-${String(fyStart + 1).slice(-2)}`;
}
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

// ─── Resizable split panel (VS Code–style drag divider) ───────────────────────
//
// Drag perf notes:
//   • While dragging, the left pane's flex-basis is mutated directly via DOM
//     ref (bypassing React) so heavy children (tables, cards) never re-render
//     mid-drag — only on mousedown/mouseup do we touch React state.
//   • Movement is throttled to one update per animation frame.
//   • Pointer capture keeps the drag locked to the handle even if the cursor
//     leaves the page bounds mid-swipe (fast mouse movement).
//   • A transparent overlay covers the panel while dragging so iframes,
//     scrollbars, and text selection inside the panes can't steal the drag.

const ResizablePanel = ({ left, right, defaultSplit = 62, minLeftPx = 320, minRightPx = 280 }) => {
    const [split, setSplit] = useState(defaultSplit);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef(null);
    const leftPaneRef = useRef(null);
    const draggingRef = useRef(false);
    const rafRef = useRef(null);

    const clampPct = useCallback((pct, containerWidth) => {
        if (!containerWidth) return Math.max(20, Math.min(80, pct));
        const minLeftPct  = (minLeftPx  / containerWidth) * 100;
        const minRightPct = 100 - (minRightPx / containerWidth) * 100;
        const lo = Math.max(20, minLeftPct);
        const hi = Math.min(80, minRightPct);
        if (lo > hi) return (lo + hi) / 2; // container too small — split evenly
        return Math.max(lo, Math.min(hi, pct));
    }, [minLeftPx, minRightPx]);

    const beginDrag = useCallback(() => {
        draggingRef.current = true;
        setIsDragging(true);
        document.body.classList.add('yp-resizing');
    }, []);

    const handleMouseDown = useCallback((e) => {
        e.preventDefault();
        beginDrag();
    }, [beginDrag]);

    const handleTouchStart = useCallback(() => {
        beginDrag();
    }, [beginDrag]);

    const handleDoubleClick = useCallback(() => {
        setSplit(defaultSplit);
        if (leftPaneRef.current) leftPaneRef.current.style.flexBasis = `${defaultSplit}%`;
    }, [defaultSplit]);

    const handleKeyDown = useCallback((e) => {
        const STEP = 3;
        if (e.key === 'ArrowLeft')  { setSplit(s => clampPct(s - STEP, containerRef.current?.getBoundingClientRect().width)); }
        if (e.key === 'ArrowRight') { setSplit(s => clampPct(s + STEP, containerRef.current?.getBoundingClientRect().width)); }
        if (e.key === 'Home')       { setSplit(defaultSplit); }
    }, [clampPct, defaultSplit]);

    useEffect(() => {
        const updateAt = (clientX) => {
            if (!containerRef.current || !leftPaneRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const rawPct = ((clientX - rect.left) / rect.width) * 100;
            const pct = clampPct(rawPct, rect.width);
            leftPaneRef.current.style.flexBasis = `${pct}%`;
        };

        const onMove = (e) => {
            if (!draggingRef.current) return;
            const clientX = e.touches ? e.touches[0]?.clientX : e.clientX;
            if (clientX == null) return;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => updateAt(clientX));
        };

        const onUp = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            setIsDragging(false);
            document.body.classList.remove('yp-resizing');
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (leftPaneRef.current) {
                const finalPct = parseFloat(leftPaneRef.current.style.flexBasis);
                if (!Number.isNaN(finalPct)) setSplit(finalPct);
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [clampPct]);

    return (
        <div ref={containerRef} className={`yp-resizable-container${isDragging ? ' is-dragging' : ''}`}>
            <div ref={leftPaneRef} className="yp-resizable-pane" style={{ flex: `0 0 ${split}%` }}>
                {left}
            </div>
            <div
                className={`yp-resizer${isDragging ? ' is-active' : ''}`}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize panels"
                aria-valuenow={Math.round(split)}
                aria-valuemin={20}
                aria-valuemax={80}
            >
                <div className="yp-resizer-grip" />
                <span className="yp-resizer-tooltip">Drag to resize · Double-click to reset</span>
            </div>
            <div className="yp-resizable-pane" style={{ flex: '1 1 0' }}>
                {right}
            </div>
            {/* Drag-capture overlay — blocks text-select / iframe focus theft mid-drag */}
            {isDragging && <div className="yp-resize-overlay" />}
        </div>
    );
};

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

    // ── Edit plan via modal (DRAFT plans) ─────────────────────────────────────
    // null = creating new plan, plan.id = editing an existing draft via modal
    const [editPlanModalId, setEditPlanModalId] = useState(null);

    // -- Resubmit modal state (REJECTED plans) --
    const [resubmitModalOpen, setResubmitModalOpen] = useState(false);
    const [resubmitPlan, setResubmitPlan] = useState(null);   // full plan object
    const [resubmitKras, setResubmitKras] = useState(DEFAULT_KRA());
    const [resubmitDraftSaved, setResubmitDraftSaved] = useState(false);
    const [resubmitRefOpen, setResubmitRefOpen] = useState(false); // reference panel toggle

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
        const isOpen = showPlanForm || showReportForm || resubmitModalOpen;
        const prev = document.body.style.overflow;
        document.body.style.overflow = isOpen ? 'hidden' : prev;
        return () => { document.body.style.overflow = prev; };
    }, [showPlanForm, showReportForm, resubmitModalOpen]);

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

    // FYs where (a) an approved plan exists AND (b) no non-draft appraisal has been filed.
    // This powers the constrained dropdown in the Submit Appraisal modal.
    const eligibleReportYears = useMemo(() => {
        const approvedFYs = new Set(
            plans.filter(p => p.status === 'APPROVED').map(p => p.financialYear)
        );
        const submittedReportFYs = new Set(
            reports.filter(r => r.status !== 'DRAFT').map(r => r.financialYear)
        );
        return [...approvedFYs]
            .filter(fy => !submittedReportFYs.has(fy))
            .sort((a, b) => b.localeCompare(a));
    }, [plans, reports]);

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
        // Smart default: pre-select the current Indian financial year so the
        // employee doesn't have to pick it manually (they can still change it).
        setFinancialYear(getCurrentFinancialYear());
        setEditPlanModalId(null);
        setShowPlanForm(true);
        setShowReportForm(false);
    };

    const openReportModal = () => {
        // If exactly one FY is eligible for a new appraisal, auto-select it so
        // the employee skips the picker entirely (Constrained Auto-Selection pattern).
        const autoYear = eligibleReportYears.length === 1 ? eligibleReportYears[0] : '';
        setReportYear(autoYear);
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

    const closePlanModal   = () => { setShowPlanForm(false); setEditPlanModalId(null); };

    const openResubmitModal = (plan) => {
        setResubmitPlan(plan);
        // Deep-clone so edits don't mutate the plan object in state
        setResubmitKras(plan.kras && plan.kras.length > 0
            ? plan.kras.map(k => ({ description: k.description, target: k.target, timeline: k.timeline }))
            : DEFAULT_KRA()
        );
        setResubmitDraftSaved(false);
        setResubmitRefOpen(false);
        setResubmitModalOpen(true);
        setShowPlanForm(false);
        setShowReportForm(false);
    };

    const closeResubmitModal = () => {
        setResubmitModalOpen(false);
        setResubmitPlan(null);
        setResubmitKras(DEFAULT_KRA());
    };
    const closeReportModal = () => setShowReportForm(false);

    // ── Open plan modal in edit mode (DRAFT) ──────────────────────────────────

    const openEditPlanModal = (plan) => {
        setKras(plan.kras && plan.kras.length > 0 ? [...plan.kras] : DEFAULT_KRA());
        setFinancialYear(plan.financialYear);
        setEditPlanModalId(plan.id);
        setShowPlanForm(true);
        setShowReportForm(false);
    };

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

    // ── KRA identity check — returns true when new KRAs are unchanged from original ─
    const krasAreIdentical = (original, revised) => {
        if (!Array.isArray(original) || !Array.isArray(revised)) return false;
        if (original.length !== revised.length) return false;
        return original.every((orig, i) => {
            const rev = revised[i];
            return (
                (orig.description || '').trim() === (rev.description || '').trim() &&
                (orig.target || '').trim()      === (rev.target || '').trim()      &&
                (orig.timeline || '').trim()    === (rev.timeline || '').trim()
            );
        });
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

    // ── Submit Plan (new) OR Edit Draft via Modal ─────────────────────────────

    const handleSubmitPlan = async (e, asDraft = false) => {
        e.preventDefault();

        if (asDraft && (!Array.isArray(kras) || kras.length === 0)) {
            toast.error('Add at least one KRA before saving a draft.');
            return;
        }
        if (!asDraft) {
            const err = validateKras(kras);
            if (err) { toast.error(err); return; }
        }

        // ── Editing an existing DRAFT plan via modal ─────────────────────────
        if (editPlanModalId) {
            setSubmitting(true);
            try {
                await api.put(`/employee/yearly-plan/${editPlanModalId}`, {
                    kras,
                    status: asDraft ? 'DRAFT' : 'PENDING',
                });
                toast.success(asDraft ? 'Draft updated successfully.' : 'Plan submitted for review.');
                setShowPlanForm(false);
                setEditPlanModalId(null);
                await fetchData();
            } catch (err) {
                toast.error(err.response?.data?.message || 'Update failed');
            } finally {
                setSubmitting(false);
            }
            return;
        }

        // ── Creating a new plan ───────────────────────────────────────────────
        if (!financialYear) { toast.error('Please select a financial year.'); return; }
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

    // ── Resubmit REJECTED plan ────────────────────────────────────────────────

    const handleResubmitPlan = async (asDraft = false) => {
        const kraErr = validateKras(resubmitKras);
        if (kraErr) { toast.error(kraErr); return; }

        // Enforce modification constraint — must not be identical to rejected plan
        if (!asDraft && krasAreIdentical(resubmitPlan?.kras, resubmitKras)) {
            toast.error('You must modify at least one KRA before resubmitting. The plan cannot be identical to the rejected version.');
            return;
        }

        // Auto-generate a system revision reason so backend validation passes
        const autoRevisionReason = `Revised by employee after MD rejection (v${resubmitPlan?.version || 1} → resubmission). MD had remarked: ${resubmitPlan?.mdRemarks || 'No remarks provided.'}`;

        setSubmitting(true);
        try {
            if (asDraft) {
                // Save locally — just update the plan's KRAs without changing status yet
                // We use the edit endpoint (PUT) to persist draft KRAs
                await api.put(`/employee/yearly-plan/${resubmitPlan.id}`, {
                    kras: resubmitKras,
                    status: 'REJECTED', // keep REJECTED status for draft
                });
                setResubmitDraftSaved(true);
                setTimeout(() => setResubmitDraftSaved(false), 2500);
                toast.success('Draft saved — you can come back to edit and submit later.');
                await fetchData();
            } else {
                await api.post(`/employee/yearly-plan/${resubmitPlan.id}/resubmit`, {
                    kras: resubmitKras,
                    revisionReason: autoRevisionReason,
                });
                toast.success('Yearly plan resubmitted successfully. Awaiting MD review.');
                closeResubmitModal();
                await fetchData();
            }
        } catch (err) {
            toast.error(err.response?.data?.message || (asDraft ? 'Draft save failed' : 'Resubmission failed'));
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
        const canEdit      = plan.status === 'DRAFT';
        const isRejected   = plan.status === 'REJECTED';
        const isApproved   = plan.status === 'APPROVED';
        const hasRevisions = Array.isArray(plan.revisionLog) && plan.revisionLog.length > 0;

        const leftPanel = (
            <div className="yp-detail-card yp-detail-card--main">
                <div className="yp-detail-card-header">
                    <div>
                        <h4>Key Result Areas (KRAs)</h4>
                        <p>Structured KRA plan submitted for MD review.</p>
                    </div>
                    {canEdit && (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditPlanModal(plan)}
                        >
                            <FiEdit3 /> Edit / Submit Draft
                        </button>
                    )}
                </div>
                <KRATable rows={plan.kras || []} readOnly />
            </div>
        );

        const rightPanel = (
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
        );

        return (
            <div className="yp-detail-panel">
                <ResizablePanel left={leftPanel} right={rightPanel} defaultSplit={62} />

                {isApproved && (
                    <div className="yp-note-banner is-approved">
                        <strong>Plan Approved by Managing Director</strong>
                        <p>{plan.mdRemarks || 'Your yearly plan has been approved.'}</p>
                    </div>
                )}

                {hasRevisions && (
                    <div className="yp-detail-card">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Revision History</h4>
                                <p>All revisions submitted for this plan.</p>
                            </div>
                        </div>
                        <div className="yp-history-list">
                            {plan.revisionLog.map((rev, idx) => (
                                <div key={idx} className="yp-history-item">
                                    <span className="yp-history-index">{idx + 1}</span>
                                    <div>
                                        <strong>Revision {idx + 1}</strong>
                                        <p>{rev.reason || '—'}</p>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>{formatDateTime(rev.revisedAt)}</p>
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
                                <p>{plan.mdRemarks || 'Your plan was rejected. Please revise and resubmit.'}</p>
                            </div>
                        </div>
                        <div className="yp-alert-actions">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => openResubmitModal(plan)}
                            >
                                <FiRefreshCw /> Revise &amp; Resubmit Plan
                            </button>
                            <p className="yp-alert-hint">
                                Opens a guided form pre-filled with your rejected KRAs. Modify at least one KRA to resubmit.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ── Render expanded report row ────────────────────────────────────────────

    const renderReportExpanded = (report) => {
        const kraAssessments    = Array.isArray(report.kraAssessments) ? report.kraAssessments : [];
        const hasKraAssessments = kraAssessments.length > 0;

        const krasForDisplay   = kraAssessments.map(k => ({ description: k.description, target: k.target, timeline: k.timeline }));
        const valuesForDisplay = Object.fromEntries(kraAssessments.map((k, i) => [i, k.achievement]));

        const leftPanel = (
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
                        <KRAAssessmentCards kras={krasForDisplay} values={valuesForDisplay} readOnly />
                    ) : (
                        report.workKRA ? (
                            <div className="yp-prose-block">{report.workKRA}</div>
                        ) : (
                            <p className="kra-ac-no-kras">No KRA assessments recorded.</p>
                        )
                    )}
                </div>
            </div>
        );

        const rightPanel = (
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
        );

        return (
            <div className="yp-detail-panel">
                <ResizablePanel left={leftPanel} right={rightPanel} defaultSplit={62} />

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
                        onToggle={(nextId) => setExpandedPlanId(nextId)}
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
                    title={editPlanModalId ? 'Edit Draft Plan' : 'Submit Yearly Plan'}
                    subtitle={editPlanModalId
                        ? 'Update your KRA-based targets and submit for MD review, or save as draft.'
                        : 'Define your KRA-based yearly targets, measurable outcomes, and timelines.'}
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
                                    {editPlanModalId ? (
                                        <div className="yp-form-year-display">
                                            <strong>{`FY ${financialYear}`}</strong>
                                            <span className="yp-form-year-lock">
                                                <FiSave style={{ width: 12, height: 12 }} /> Locked — editing existing draft
                                            </span>
                                        </div>
                                    ) : (
                                        <>
                                            <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} required>
                                                <option value="">Select Financial Year</option>
                                                {yearOptions.map((year) => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                            {financialYear === getCurrentFinancialYear() && (
                                                <p className="yp-field-hint">
                                                    <FiCheckCircle style={{ width: 11, height: 11 }} /> Current financial year pre-selected
                                                </p>
                                            )}
                                        </>
                                    )}
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
                Resubmit Rejected Yearly Plan Modal
            ══════════════════════════════════════════════════════════════════ */}
            {resubmitModalOpen && resubmitPlan && (() => {
                const originalKras = resubmitPlan.kras || [];
                const isUnchanged  = krasAreIdentical(originalKras, resubmitKras);

                return (
                    <ModalShell
                        title="Revise & Resubmit Yearly Plan"
                        subtitle={`FY ${resubmitPlan.financialYear} · v${resubmitPlan.version || 1} → Resubmission — Address the MD's feedback and update your KRAs.`}
                        icon={<FiRefreshCw />}
                        onClose={closeResubmitModal}
                    >
                        <div className="yp-modal-form">
                            <div className="yp-modal-form-body">

                                {/* ── MD Rejection Notice ─────────────────────── */}
                                <div className="yp-resubmit-rejection-note">
                                    <div className="yp-resubmit-rejection-header">
                                        <FiAlertCircle className="yp-resubmit-rejection-icon" />
                                        <div>
                                            <strong>Rejected by Managing Director</strong>
                                            <p>{resubmitPlan.mdRemarks || 'No specific remarks were provided. Please review and revise your KRAs.'}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Reference: Original Rejected KRAs ──────── */}
                                <div className="yp-resubmit-reference">
                                    <button
                                        type="button"
                                        className="yp-resubmit-reference-toggle"
                                        onClick={() => setResubmitRefOpen(o => !o)}
                                        aria-expanded={resubmitRefOpen}
                                    >
                                        <span className="yp-resubmit-reference-label">
                                            <FiEye />
                                            View Original Rejected Plan (v{resubmitPlan.version || 1})
                                        </span>
                                        {resubmitRefOpen ? <FiChevronUp /> : <FiChevronDown />}
                                    </button>
                                    <div className={`yp-resubmit-ref-body${resubmitRefOpen ? ' is-open' : ''}`}>
                                        <div className="yp-resubmit-ref-inner">
                                            <p className="yp-resubmit-ref-hint">
                                                This is a read-only view of the plan that was rejected. Use it as reference while revising your KRAs below.
                                            </p>
                                            <KRATable rows={originalKras} readOnly />
                                        </div>
                                    </div>
                                </div>

                                {/* ── Editable Revised KRAs ───────────────────── */}
                                <div className="yp-form-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                                    <div className="yp-form-section-header">
                                        <h3>Revised Key Result Areas (KRAs)</h3>
                                        <p>Update your KRA descriptions, targets, and timelines to address the MD's feedback. At least one change is required before you can resubmit.</p>
                                    </div>
                                    <KRATable rows={resubmitKras} onChange={setResubmitKras} />

                                    {/* Modification constraint warning */}
                                    {isUnchanged && (
                                        <div className="yp-unchanged-warning" role="alert">
                                            <FiAlertTriangle className="yp-unchanged-warning-icon" />
                                            <div>
                                                <strong>No changes detected</strong>
                                                <p>Your KRAs are identical to the rejected version. Please modify at least one KRA (description, target, or timeline) before resubmitting.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                            </div>

                            {/* ── Sticky Footer ───────────────────────────────── */}
                            <div className="yp-modal-form-footer">
                                <div className="yp-form-actions">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={submitting || isUnchanged}
                                        title={isUnchanged ? 'Modify at least one KRA to enable resubmission' : undefined}
                                        onClick={() => handleResubmitPlan(false)}
                                    >
                                        {submitting ? 'Resubmitting…' : <><FiSend /> Resubmit Plan</>}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={submitting}
                                        onClick={() => handleResubmitPlan(true)}
                                    >
                                        {resubmitDraftSaved ? <><FiCheckCircle /> Saved!</> : <><FiSave /> Save Draft</>}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        disabled={submitting}
                                        onClick={closeResubmitModal}
                                    >
                                        Cancel
                                    </button>
                                </div>
                                {isUnchanged && (
                                    <p className="yp-unchanged-footer-hint">
                                        <FiAlertCircle style={{ width: 13, height: 13 }} />
                                        Resubmission is blocked until you modify at least one KRA.
                                    </p>
                                )}
                            </div>
                        </div>
                    </ModalShell>
                );
            })()}

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

                                            {/* Case 1: editing an existing draft — FY is locked */}
                                            {reportDraftId ? (
                                                <div className="yp-form-year-display">
                                                    <strong>{`FY ${reportYear}`}</strong>
                                                    <span className="yp-form-year-lock">
                                                        <FiSave style={{ width: 12, height: 12 }} /> Locked — editing existing draft
                                                    </span>
                                                </div>

                                            /* Case 2: exactly one eligible FY — auto-selected, no picker needed */
                                            ) : eligibleReportYears.length === 1 ? (
                                                <div className="yp-form-year-display yp-form-year-display--auto">
                                                    <strong>{`FY ${reportYear}`}</strong>
                                                    <span className="yp-form-year-auto">
                                                        <FiCheckCircle style={{ width: 12, height: 12 }} /> Auto-selected
                                                    </span>
                                                </div>

                                            /* Case 3: multiple or zero eligible FYs — show constrained dropdown */
                                            ) : (
                                                <select
                                                    value={reportYear}
                                                    onChange={(e) => setReportYear(e.target.value)}
                                                    required
                                                    disabled={eligibleReportYears.length === 0}
                                                >
                                                    <option value="">
                                                        {eligibleReportYears.length === 0
                                                            ? 'No eligible financial years'
                                                            : 'Select Financial Year'}
                                                    </option>
                                                    {eligibleReportYears.map((year) => (
                                                        <option key={year} value={year}>{year}</option>
                                                    ))}
                                                </select>
                                            )}
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

                                    {/* Zero-eligible state: explain why, don't leave the user guessing */}
                                    {!reportDraftId && eligibleReportYears.length === 0 && (
                                        <div className="yp-warning-banner">
                                            <FiAlertTriangle className="yp-warning-icon" />
                                            <div>
                                                <strong>No appraisal submissions available</strong>
                                                <p>All financial years with approved plans already have an appraisal on record, or no yearly plan has been approved yet. Please ensure your yearly plan is approved by the MD before filing an appraisal report.</p>
                                            </div>
                                        </div>
                                    )}

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
                                            disabled={!reportYear || noApprovedPlan || (!reportDraftId && eligibleReportYears.length === 0)}
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