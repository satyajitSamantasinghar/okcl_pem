import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiUsers, FiSearch, FiX, FiRefreshCw, FiGrid, FiList,
    FiFilter, FiBriefcase, FiCalendar, FiArrowRight,
    FiCheckCircle, FiClock, FiEye, FiAward,
} from 'react-icons/fi';
import './RAEmployeeList.css';

/* ─── helpers ─── */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

/**
 * Status is based on the CURRENT MONTH only, using dedicated flags
 * returned by the backend /ra/my-employees endpoint.
 */
function getCardStatus(emp) {
    if (!emp.currentMonthPlanSubmitted)        return 'not-submitted';
    if (emp.currentMonthEvaluated)             return 'completed';
    if (!emp.currentMonthAchievementSubmitted) return 'achievement-missing';
    return 'pending';
}

function getStatusLabel(status) {
    if (status === 'not-submitted')        return 'Monthly Plan Not Submitted';
    if (status === 'completed')            return 'Evaluated';
    if (status === 'achievement-missing')  return 'Achievement is Missing';
    return 'Evaluation is Pending';
}

function getProgressPct(emp) {
    if (!emp.currentMonthPlanSubmitted) return 0;
    if (emp.currentMonthEvaluated)      return 100;
    if (emp.currentMonthAchievementSubmitted) return 66;
    return 33;
}

