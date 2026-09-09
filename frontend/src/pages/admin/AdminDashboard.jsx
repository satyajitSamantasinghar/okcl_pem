import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiCalendar, FiUsers, FiFileText, FiCheckCircle, FiAlertCircle,
    FiFilter, FiSearch, FiX, FiDownload, FiChevronLeft, FiChevronRight,
    FiChevronUp, FiChevronDown, FiBarChart2, FiShield,
} from 'react-icons/fi';
import './AdminDashboard.css';

/* ─────────────────────────────────────────
   CONSTANTS / HELPERS
───────────────────────────────────────── */
const GO_LIVE_MONTH = '2026-05';

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthStr) {
    if (!monthStr) return '—';
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_OPTIONS = [
    { value: 'ALL',           label: 'All Statuses' },
    { value: 'NOT_SUBMITTED', label: 'No Plan' },
    { value: 'PLAN_ONLY',     label: 'Plan Only / Incomplete' },
    { value: 'COMPLETE',      label: 'Complete' },
];

const SORT_FIELDS = [
    { value: 'name',             label: 'Name' },
    { value: 'department',       label: 'Department' },
    { value: 'complianceStatus', label: 'Status' },
    { value: 'planSubmittedAt',  label: 'Plan Date' },
];

const ROWS_PER_PAGE = 20;

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
const StatCard = ({ icon, value, label, sub, color }) => (
    <div className={`adm-stat-card adm-stat-card--${color}`}>
        <div className="adm-stat-top">
            <div className={`adm-stat-icon adm-stat-icon--${color}`}>{icon}</div>
            <strong className="adm-stat-value">{value ?? '—'}</strong>
        </div>
        <div className="adm-stat-bottom">
            <span className="adm-stat-label">{label}</span>
            {sub && <span className="adm-stat-sub">{sub}</span>}
        </div>
    </div>
);

/* ─────────────────────────────────────────
   ACHIEVEMENT STATUS BADGE
───────────────────────────────────────── */
const AchBadge = ({ status }) => {
    if (status === 'COMPLETE')
        return <span className="adm-badge adm-badge--complete"><FiCheckCircle size={10} /> Complete</span>;
    if (status === 'INCOMPLETE')
        return <span className="adm-badge adm-badge--incomplete"><FiAlertCircle size={10} /> Incomplete</span>;
    return <span className="adm-badge adm-badge--not-started">Not Started</span>;
};

/* ─────────────────────────────────────────
   SORT ICON
───────────────────────────────────────── */
const SortIcon = ({ field, sortField, sortDir }) => {
    if (sortField !== field) return <span className="adm-sort-neutral">⇅</span>;
    return sortDir === 'asc'
        ? <FiChevronUp className="adm-sort-active" />
        : <FiChevronDown className="adm-sort-active" />;
};

/* ─────────────────────────────────────────
   DEPT BREAKDOWN TABLE (inside summary)
───────────────────────────────────────── */
const DeptBreakdown = ({ rows, activeDept, onToggle }) => {
    if (!rows || rows.length === 0) return null;
    return (
        <div className="adm-dept-table">
            <div className="adm-dept-table-head">
                <div>Department</div>
                <div>Employees</div>
                <div>Plan ✓</div>
                <div>Progress ✓</div>
                <div>No Plan</div>
                <div>Plan Only/Incomplete</div>
            </div>
            {rows.map(d => (
                <div
                    key={d.department}
                    className={`adm-dept-table-row${activeDept === d.department ? ' adm-dept-table-row--active' : ''}`}
                    onClick={() => onToggle(d.department)}
                    title="Click to filter employee list by this department"
                >
                    <div className="adm-dept-name">{d.department}</div>
                    <div>{d.totalEmployees}</div>
                    <div className="adm-dept-green">{d.planSubmitted}</div>
                    <div className="adm-dept-green">{d.achievementSubmitted}</div>
                    <div className="adm-dept-red">{d.noPlan}</div>
                    <div className="adm-dept-amber">{d.planOnlyOrIncomplete}</div>
                </div>
            ))}
        </div>
    );
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const AdminDashboard = () => {
    // ── Month selector ────────────────────────────────────────────────────
    const [month, setMonth] = useState(() => {
        const cur = getCurrentMonth();
        return cur < GO_LIVE_MONTH ? GO_LIVE_MONTH : cur;
    });

    // ── Summary state ─────────────────────────────────────────────────────
    const [summary, setSummary]           = useState(null);
    const [summaryLoading, setSummaryLoading] = useState(true);

    // ── Employee list state ───────────────────────────────────────────────
    const [employees, setEmployees]   = useState([]);
    const [listMeta, setListMeta]     = useState({ total: 0, totalPages: 1 });
    const [listLoading, setListLoading] = useState(true);

    // ── Filters ───────────────────────────────────────────────────────────
    const [deptFilter, setDeptFilter]     = useState('');   // '' = all
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [search, setSearch]             = useState('');
    const [page, setPage]                 = useState(1);
    const [sortField, setSortField]       = useState('name');
    const [sortDir, setSortDir]           = useState('asc');

    // ── Export state ──────────────────────────────────────────────────────
    const [exporting, setExporting] = useState(false);
    const [exportFormat, setExportFormat] = useState('department'); // 'department' | 'ra'

    /* ── Fetch summary ── */
    const fetchSummary = useCallback(async () => {
        setSummaryLoading(true);
        try {
            const res = await api.get('/admin/dashboard-summary', { params: { month } });
            setSummary(res.data);
        } catch {
            toast.error('Failed to load dashboard summary');
        } finally {
            setSummaryLoading(false);
        }
    }, [month]);

    /* ── Fetch employee list ── */
    const fetchEmployees = useCallback(async () => {
        setListLoading(true);
        try {
            const params = {
                month,
                page,
                limit: ROWS_PER_PAGE,
                sort: sortField,
                order: sortDir,
            };
            if (deptFilter)                 params.department = deptFilter;
            if (statusFilter !== 'ALL')     params.status     = statusFilter;
            if (search.trim())              params.search     = search.trim();

            const res = await api.get('/admin/employees', { params });
            setEmployees(res.data.data || []);
            setListMeta({ total: res.data.total, totalPages: res.data.totalPages });
        } catch {
            toast.error('Failed to load employee list');
        } finally {
            setListLoading(false);
        }
    }, [month, page, sortField, sortDir, deptFilter, statusFilter, search]);

    useEffect(() => { fetchSummary(); }, [fetchSummary]);
    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    /* ── Reset page when filters/month change ── */
    useEffect(() => { setPage(1); }, [month, deptFilter, statusFilter, search, sortField, sortDir]);

    /* ── Export PDF ── */
    const handleExportPdf = async () => {
        setExporting(true);
        try {
            const res = await api.get('/admin/export-pdf', {
                params: { month, groupBy: exportFormat === 'ra' ? 'ra' : undefined },
                responseType: 'blob',
            });
            const url  = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href     = url;
            link.download = `compliance-report-${month}${exportFormat === 'ra' ? '-by-ra' : ''}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.success('PDF downloaded');
        } catch {
            toast.error('Failed to export PDF');
        } finally {
            setExporting(false);
        }
    };

    /* ── Dept filter toggle (click row in dept table) ── */
    const toggleDeptFilter = (dept) => {
        setDeptFilter(prev => prev === dept ? '' : dept);
        setPage(1);
    };

    /* ── Sort toggle ── */
    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    /* ── Active filter chips ── */
    const hasFilterChips = deptFilter !== '' || statusFilter !== 'ALL';
    const clearAllFilters = () => { setDeptFilter(''); setStatusFilter('ALL'); setSearch(''); setPage(1); };

    // Month bounds
    const currentMonthStr = getCurrentMonth();

    return (
        <div className="adm-root fade-in">

            {/* ── Page Header ── */}
            <div className="adm-page-header">
                <div className="adm-page-header-left">
                    <div className="adm-page-eyebrow"><FiShield size={12} /> Admin Console</div>
                    <h1 className="adm-page-title">Admin Dashboard</h1>
                    <p className="adm-page-sub">
                        Organisation-wide compliance overview — {formatMonthLabel(month)}
                    </p>
                </div>

                {/* Month picker — matches HRDDashboard pattern */}
                <div className="adm-header-right">
                    <div className="adm-month-filter">
                        <FiCalendar size={14} />
                        <label>Viewing month</label>
                        <input
                            type="month"
                            value={month}
                            min={GO_LIVE_MONTH}
                            max={currentMonthStr}
                            onChange={e => setMonth(e.target.value)}
                        />
                    </div>

                    <div className="adm-export-group">
                        <select
                            className="adm-export-format-select"
                            value={exportFormat}
                            onChange={e => setExportFormat(e.target.value)}
                            title="PDF grouping format"
                        >
                            <option value="department">Group by Department</option>
                            <option value="ra">Group by Reporting Authority</option>
                        </select>
                        <button
                            className={`adm-export-btn${exporting ? ' adm-export-btn--loading' : ''}`}
                            onClick={handleExportPdf}
                            disabled={exporting}
                            title={`Export compliance report for ${formatMonthLabel(month)} as PDF`}
                        >
                            {exporting
                                ? <><span className="adm-btn-spinner" /> Exporting…</>
                                : <><FiDownload size={14} /> Export PDF</>
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Stat Cards ── */}
            {summaryLoading ? (
                <div className="adm-kpi-grid adm-kpi-skeleton">
                    {[0, 1, 2, 3].map(i => <div key={i} className="adm-stat-card adm-skeleton-card" />)}
                </div>
            ) : summary && (
                <div className="adm-kpi-grid">
                    <StatCard
                        icon={<FiUsers size={18} />}
                        value={summary.totalEmployees}
                        label="Total Employees"
                        sub="Active Employee & RA users"
                        color="blue"
                    />
                    <StatCard
                        icon={<FiFileText size={18} />}
                        value={summary.planSubmitted}
                        label="Plans Submitted"
                        sub={`${summary.noPlan} employees without a plan`}
                        color="green"
                    />
                    <StatCard
                        icon={<FiCheckCircle size={18} />}
                        value={summary.achievementSubmitted}
                        label="Progress Submitted"
                        sub="Achievement submitted (any completeness)"
                        color="teal"
                    />
                    <StatCard
                        icon={<FiAlertCircle size={18} />}
                        value={summary.planOnlyOrIncomplete}
                        label="Plan Only / Incomplete"
                        sub="Submitted plan but missing or incomplete progress"
                        color="amber"
                    />
                </div>
            )}

            {/* ── Department Breakdown ── */}
            {!summaryLoading && summary?.byDepartment?.length > 0 && (
                <div className="adm-section">
                    <div className="adm-section-header">
                        <div className="adm-section-title-row">
                            <FiBarChart2 size={14} />
                            <span className="adm-section-title">By Department</span>
                            {deptFilter && (
                                <span className="adm-dept-filter-note">
                                    Filtering list by: <strong>{deptFilter}</strong>
                                </span>
                            )}
                        </div>
                        <span className="adm-section-hint">Click a department row to filter the employee list</span>
                    </div>
                    <DeptBreakdown
                        rows={summary.byDepartment}
                        activeDept={deptFilter}
                        onToggle={toggleDeptFilter}
                    />
                </div>
            )}

            {/* ── Employee List Section ── */}
            <div className="adm-section">
                <div className="adm-section-header">
                    <div className="adm-section-title-row">
                        <FiUsers size={14} />
                        <span className="adm-section-title">Employee List</span>
                        <span className="adm-result-count">
                            {listLoading ? '…' : (
                                (hasFilterChips || search)
                                    ? `${listMeta.total} of ${summary?.totalEmployees ?? '?'}`
                                    : listMeta.total
                            )} employees
                        </span>
                    </div>
                </div>

                {/* ── Toolbar ── */}
                <div className="adm-toolbar">
                    {/* Search */}
                    <div className="adm-search-wrap">
                        <FiSearch size={13} className="adm-search-icon" />
                        <input
                            type="text"
                            className="adm-search-input"
                            placeholder="Search by name or employee code…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button className="adm-search-clear" onClick={() => { setSearch(''); setPage(1); }}>
                                <FiX size={12} />
                            </button>
                        )}
                    </div>

                    <div className="adm-toolbar-divider" />

                    {/* Department filter */}
                    <div className="adm-filter-group">
                        <label className="adm-filter-label" htmlFor="adm-dept-filter">
                            <FiFilter size={12} /> Department
                        </label>
                        <select
                            id="adm-dept-filter"
                            className="adm-filter-select"
                            value={deptFilter}
                            onChange={e => { setDeptFilter(e.target.value); setPage(1); }}
                        >
                            <option value="">All Departments</option>
                            {summary?.byDepartment?.map(d => (
                                <option key={d.department} value={d.department}>
                                    {d.department} ({d.totalEmployees})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="adm-toolbar-divider" />

                    {/* Status filter */}
                    <div className="adm-filter-group">
                        <label className="adm-filter-label" htmlFor="adm-status-filter">Status</label>
                        <select
                            id="adm-status-filter"
                            className="adm-filter-select"
                            value={statusFilter}
                            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                        >
                            {STATUS_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* ── Active Filter Chips ── */}
                {hasFilterChips && (
                    <div className="adm-active-filters">
                        <span className="adm-active-filters-label">Filters:</span>
                        {deptFilter && (
                            <button className="adm-filter-chip" onClick={() => { setDeptFilter(''); setPage(1); }} title="Remove department filter">
                                {deptFilter} <FiX size={11} />
                            </button>
                        )}
                        {statusFilter !== 'ALL' && (
                            <button className="adm-filter-chip" onClick={() => { setStatusFilter('ALL'); setPage(1); }} title="Remove status filter">
                                {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label} <FiX size={11} />
                            </button>
                        )}
                        <button className="adm-clear-filters" onClick={clearAllFilters}>Clear all</button>
                    </div>
                )}

                {/* ── Table ── */}
                <div className="adm-table-card">
                    {listLoading ? (
                        <div className="adm-loading">
                            <div className="adm-spinner" />
                            <p>Loading employees…</p>
                        </div>
                    ) : employees.length === 0 ? (
                        <div className="adm-empty">
                            <div className="adm-empty-icon">📭</div>
                            <h3>No employees found</h3>
                            <p>
                                {hasFilterChips || search
                                    ? 'Try adjusting your search or filters.'
                                    : 'No active employees in the system.'}
                            </p>
                            {(hasFilterChips || search) && (
                                <button className="adm-clear-btn" onClick={clearAllFilters}>Clear all filters</button>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="adm-table-scroll">
                                {/* Table Head */}
                                <div className="adm-table-head">
                                    <div onClick={() => toggleSort('name')} className="adm-th-sortable">
                                        Employee <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                                    </div>
                                    <div onClick={() => toggleSort('department')} className="adm-th-sortable">
                                        Department <SortIcon field="department" sortField={sortField} sortDir={sortDir} />
                                    </div>
                                    <div>Plan Status</div>
                                    <div>Progress</div>
                                    <div onClick={() => toggleSort('planSubmittedAt')} className="adm-th-sortable">
                                        Last Submitted <SortIcon field="planSubmittedAt" sortField={sortField} sortDir={sortDir} />
                                    </div>
                                    <div onClick={() => toggleSort('complianceStatus')} className="adm-th-sortable">
                                        Compliance <SortIcon field="complianceStatus" sortField={sortField} sortDir={sortDir} />
                                    </div>
                                </div>

                                {/* Table Body */}
                                <div className="adm-table-body">
                                    {employees.map((emp, idx) => (
                                        <div key={emp.id} className="adm-table-row" style={{ animationDelay: `${idx * 25}ms` }}>
                                            {/* Employee */}
                                            <div className="adm-cell adm-cell--employee">
                                                <div className="adm-avatar">{(emp.name || '?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}</div>
                                                <div className="adm-emp-info">
                                                    <strong>
                                                        {emp.name}
                                                        {emp.role === 'RA' && <span className="adm-role-tag">RA</span>}
                                                    </strong>
                                                    <span>{emp.employeeCode}</span>
                                                </div>
                                            </div>

                                            {/* Department */}
                                            <div className="adm-cell">
                                                <span
                                                    className={`adm-dept-chip${deptFilter === emp.department ? ' adm-dept-chip--active' : ''}`}
                                                    onClick={() => toggleDeptFilter(emp.department)}
                                                    title="Click to filter by this department"
                                                >
                                                    {emp.department}
                                                </span>
                                            </div>

                                            {/* Plan status */}
                                            <div className="adm-cell">
                                                {emp.planStatus
                                                    ? <span className="adm-badge adm-badge--plan">{emp.planStatus}</span>
                                                    : <span className="adm-badge adm-badge--no-plan">No Plan</span>
                                                }
                                            </div>

                                            {/* Achievement status */}
                                            <div className="adm-cell">
                                                <AchBadge status={emp.achievementStatus} />
                                            </div>

                                            {/* Last submitted */}
                                            <div className="adm-cell adm-cell--date">
                                                {emp.planSubmittedAt
                                                    ? <><span className="adm-date-plan">Plan: </span>{formatDate(emp.planSubmittedAt)}<br />
                                                        {emp.achievementSubmittedAt && <><span className="adm-date-ach">Progress: </span>{formatDate(emp.achievementSubmittedAt)}</>}</>
                                                    : <span className="adm-dash">—</span>
                                                }
                                            </div>

                                            {/* Compliance status */}
                                            <div className="adm-cell">
                                                {emp.complianceStatus === 'COMPLETE'
                                                    ? <span className="adm-badge adm-badge--complete"><FiCheckCircle size={10}/> Complete</span>
                                                    : emp.complianceStatus === 'PLAN_ONLY'
                                                    ? <span className="adm-badge adm-badge--incomplete"><FiAlertCircle size={10}/> Plan Only</span>
                                                    : <span className="adm-badge adm-badge--not-started">No Plan</span>
                                                }
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ── Pagination ── */}
                            {listMeta.totalPages > 1 && (
                                <div className="adm-pagination">
                                    <span className="adm-pagination-info">
                                        Page {page} of {listMeta.totalPages} — {listMeta.total} results
                                    </span>
                                    <div className="adm-pagination-btns">
                                        <button
                                            className="adm-page-btn"
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                        >
                                            <FiChevronLeft size={14} />
                                        </button>
                                        {Array.from({ length: Math.min(7, listMeta.totalPages) }, (_, i) => {
                                            // Simple window around current page
                                            const totalP = listMeta.totalPages;
                                            let start = Math.max(1, page - 3);
                                            if (start + 6 > totalP) start = Math.max(1, totalP - 6);
                                            const p = start + i;
                                            if (p > totalP) return null;
                                            return (
                                                <button
                                                    key={p}
                                                    className={`adm-page-btn${p === page ? ' adm-page-btn--active' : ''}`}
                                                    onClick={() => setPage(p)}
                                                >
                                                    {p}
                                                </button>
                                            );
                                        })}
                                        <button
                                            className="adm-page-btn"
                                            onClick={() => setPage(p => Math.min(listMeta.totalPages, p + 1))}
                                            disabled={page >= listMeta.totalPages}
                                        >
                                            <FiChevronRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;