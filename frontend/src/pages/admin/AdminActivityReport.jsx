import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiCalendar, FiActivity, FiUsers, FiLayers, FiFilter, FiSearch, FiX,
    FiDownload, FiChevronLeft, FiChevronRight, FiChevronUp, FiChevronDown,
    FiShield, FiClock,
} from 'react-icons/fi';
import './AdminActivityReport.css';

/* ─────────────────────────────────────────
   CONSTANTS / HELPERS
   (deliberately self-contained, same convention AdminDashboard.jsx uses
   rather than pulling from a shared utils module)
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

function formatTimestamp(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

// Mirrors utils/auditActionLabels.js's EMPLOYEE_ACTIVITY_ENTITY_TYPES / labels
// on the backend. Kept in sync manually since frontend/backend don't share a
// module here — if that list changes, update both.
const ENTITY_TYPE_OPTIONS = [
    { value: '', label: 'All Record Types' },
    { value: 'MONTHLY_PLAN', label: 'Monthly Plan' },
    { value: 'MONTHLY_ACHIEVEMENT', label: 'Monthly Progress' },
    { value: 'YEARLY_PLAN', label: 'Yearly Plan' },
    { value: 'YEARLY_APPRAISAL_REPORT', label: 'Yearly Appraisal Report' },
];

const ENTITY_TYPE_BADGE_CLASS = {
    MONTHLY_PLAN: 'aal-badge--plan',
    MONTHLY_ACHIEVEMENT: 'aal-badge--progress',
    YEARLY_PLAN: 'aal-badge--yearly-plan',
    YEARLY_APPRAISAL_REPORT: 'aal-badge--appraisal',
};

const ROWS_PER_PAGE = 25;

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
const StatCard = ({ icon, value, label, sub, color }) => (
    <div className={`aal-stat-card aal-stat-card--${color}`}>
        <div className="aal-stat-top">
            <div className={`aal-stat-icon aal-stat-icon--${color}`}>{icon}</div>
            <strong className="aal-stat-value">{value ?? '—'}</strong>
        </div>
        <div className="aal-stat-bottom">
            <span className="aal-stat-label">{label}</span>
            {sub && <span className="aal-stat-sub">{sub}</span>}
        </div>
    </div>
);

/* ─────────────────────────────────────────
   SORT ICON
───────────────────────────────────────── */
const SortIcon = ({ field, sortField, sortDir }) => {
    if (sortField !== field) return <span className="aal-sort-neutral">⇅</span>;
    return sortDir === 'asc'
        ? <FiChevronUp className="aal-sort-active" />
        : <FiChevronDown className="aal-sort-active" />;
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const AdminActivityReport = () => {
    // ── Month selector ────────────────────────────────────────────────────
    const [month, setMonth] = useState(() => {
        const cur = getCurrentMonth();
        return cur < GO_LIVE_MONTH ? GO_LIVE_MONTH : cur;
    });

    // ── Data state ─────────────────────────────────────────────────────────
    const [entries, setEntries] = useState([]);
    const [meta, setMeta] = useState({
        total: 0, totalPages: 1, totalEntries: 0,
        employeesWithActivity: 0, trackedEmployees: 0,
        departments: [], reportingAuthorities: [],
    });
    const [loading, setLoading] = useState(true);

    // ── Filters ───────────────────────────────────────────────────────────
    const [deptFilter, setDeptFilter]     = useState('');
    const [raFilter, setRaFilter]         = useState('');
    const [entityTypeFilter, setEntityTypeFilter] = useState('');
    const [search, setSearch]             = useState('');
    const [page, setPage]                 = useState(1);
    const [sortField, setSortField]       = useState('timestamp');
    const [sortDir, setSortDir]           = useState('desc');

    // ── Export state ──────────────────────────────────────────────────────
    const [exporting, setExporting] = useState(false);
    const [exportFormat, setExportFormat] = useState('department'); // 'department' | 'ra'

    /* ── Fetch activity log ── */
    const fetchEntries = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                month,
                page,
                limit: ROWS_PER_PAGE,
                sort: sortField,
                order: sortDir,
            };
            if (deptFilter)        params.department = deptFilter;
            if (raFilter)          params.ra = raFilter;
            if (entityTypeFilter)  params.entityType = entityTypeFilter;
            if (search.trim())     params.search = search.trim();

            const res = await api.get('/admin/activity-report', { params });
            setEntries(res.data.data || []);
            setMeta({
                total: res.data.total,
                totalPages: res.data.totalPages,
                totalEntries: res.data.totalEntries,
                employeesWithActivity: res.data.employeesWithActivity,
                trackedEmployees: res.data.trackedEmployees,
                departments: res.data.departments || [],
                reportingAuthorities: res.data.reportingAuthorities || [],
            });
        } catch {
            toast.error('Failed to load activity log report');
        } finally {
            setLoading(false);
        }
    }, [month, page, sortField, sortDir, deptFilter, raFilter, entityTypeFilter, search]);

    useEffect(() => { fetchEntries(); }, [fetchEntries]);

    /* ── Reset page when filters/month change ── */
    useEffect(() => { setPage(1); }, [month, deptFilter, raFilter, entityTypeFilter, search, sortField, sortDir]);

    /* ── Export PDF ── */
    const handleExportPdf = async () => {
        setExporting(true);
        try {
            const params = { month, groupBy: exportFormat === 'ra' ? 'ra' : undefined };
            if (entityTypeFilter) params.entityType = entityTypeFilter;

            const res = await api.get('/admin/activity-report/export-pdf', {
                params,
                responseType: 'blob',
            });
            const url  = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href     = url;
            link.download = `activity-log-${month}${exportFormat === 'ra' ? '-by-ra' : ''}.pdf`;
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

    /* ── Sort toggle ── */
    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir(field === 'timestamp' ? 'desc' : 'asc'); }
    };

    /* ── Filter chips ── */
    const hasFilterChips = deptFilter !== '' || raFilter !== '' || entityTypeFilter !== '' || search.trim() !== '';
    const clearAllFilters = () => {
        setDeptFilter(''); setRaFilter(''); setEntityTypeFilter(''); setSearch(''); setPage(1);
    };

    const currentMonthStr = getCurrentMonth();

    return (
        <div className="aal-root">

            {/* ── Page Header ── */}
            <div className="aal-page-header">
                <div className="aal-page-header-left">
                    <div className="aal-page-eyebrow"><FiShield size={12} /> Admin Console</div>
                    <h1 className="aal-page-title">Employee Activity Log</h1>
                    <p className="aal-page-sub">
                        Every draft, submission, and resubmission an employee has logged — {formatMonthLabel(month)}
                    </p>
                </div>

                <div className="aal-header-right">
                    <div className="aal-month-filter">
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

                    <div className="aal-export-group">
                        <select
                            className="aal-export-format-select"
                            value={exportFormat}
                            onChange={e => setExportFormat(e.target.value)}
                            title="PDF grouping format"
                        >
                            <option value="department">Group by Department</option>
                            <option value="ra">Group by Reporting Authority</option>
                        </select>
                        <button
                            className={`aal-export-btn${exporting ? ' aal-export-btn--loading' : ''}`}
                            onClick={handleExportPdf}
                            disabled={exporting}
                            title={`Export activity log for ${formatMonthLabel(month)} as PDF`}
                        >
                            {exporting
                                ? <><span className="aal-btn-spinner" /> Exporting…</>
                                : <><FiDownload size={14} /> Export PDF</>
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Stat Cards ── */}
            {loading && entries.length === 0 ? (
                <div className="aal-kpi-grid aal-kpi-skeleton">
                    {[0, 1, 2].map(i => <div key={i} className="aal-stat-card aal-skeleton-card" />)}
                </div>
            ) : (
                <div className="aal-kpi-grid">
                    <StatCard
                        icon={<FiActivity size={18} />}
                        value={meta.totalEntries}
                        label="Total Log Entries"
                        sub={`For ${formatMonthLabel(month)}`}
                        color="blue"
                    />
                    <StatCard
                        icon={<FiUsers size={18} />}
                        value={meta.employeesWithActivity}
                        label="Employees With Activity"
                        sub={`of ${meta.trackedEmployees} tracked this month`}
                        color="teal"
                    />
                    <StatCard
                        icon={<FiLayers size={18} />}
                        value={meta.departments.length}
                        label="Departments Represented"
                        sub={meta.reportingAuthorities.length > 0
                            ? `${meta.reportingAuthorities.length} Reporting Authorities`
                            : undefined}
                        color="amber"
                    />
                </div>
            )}

            {/* ── Filter Row ── */}
            <div className="aal-section">
                <div className="aal-section-header">
                    <div className="aal-section-title-row">
                        <FiClock size={14} />
                        <span className="aal-section-title">Activity Entries</span>
                        <span className="aal-result-count">
                            {meta.total} {meta.total === 1 ? 'entry' : 'entries'}
                        </span>
                    </div>
                </div>

                <div className="aal-filter-bar">
                    <div className="aal-filter-field">
                        <FiFilter size={12} />
                        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                            <option value="">All Departments</option>
                            {meta.departments.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>

                    <div className="aal-filter-field">
                        <FiFilter size={12} />
                        <select value={raFilter} onChange={e => setRaFilter(e.target.value)}>
                            <option value="">All Reporting Authorities</option>
                            {meta.reportingAuthorities.map(ra => <option key={ra} value={ra}>{ra}</option>)}
                        </select>
                    </div>

                    <div className="aal-filter-field">
                        <FiFilter size={12} />
                        <select value={entityTypeFilter} onChange={e => setEntityTypeFilter(e.target.value)}>
                            {ENTITY_TYPE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="aal-search-field">
                        <FiSearch size={13} />
                        <input
                            type="text"
                            placeholder="Search employee name or code…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {hasFilterChips && (
                        <button className="aal-clear-btn" onClick={clearAllFilters}>
                            <FiX size={12} /> Clear filters
                        </button>
                    )}
                </div>

                {/* ── Table ── */}
                <div className="aal-table-wrap">
                    {loading ? (
                        <div className="aal-loading-state">Loading activity…</div>
                    ) : entries.length === 0 ? (
                        <div className="aal-empty-state">
                            No activity recorded for the selected month and filters.
                        </div>
                    ) : (
                        <>
                            <div className="aal-table-head">
                                <div onClick={() => toggleSort('timestamp')} className="aal-th-sortable">
                                    Timestamp <SortIcon field="timestamp" sortField={sortField} sortDir={sortDir} />
                                </div>
                                <div onClick={() => toggleSort('name')} className="aal-th-sortable">
                                    Employee <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                                </div>
                                <div onClick={() => toggleSort('department')} className="aal-th-sortable">
                                    Department <SortIcon field="department" sortField={sortField} sortDir={sortDir} />
                                </div>
                                <div>Reporting Authority</div>
                                <div>Action</div>
                                <div>Record Type</div>
                            </div>

                            <div className="aal-table-body">
                                {entries.map((entry, idx) => (
                                    <div key={entry.id} className="aal-table-row" style={{ animationDelay: `${idx * 20}ms` }}>
                                        <div className="aal-cell aal-cell--timestamp">{formatTimestamp(entry.timestamp)}</div>

                                        <div className="aal-cell aal-cell--employee">
                                            <div className="aal-avatar">
                                                {(entry.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                                            </div>
                                            <div className="aal-emp-info">
                                                <strong>
                                                    {entry.name}
                                                    {entry.role === 'RA' && <span className="aal-role-tag">RA</span>}
                                                </strong>
                                                <span>{entry.employeeCode}</span>
                                            </div>
                                        </div>

                                        <div className="aal-cell">{entry.department}</div>
                                        <div className="aal-cell">{entry.reportingAuthority || <span className="aal-dash">—</span>}</div>
                                        <div className="aal-cell aal-cell--action">{entry.actionLabel}</div>
                                        <div className="aal-cell">
                                            <span className={`aal-badge ${ENTITY_TYPE_BADGE_CLASS[entry.entityType] || ''}`}>
                                                {entry.entityTypeLabel}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* ── Pagination ── */}
                {meta.totalPages > 1 && (
                    <div className="aal-pagination">
                        <span className="aal-pagination-info">
                            Page {page} of {meta.totalPages} — {meta.total} results
                        </span>
                        <div className="aal-pagination-btns">
                            <button
                                className="aal-page-btn"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                            >
                                <FiChevronLeft size={14} />
                            </button>
                            {Array.from({ length: Math.min(7, meta.totalPages) }, (_, i) => {
                                const totalP = meta.totalPages;
                                let start = Math.max(1, page - 3);
                                if (start + 6 > totalP) start = Math.max(1, totalP - 6);
                                const p = start + i;
                                if (p > totalP) return null;
                                return (
                                    <button
                                        key={p}
                                        className={`aal-page-btn${p === page ? ' aal-page-btn--active' : ''}`}
                                        onClick={() => setPage(p)}
                                    >
                                        {p}
                                    </button>
                                );
                            })}
                            <button
                                className="aal-page-btn"
                                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                                disabled={page >= meta.totalPages}
                            >
                                <FiChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminActivityReport;