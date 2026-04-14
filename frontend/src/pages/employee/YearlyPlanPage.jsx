import { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiAlertCircle,
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
    FiSearch,
    FiSend,
    FiTarget,
    FiX,
} from 'react-icons/fi';
import './YearlyPlanPage.css';

const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];
const PAGE_SIZE = 5;

const PLAN_STATUS_OPTIONS = [
    { value: 'ALL', label: 'All Status' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'EDITED', label: 'Edited Before Approval' },
    { value: 'EDITED_AFTER_APPROVAL', label: 'Edited After Approval' },
];

const REPORT_STATUS_OPTIONS = [
    { value: 'ALL', label: 'All Status' },
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
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function formatDateTime(value) {
    if (!value) return '-';
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
        PENDING: { label: 'Pending', cls: 'pending', icon: <FiClock /> },
        APPROVED: { label: 'Approved', cls: 'approved', icon: <FiCheckCircle /> },
        REJECTED: { label: 'Rejected', cls: 'rejected', icon: <FiAlertCircle /> },
        EDITED: { label: 'Edited Before Approval', cls: 'edited', icon: <FiEdit3 /> },
        EDITED_AFTER_APPROVAL: { label: 'Edited After Approval', cls: 'edited', icon: <FiEdit3 /> },
    };
    return map[status] || { label: status || 'Draft', cls: 'draft', icon: <FiClock /> };
}