function getProgressHint(emp) {
    if (!emp.currentMonthPlanSubmitted)        return 'No monthly plan submitted for this month yet';
    if (emp.currentMonthEvaluated)             return 'This month is fully evaluated — plan, achievement & evaluation done';
    if (!emp.currentMonthAchievementSubmitted) return 'Plan submitted — waiting for employee to submit this month\'s achievement';
    return 'Plan & achievement submitted — awaiting your evaluation for this month';
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════ */
const RAEmployeeListPage = () => {
    const navigate = useNavigate();

    const [employees, setEmployees]     = useState([]);
    const [loading, setLoading]         = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [viewMode, setViewMode]       = useState('grid'); // 'grid' | 'list'

    /* ── Fetch employees ── */
    const fetchEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/my-employees');
            setEmployees(Array.isArray(res.data) ? res.data : []);
        } catch {
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    /* ── Derived stats ── */
    const total        = employees.length;
    const evaluated    = employees.filter(e => getCardStatus(e) === 'completed').length;
    const pending      = employees.filter(e => ['pending', 'achievement-missing'].includes(getCardStatus(e))).length;
    const notSubmitted = employees.filter(e => getCardStatus(e) === 'not-submitted').length;

    /* ── Filtering ── */
    const filtered = employees.filter(emp => {
        const status = getCardStatus(emp);
        const q = searchQuery.trim().toLowerCase();
        if (q && !emp.name?.toLowerCase().includes(q) &&
            !emp.employeeCode?.toLowerCase().includes(q) &&
            !emp.department?.toLowerCase().includes(q)) return false;
        if (filterStatus !== 'all' && status !== filterStatus) return false;
        return true;
    });

    /* ── Navigate to detail ── */
    const goToDetail = (empId) => navigate(`/ra/employee/${empId}`);

    /* ════════════════════════════════════════════════════
       LOADING STATE
    ════════════════════════════════════════════════════ */
    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading employees...</p>
            </div>
        );
    }

    /* ════════════════════════════════════════════════════
       RENDER
    ════════════════════════════════════════════════════ */
    return (
        <div className="rel-page fade-in">

            {/* ── Page Header ── */}
            <div className="rel-page-header">
                <h1 className="rel-page-title">Employee Directory</h1>
                <p className="rel-page-subtitle">
                    Monitor and evaluate monthly plans for your reporting employees
                </p>
            </div>

            {/* ── Summary Stats ── */}
            <div className="rel-stats-row">
                <div className="rel-stat">
                    <div className="rel-stat-icon rel-stat-icon--orange"><FiUsers /></div>
                    <div>
                        <div className="rel-stat-value">{total}</div>
                        <div className="rel-stat-label">Total Employees</div>
                    </div>
                </div>
                <div className="rel-stat">
                    <div className="rel-stat-icon rel-stat-icon--green"><FiCheckCircle /></div>
                    <div>
                        <div className="rel-stat-value">{evaluated}</div>
                        <div className="rel-stat-label">Fully Evaluated</div>
                    </div>
                </div>
                <div className="rel-stat">
                    <div className="rel-stat-icon rel-stat-icon--amber"><FiClock /></div>
                    <div>
                        <div className="rel-stat-value">{pending + notSubmitted}</div>
                        <div className="rel-stat-label">Pending / Not Submitted</div>
                    </div>
                </div>
            </div>

            {/* ── Filter Bar ── */}
            <div className="rel-filter-bar">
                {/* Search */}
                <div className="rel-search-wrap">
                    <FiSearch className="rel-search-icon" />
                    <input
                        className="rel-search-input"
                        type="text"
                        placeholder="Search by name, code or department…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            className="rel-search-clear"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear search"
                        >
                            <FiX />
                        </button>
                    )}
                </div>

                {/* Controls */}
                <div className="rel-filter-controls">
                    {/* Status filter */}
                    <div className="rel-select-wrap">
                        <FiFilter className="rel-select-icon" />
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                        >
                            <option value="all">All Statuses</option>
                            <option value="pending">Pending Evaluation</option>
                            <option value="completed">Fully Evaluated</option>
                            <option value="achievement-missing">Achievement Missing</option>
                            <option value="not-submitted">Not Submitted</option>
                        </select>
                    </div>

                    {/* View toggle */}
                    <div className="rel-view-toggle">
                        <button
                            className={viewMode === 'grid' ? 'active' : ''}
                            onClick={() => setViewMode('grid')}
                            title="Grid view"
                        >
                            <FiGrid />
                        </button>
                        <button
                            className={viewMode === 'list' ? 'active' : ''}
                            onClick={() => setViewMode('list')}
                            title="List view"
                        >
                            <FiList />
                        </button>
                    </div>

                    {/* Refresh */}
                    <button
                        className="rel-icon-btn"
                        onClick={fetchEmployees}
                        title="Refresh"
                    >
                        <FiRefreshCw />
                    </button>
                </div>
            </div>

            {/* Result count */}
            <p className="rel-result-count">
                Showing {filtered.length} of {total} employee{total !== 1 ? 's' : ''}
                {filterStatus !== 'all' && ` · filtered by "${getStatusLabel(filterStatus)}"`}
                {searchQuery && ` · matching "${searchQuery}"`}
            </p>

            {/* ════════ EMPTY STATE ════════ */}
            {filtered.length === 0 && (
                <div className="rel-empty-state">
                    <div className="rel-empty-icon"><FiUsers /></div>
                    <h3>No employees found</h3>
                    <p>
                        {searchQuery || filterStatus !== 'all'
                            ? 'Try adjusting your search or filter to find employees.'
                            : 'No employees are currently assigned to you.'}
                    </p>
                </div>
            )}

            {/* ════════ GRID VIEW ════════ */}
            {viewMode === 'grid' && filtered.length > 0 && (
                <div className="rel-grid">
                    {filtered.map(emp => {
                        const status = getCardStatus(emp);
                        const pct    = getProgressPct(emp);

                        return (
                            <div
                                key={emp._id}
                                className={`rel-card rel-card--${status}`}
                            >
                                {/* Head: avatar + badge */}
                                <div className="rel-card-head">
                                    <div className="rel-card-avatar">{getInitials(emp.name)}</div>
                                    <span className={`rel-badge rel-badge--${status}`}>
                                        {getStatusLabel(status)}
                                    </span>
                                </div>

                                {/* Identity */}
                                <div className="rel-card-identity">
                                    <h3 className="rel-card-name">{emp.name}</h3>
                                    <span className="rel-card-code">#{emp.employeeCode}</span>
                                </div>

                                {/* Department */}
                                <div className="rel-card-dept">
                                    <FiBriefcase className="rel-dept-icon" />
                                    {emp.department || 'No Department'}
                                </div>

                                {/* Progress block */}
                                <div className="rel-progress-block">
                                    <div className="rel-progress-meta">
                                        <span className="rel-progress-label">Evaluation Progress</span>
                                        <span className="rel-progress-pct">{pct}%</span>
                                    </div>
                                    <div className="rel-progress-track">
                                        <div
                                            className={`rel-progress-fill rel-progress-fill--${status}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <p className="rel-progress-hint">{getProgressHint(emp)}</p>
                                </div>

                                {/* Meta chips */}
                                <div className="rel-card-meta">
                                    {emp.joinedAt && (
                                        <span className="rel-meta-chip">
                                            <FiCalendar className="rel-meta-icon" />
                                            Joined {new Date(emp.joinedAt).toLocaleDateString('en-US', {
                                                month: 'short', year: 'numeric',
                                            })}
                                        </span>
                                    )}
                                    <span className="rel-meta-chip">
                                        <FiAward className="rel-meta-icon" />
                                        {emp.totalPlans || 0} plan{emp.totalPlans !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                {/* Actions — single button only */}
                                <div className="rel-card-actions">
                                    <button
                                        className={`rel-btn-primary rel-btn-primary--${status}`}
                                        onClick={() => goToDetail(emp._id)}
                                    >
                                        <FiEye /> View Profile
                                        <FiArrowRight className="rel-btn-arrow" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ════════ LIST / TABLE VIEW ════════ */}
            {viewMode === 'list' && filtered.length > 0 && (
                <div className="rel-table-wrap">
                    <table className="rel-table">
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>Employee</th>
                                <th>Department</th>
                                <th>Status</th>
                                <th>Progress</th>
                                <th>Plans / Evals</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((emp, i) => {
                                const status = getCardStatus(emp);
                                const pct    = getProgressPct(emp);
                                return (
                                    <tr
                                        key={emp._id}
                                        className={`rel-row rel-row--${status}`}
                                        onClick={() => goToDetail(emp._id)}
                                    >
                                        <td className="rel-td-num">{i + 1}</td>
                                        <td>
                                            <div className="rel-row-emp">
                                                <div className="rel-row-avatar">{getInitials(emp.name)}</div>
                                                <div>
                                                    <div>{emp.name}</div>
                                                    <div className="rel-row-sub">#{emp.employeeCode}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{emp.department || '—'}</td>
                                        <td className="rel-td-status">
                                            <span className={`rel-badge rel-badge--${status}`}>
                                                {getStatusLabel(status)}
                                            </span>
                                        </td>
                                        <td className="rel-td-progress">
                                            <div className="rel-progress-track">
                                                <div
                                                    className={`rel-progress-fill rel-progress-fill--${status}`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <span className="rel-td-pct">{pct}%</span>
                                        </td>
                                        <td className="rel-row-code">
                                            {emp.totalPlans || 0} / {emp.totalEvaluated || 0}
                                        </td>
                                        <td>
                                            <button
                                                className={`rel-td-btn rel-td-btn--${status}`}
                                                onClick={e => { e.stopPropagation(); goToDetail(emp._id); }}
                                            >
                                                <FiEye /> View Profile
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default RAEmployeeListPage;