function getReportStatusInfo(status) {
    const map = {
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
    const lastEdit = plan?.editHistory?.length ? plan.editHistory[plan.editHistory.length - 1]?.editedAt : null;
    return lastEdit || plan?.submittedAt;
}

function getSearchTextForPlan(plan) {
    return normalizeText([
        plan.financialYear,
        plan.status,
        plan.version,
        plan.planAndObjectives,
        plan.mdRemarks,
    ].join(' '));
}

function getSearchTextForReport(report) {
    return normalizeText([
        report.financialYear,
        report.status,
        report.workKRA,
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

const ModalShell = ({ title, subtitle, icon, onClose, children }) => (
    <div className="yp-modal-overlay" onClick={onClose}>
        <div className="yp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yp-modal-header">
                <div className="yp-modal-title-wrap">
                    <div className="yp-modal-icon">{icon}</div>
                    <div>
                        <h2>{title}</h2>
                        <p>{subtitle}</p>
                    </div>
                </div>
                <button className="yp-modal-close" type="button" onClick={onClose} aria-label="Close">
                    <FiX />
                </button>
            </div>
            <div className="yp-modal-body">{children}</div>
        </div>
    </div>
);

const FilterBar = ({
    years,
    year,
    status,
    search,
    sort,
    statusOptions,
    searchPlaceholder,
    onYearChange,
    onStatusChange,
    onSearchChange,
    onSortChange,
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

const Pagination = ({ totalItems, page, onPageChange }) => {
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const start = totalItems === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);

    if (totalPages <= 1) return null;

    return (
        <div className="yp-pagination">
            <div className="yp-pagination-summary">{`Showing ${start}-${end} of ${totalItems}`}</div>
            <button type="button" className="yp-page-btn" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                Previous
            </button>
            <div className="yp-page-numbers">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                        type="button"
                        key={pageNumber}
                        className={`yp-page-number${pageNumber === page ? ' is-active' : ''}`}
                        onClick={() => onPageChange(pageNumber)}
                    >
                        {pageNumber}
                    </button>
                ))}
            </div>
            <button type="button" className="yp-page-btn" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
                Next
            </button>
        </div>
    );
};

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
            {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="yp-summary-card">
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
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="yp-skeleton-row">
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

const AccordionTable = ({ columns, rows, expandedId, onToggle, renderExpanded, emptyState }) => {
    if (rows.length === 0) return emptyState;

    return (
        <div className="yp-list-shell">
            <div className="yp-table-desktop">
                <table className="yp-table">
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th key={column.key} className={column.headerClassName}>{column.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const isExpanded = expandedId === row._id;
                            return (
                                <tr key={row._id} className="yp-table-group-row">
                                    <td colSpan={columns.length}>
                                        <div className={`yp-table-row-wrap${isExpanded ? ' is-expanded' : ''}`}>
                                            <table className="yp-table yp-table--inner">
                                                <tbody>
                                                    <tr className="yp-table-row">
                                                        {columns.map((column) => (
                                                            <td key={column.key} className={column.cellClassName}>
                                                                {column.render(row, isExpanded, onToggle)}
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
                    const isExpanded = expandedId === row._id;
                    return (
                        <div key={row._id} className={`yp-mobile-card${isExpanded ? ' is-expanded' : ''}`}>
                            <div className="yp-mobile-grid">
                                {columns.map((column) => (
                                    <div key={column.key} className="yp-mobile-field">
                                        <span className="yp-mobile-label">{column.label}</span>
                                        <div className="yp-mobile-value">{column.render(row, isExpanded, onToggle)}</div>
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

const YearlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('plans');

    const [showPlanForm, setShowPlanForm] = useState(false);
    const [financialYear, setFinancialYear] = useState('');
    const [planAndObjectives, setPlanAndObjectives] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [editingPlanId, setEditingPlanId] = useState(null);
    const [editPlanAndObjectives, setEditPlanAndObjectives] = useState('');

    const [showReportForm, setShowReportForm] = useState(false);
    const [reportYear, setReportYear] = useState('');
    const [workKRA, setWorkKRA] = useState('');
    const [additionalAssignments, setAdditionalAssignments] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');

    const [resubmittingPlanId, setResubmittingPlanId] = useState(null);
    const [resubmitContent, setResubmitContent] = useState('');
    const [showHistoryFor, setShowHistoryFor] = useState(null);

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

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        const isModalOpen = showPlanForm || showReportForm;
        const previous = document.body.style.overflow;
        document.body.style.overflow = isModalOpen ? 'hidden' : previous;
        return () => {
            document.body.style.overflow = previous;
        };
    }, [showPlanForm, showReportForm]);

    useEffect(() => {
        setPlanPage(1);
    }, [planYearFilter, planStatusFilter, planSearch, planSort]);

    useEffect(() => {
        setReportPage(1);
    }, [reportYearFilter, reportStatusFilter, reportSearch, reportSort]);

    const availableYears = useMemo(() => {
        const values = new Set(yearOptions);
        plans.forEach((item) => values.add(item.financialYear));
        reports.forEach((item) => values.add(item.financialYear));
        return [...values].filter(Boolean).sort((a, b) => b.localeCompare(a));
    }, [plans, reports]);

    const filteredPlans = useMemo(() => {
        const query = normalizeText(planSearch);
        const items = plans.filter((plan) => {
            const yearMatches = planYearFilter === 'ALL' || plan.financialYear === planYearFilter;
            const statusMatches = planStatusFilter === 'ALL' || plan.status === planStatusFilter;
            const searchMatches = !query || getSearchTextForPlan(plan).includes(query);
            return yearMatches && statusMatches && searchMatches;
        });
        return sortItems(items, planSort, getPlanLastUpdated);
    }, [plans, planYearFilter, planStatusFilter, planSearch, planSort]);

    const filteredReports = useMemo(() => {
        const query = normalizeText(reportSearch);
        const items = reports.filter((report) => {
            const yearMatches = reportYearFilter === 'ALL' || report.financialYear === reportYearFilter;
            const statusMatches = reportStatusFilter === 'ALL' || report.status === reportStatusFilter;
            const searchMatches = !query || getSearchTextForReport(report).includes(query);
            return yearMatches && statusMatches && searchMatches;
        });
        return sortItems(items, reportSort, (report) => report.updatedAt || report.submittedAt);
    }, [reports, reportYearFilter, reportStatusFilter, reportSearch, reportSort]);

    const pagedPlans = useMemo(() => paginate(filteredPlans, planPage), [filteredPlans, planPage]);
    const pagedReports = useMemo(() => paginate(filteredReports, reportPage), [filteredReports, reportPage]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(filteredPlans.length / PAGE_SIZE));
        if (planPage > totalPages) setPlanPage(totalPages);
    }, [filteredPlans.length, planPage]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
        if (reportPage > totalPages) setReportPage(totalPages);
    }, [filteredReports.length, reportPage]);

    const openPlanModal = () => {
        setShowPlanForm(true);
        setShowReportForm(false);
    };

    const openReportModal = () => {
        setShowReportForm(true);
        setShowPlanForm(false);
    };

    const closePlanModal = () => {
        setShowPlanForm(false);
    };

    const closeReportModal = () => {
        setShowReportForm(false);
    };

    const handleSubmitPlan = async (e) => {
        e.preventDefault();
        if (!financialYear || !planAndObjectives.trim()) {
            toast.error('Please fill all required fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-plan', { financialYear, planAndObjectives });
            toast.success('Yearly plan submitted successfully');
            setFinancialYear('');
            setPlanAndObjectives('');
            setShowPlanForm(false);
            await fetchData();
            setActiveTab('plans');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const startEditing = (plan) => {
        setExpandedPlanId(plan._id);
        setResubmittingPlanId(null);
        setShowHistoryFor(null);
        setEditingPlanId(plan._id);
        setEditPlanAndObjectives(plan.planAndObjectives);
    };

    const handleEditPlan = async (e) => {
        e.preventDefault();
        if (!editPlanAndObjectives.trim()) {
            toast.error('Plan and objectives cannot be empty');
            return;
        }
        setSubmitting(true);
        try {
            await api.put(`/employee/yearly-plan/${editingPlanId}`, {
                planAndObjectives: editPlanAndObjectives,
            });
            toast.success('Plan updated successfully');
            setEditingPlanId(null);
            setEditPlanAndObjectives('');
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Update failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleResubmitPlan = async (e) => {
        e.preventDefault();
        if (!resubmitContent.trim()) {
            toast.error('Plan content cannot be empty');
            return;
        }
        setSubmitting(true);
        try {
            await api.post(`/employee/yearly-plan/${resubmittingPlanId}/resubmit`, {
                planAndObjectives: resubmitContent,
            });
            toast.success('Yearly plan resubmitted successfully');
            setResubmittingPlanId(null);
            setResubmitContent('');
            await fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Resubmission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitReport = async (e) => {
        e.preventDefault();
        if (!reportYear || !workKRA.trim()) {
            toast.error('Please fill all required fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-appraisal-report', {
                yearlyPlanId: selectedPlanId || null,
                financialYear: reportYear,
                workKRA,
                additionalAssignments,
            });
            toast.success('Yearly appraisal report submitted successfully');
            setReportYear('');
            setWorkKRA('');
            setAdditionalAssignments('');
            setSelectedPlanId('');
            setShowReportForm(false);
            await fetchData();
            setActiveTab('reports');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    const printReport = (report) => {
        const printWin = window.open('', '_blank');
        if (!printWin) {
            toast.error('Please allow popups to download the report');
            return;
        }
        printWin.document.write(`
            <html>
                <head>
                    <title>Appraisal Report FY ${report.financialYear}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 32px; color: #1e293b; }
                        h2 { margin-bottom: 8px; }
                        .label { font-weight: 700; font-size: 12px; color: #64748b; text-transform: uppercase; margin-top: 18px; }
                        .value { margin: 6px 0 12px; line-height: 1.7; white-space: pre-wrap; }
                        .remark { border-left: 3px solid #f97316; padding: 10px 12px; margin: 8px 0; background: #fff7ed; }
                    </style>
                </head>
                <body>
                    <h2>Annual Appraisal Report - FY ${report.financialYear}</h2>
                    <div class="label">Work / KRA Self-Assessment</div>
                    <div class="value">${report.workKRA || ''}</div>
                    ${report.additionalAssignments ? `<div class="label">Additional Assignments</div><div class="value">${report.additionalAssignments}</div>` : ''}
                    ${report.raRemarks ? `<div class="label">RA Remarks</div><div class="remark">${report.raRemarks}</div>` : ''}
                    ${report.hrdRemarks ? `<div class="label">HRD Remarks</div><div class="remark">${report.hrdRemarks}</div>` : ''}
                    ${report.mdRemarks ? `<div class="label">MD Remarks</div><div class="remark">${report.mdRemarks}</div>` : ''}
                </body>
            </html>
        `);
        printWin.document.close();
        printWin.print();
    };

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
                    onClick={() => onToggle(isExpanded ? null : plan._id)}
                >
                    <FiEye />
                    {isExpanded ? 'Hide' : 'View'}
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            ),
        },
    ];

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
                    onClick={() => onToggle(isExpanded ? null : report._id)}
                >
                    <FiEye />
                    {isExpanded ? 'Hide' : 'View'}
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                </button>
            ),
        },
    ];

    const renderPlanExpanded = (plan) => {
        const isEditing = editingPlanId === plan._id;
        const isRejected = plan.status === 'REJECTED';
        const hasHistory = Array.isArray(plan.editHistory) && plan.editHistory.length > 0;

        return (
            <div className="yp-detail-panel">
                <div className="yp-detail-grid">
                    <div className="yp-detail-card yp-detail-card--main">
                        <div className="yp-detail-card-header">
                            <div>
                                <h4>Plan and Objectives</h4>
                                <p>Full yearly target narrative submitted for review.</p>
                            </div>
                            {!isRejected && !isEditing && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditing(plan)}>
                                    <FiEdit3 /> Edit Plan
                                </button>
                            )}
                        </div>

                        {isEditing ? (
                            <form className="yp-form" onSubmit={handleEditPlan}>
                                <div className="yp-form-group">
                                    <label>Plan and Objectives</label>
                                    <textarea
                                        value={editPlanAndObjectives}
                                        onChange={(e) => setEditPlanAndObjectives(e.target.value)}
                                        required
                                        style={{ minHeight: '180px' }}
                                    />
                                </div>
                                <div className="yp-form-actions">
                                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                                        {submitting ? 'Saving...' : 'Save Changes'}
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setEditingPlanId(null)}>
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="yp-prose-block">{plan.planAndObjectives}</div>
                        )}
                    </div>

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
                        </div>
                    </div>
                </div>

                {plan.mdRemarks && (
                    <div className={`yp-note-banner${plan.status === 'APPROVED' ? ' is-approved' : ''}`}>
                        <strong>{plan.status === 'APPROVED' ? 'MD Approval Remarks' : 'MD Review Remarks'}</strong>
                        <p>{plan.mdRemarks}</p>
                    </div>
                )}

                {hasHistory && (
                    <div className="yp-detail-card">
                        <div className="yp-detail-card-header yp-detail-card-header--interactive">
                            <div>
                                <h4>Edit History</h4>
                                <p>{plan.editHistory.length} revision entries recorded for this plan.</p>
                            </div>
                            <button
                                type="button"
                                className="yp-link-btn"
                                onClick={() => setShowHistoryFor(showHistoryFor === plan._id ? null : plan._id)}
                            >
                                {showHistoryFor === plan._id ? 'Hide History' : 'View History'}
                                {showHistoryFor === plan._id ? <FiChevronUp /> : <FiChevronDown />}
                            </button>
                        </div>
                        {showHistoryFor === plan._id && (
                            <div className="yp-history-list">
                                {plan.editHistory.map((entry, index) => (
                                    <div key={`${plan._id}-${index}`} className="yp-history-item">
                                        <div className="yp-history-index">{index + 1}</div>
                                        <div>
                                            <strong>{entry.note || 'Plan updated'}</strong>
                                            <p>{formatDateTime(entry.editedAt)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {isRejected && (
                    <div className="yp-alert-panel">
                        <div className="yp-alert-header">
                            <FiAlertCircle className="yp-alert-icon" />
                            <div>
                                <h4>Plan Rejected by Managing Director</h4>
                                <p>Revise the yearly plan against the feedback and resubmit it for review.</p>
                            </div>
                        </div>
                        {resubmittingPlanId === plan._id ? (
                            <form className="yp-form" onSubmit={handleResubmitPlan}>
                                <div className="yp-form-group">
                                    <label>Revised Plan and Objectives</label>
                                    <textarea
                                        value={resubmitContent}
                                        onChange={(e) => setResubmitContent(e.target.value)}
                                        required
                                        style={{ minHeight: '180px' }}
                                    />
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
                                            setResubmitContent('');
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
                                    setResubmittingPlanId(plan._id);
                                    setResubmitContent(plan.planAndObjectives);
                                    setExpandedPlanId(plan._id);
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

    const renderReportExpanded = (report) => (
        <div className="yp-detail-panel">
            <div className="yp-detail-grid">
                <div className="yp-detail-card yp-detail-card--main">
                    <div className="yp-detail-card-header">
                        <div>
                            <h4>Work Done according to KRA</h4>
                            <p>Employee self-assessment according to yearly objectives and output.</p>
                        </div>
                    </div>
                    <div className="yp-prose-block">{report.workKRA}</div>
                </div>

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

            {(report.raRemarks || report.hrdRemarks || report.mdRemarks) && (
                <div className="yp-detail-card">
                    <div className="yp-detail-card-header">
                        <div>
                            <h4>Evaluator Remarks</h4>
                            <p>Remarks visible to the employee across review stages.</p>
                        </div>
                    </div>
                    <div className="yp-remarks-stack">
                        {report.raRemarks && (
                            <div className="yp-remark-card">
                                <span className="yp-remark-role">Reporting Authority</span>
                                <p>{report.raRemarks}</p>
                            </div>
                        )}
                        {report.hrdRemarks && (
                            <div className="yp-remark-card">
                                <span className="yp-remark-role">HRD</span>
                                <p>{report.hrdRemarks}</p>
                            </div>
                        )}
                        {report.mdRemarks && (
                            <div className="yp-remark-card">
                                <span className="yp-remark-role">Managing Director</span>
                                <p>{report.mdRemarks}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {report.status === 'COMPLETED' && (
                <div className="yp-detail-actions">
                    <button type="button" className="btn btn-primary" onClick={() => printReport(report)}>
                        <FiDownload /> Download PDF
                    </button>
                </div>
            )}
        </div>
    );

    if (loading) {
        return <LoadingSkeleton />;
    }

    return (
        <div className="yp-page fade-in">
            <section className="yp-hero">
                <div className="yp-hero-copy">
                    <span className="yp-hero-kicker">Performance Workspace</span>
                    <h1>Yearly Plan and Appraisal</h1>
                    <p>Manage yearly plan submissions and appraisal reports through a searchable, enterprise-ready review workspace.</p>
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

            <section className="yp-summary-strip">
                <div className="yp-summary-card">
                    <span>Plans Submitted</span>
                    <strong>{plans.length}</strong>
                </div>
                <div className="yp-summary-card">
                    <span>Appraisal Submitted</span>
                    <strong>{reports.length}</strong>
                </div>
                <div className="yp-summary-card">
                    <span>Completed Reports</span>
                    <strong>{reports.filter((report) => report.status === 'COMPLETED').length}</strong>
                </div>
            </section>

            <div className="yp-tabs">
                <button type="button" className={`yp-tab${activeTab === 'plans' ? ' active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <FiTarget /> Yearly Plans <span className="yp-tab-count">{plans.length}</span>
                </button>
                <button type="button" className={`yp-tab${activeTab === 'reports' ? ' active' : ''}`} onClick={() => setActiveTab('reports')}>
                    <FiFileText /> Appraisal Reports <span className="yp-tab-count">{reports.length}</span>
                </button>
            </div>

            {activeTab === 'plans' && (
                <section className="yp-panel">
                    <div className="yp-panel-header">
                        <div>
                            <h2>Yearly Plan List</h2>
                            <p>Track yearly plan versions, approval status, and revision history in one place.</p>
                        </div>
                    </div>

                    <FilterBar
                        years={availableYears}
                        year={planYearFilter}
                        status={planStatusFilter}
                        search={planSearch}
                        sort={planSort}
                        statusOptions={PLAN_STATUS_OPTIONS}
                        searchPlaceholder="Search year, version, plan text, or remarks"
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
                                setShowHistoryFor(null);
                            }
                        }}
                        renderExpanded={renderPlanExpanded}
                        emptyState={(
                            <EmptyState
                                icon={<FiTarget />}
                                title="No Yearly Plan Submitted Yet"
                                message="Create your first yearly plan to start the annual planning workflow."
                                actionLabel="Submit Yearly Plan"
                                onAction={openPlanModal}
                            />
                        )}
                    />

                    <Pagination totalItems={filteredPlans.length} page={planPage} onPageChange={setPlanPage} />
                </section>
            )}

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
                                message="Submit a yearly appraisal report once your self-assessment is ready."
                                actionLabel="Submit Appraisal Report"
                                onAction={openReportModal}
                            />
                        )}
                    />

                    <Pagination totalItems={filteredReports.length} page={reportPage} onPageChange={setReportPage} />
                </section>
            )}

            {showPlanForm && (
                <ModalShell
                    title="Submit Yearly Plan"
                    subtitle="Capture your yearly objectives, success measures, and key focus areas."
                    icon={<FiTarget />}
                    onClose={closePlanModal}
                >
                    <form className="yp-modal-form" onSubmit={handleSubmitPlan}>
                        <div className="yp-modal-form-body">
                            <div className="yp-form-section">
                                <div className="yp-form-section-header">
                                    <h3>Planning Context</h3>
                                    <p>Select the financial year and create the submission context.</p>
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
                                    <h3>Plan Narrative</h3>
                                    <p>Document yearly goals, success metrics, milestones, and delivery expectations.</p>
                                </div>
                                <div className="yp-form-group">
                                    <label>Plan and Objectives <span className="required">*</span></label>
                                    <textarea
                                        placeholder="Write your yearly plan, objectives, milestones, and measurable outcomes."
                                        value={planAndObjectives}
                                        onChange={(e) => setPlanAndObjectives(e.target.value)}
                                        required
                                        style={{ minHeight: '240px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="yp-modal-form-footer">
                            <div className="yp-form-actions">
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : 'Submit Plan'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={closePlanModal}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                </ModalShell>
            )}

            {showReportForm && (
                <ModalShell
                    title="Submit Appraisal Report"
                    subtitle="Share work delivered against KRA and any additional assignments completed."
                    icon={<FiFileText />}
                    onClose={closeReportModal}
                >
                    <form className="yp-modal-form" onSubmit={handleSubmitReport}>
                        <div className="yp-modal-form-body">
                            <div className="yp-form-section">
                                <div className="yp-form-section-header">
                                    <h3>Submission Context</h3>
                                    <p>Choose the financial year and link the report to a yearly plan when relevant.</p>
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
                                        <label>Link to Yearly Plan</label>
                                        <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                                            <option value="">None</option>
                                            {plans.map((plan) => (
                                                <option key={plan._id} value={plan._id}>{`FY ${plan.financialYear} - v${plan.version || 1}`}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="yp-form-section">
                                <div className="yp-form-section-header">
                                    <h3>Self Assessment</h3>
                                    <p>Provide detailed delivery against KRA and list additional responsibilities completed.</p>
                                </div>
                                <div className="yp-form-group">
                                    <label>Work / KRA Self-Assessment <span className="required">*</span></label>
                                    <textarea
                                        placeholder="Describe the work completed against your yearly KRA and outcomes delivered."
                                        value={workKRA}
                                        onChange={(e) => setWorkKRA(e.target.value)}
                                        required
                                        style={{ minHeight: '220px' }}
                                    />
                                </div>
                                <div className="yp-form-group">
                                    <label>Additional Assignments</label>
                                    <textarea
                                        placeholder="Capture extra assignments handled beyond the planned KRA."
                                        value={additionalAssignments}
                                        onChange={(e) => setAdditionalAssignments(e.target.value)}
                                        style={{ minHeight: '150px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="yp-modal-form-footer">
                            <div className="yp-form-actions">
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : 'Submit Report'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={closeReportModal}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                </ModalShell>
            )}
        </div>
    );
};

export default YearlyPlanPage;
