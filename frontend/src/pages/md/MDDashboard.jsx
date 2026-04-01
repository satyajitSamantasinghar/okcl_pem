import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiUsers, FiUserCheck, FiFileText, FiCheckCircle, FiAlertCircle,
    FiBarChart2, FiAward, FiSearch, FiShield, FiCalendar,
    FiClock, FiTarget, FiSend, FiEdit3, FiXCircle, FiChevronRight,
    FiX, FiArrowLeft, FiArchive, FiActivity, FiPieChart
} from 'react-icons/fi';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import './MDDashboard.css';

/* ====================================================
   HELPERS
==================================================== */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2);
}

function getAuditIcon(action) {
    const map = {
        SUBMIT: { icon: <FiSend />, cls: 'submit' },
        EDIT: { icon: <FiEdit3 />, cls: 'edit' },
        APPROVE: { icon: <FiCheckCircle />, cls: 'approve' },
        REJECT: { icon: <FiXCircle />, cls: 'reject' },
        MD_EVALUATE: { icon: <FiAward />, cls: 'evaluate' },
        EVALUATE: { icon: <FiBarChart2 />, cls: 'evaluate' },
        FINAL_APPROVAL: { icon: <FiShield />, cls: 'approve' },
    };
    return map[action] || { icon: <FiArchive />, cls: 'default' };
}

function formatTimeAgo(date) {
    const now = new Date();
    const diff = now - new Date(date);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function getScoreColor(score) {
    if (score >= 8) return '#22C55E';
    if (score >= 6) return '#F97316';
    if (score >= 4) return '#EAB308';
    return '#EF4444';
}

/* ====================================================
   COMPONENT
==================================================== */
const currentYear = new Date().getFullYear();
const MDDashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();

    /* pick up openEmployee state from MDEmployeeListPage */
    useEffect(() => {
        const emp = location.state?.openEmployee;
        if (emp) {
            loadEmployeeDetail(emp);
            // clear the state so going back doesn't re-open
            window.history.replaceState({}, '');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    // Audit
    const [auditLogs, setAuditLogs] = useState([]);
    const [auditPage, setAuditPage] = useState(1);
    const [auditTotal, setAuditTotal] = useState(0);
    const [auditFilter, setAuditFilter] = useState('');
    const [auditDateFrom, setAuditDateFrom] = useState('');
    const [auditDateTo, setAuditDateTo] = useState('');

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef(null);
    const searchTimeout = useRef(null);

    // Employee detail
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [empDetail, setEmpDetail] = useState(null);
    const [empDetailLoading, setEmpDetailLoading] = useState(false);
    const [empTab, setEmpTab] = useState('overview');

    // Dashboard tabs
    const [dashTab, setDashTab] = useState('monthly');

    // Monthly plans list
    const [monthlyPlansList, setMonthlyPlansList] = useState([]);
    const [monthlyPlansLoading, setMonthlyPlansLoading] = useState(false);
    const [mpYear, setMpYear] = useState(String(currentYear));

    // Quarterly evals list
    const [quarterlyList, setQuarterlyList] = useState([]);
    const [quarterlyLoading, setQuarterlyLoading] = useState(false);

    // Reject modal
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectRemarks, setRejectRemarks] = useState('');

    /* ---- Fetch dashboard ---- */
    const fetchDashboard = useCallback(async () => {
        try {
            const res = await api.get('/md/dashboard');
            setStats(res.data);
        } catch {
            toast.error('Failed to load dashboard');
        } finally {
            setLoading(false);
        }
    }, []);

    /* ---- Fetch audit ---- */
    const fetchAudit = useCallback(async () => {
        try {
            const params = { page: auditPage, limit: 15 };
            if (auditFilter) params.entityType = auditFilter;
            if (auditDateFrom) params.from = auditDateFrom;
            if (auditDateTo) params.to = auditDateTo;
            const res = await api.get('/md/audit-logs', { params });
            setAuditLogs(res.data.logs);
            setAuditTotal(res.data.total);
        } catch {
            /* silent */
        }
    }, [auditPage, auditFilter, auditDateFrom, auditDateTo]);

    useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
    useEffect(() => { fetchAudit(); }, [fetchAudit]);

    /* ---- Fetch monthly plans list ---- */
    const fetchMonthlyPlans = useCallback(async () => {
        setMonthlyPlansLoading(true);
        try {
            const res = await api.get('/md/monthly-plans', { params: { year: mpYear } });
            setMonthlyPlansList(res.data);
        } catch { /* silent */ }
        finally { setMonthlyPlansLoading(false); }
    }, [mpYear]);

    /* ---- Fetch quarterly evals ---- */
    const fetchQuarterlyEvals = useCallback(async () => {
        setQuarterlyLoading(true);
        try {
            const res = await api.get('/md/quarterly-evaluations');
            setQuarterlyList(res.data);
        } catch { /* silent */ }
        finally { setQuarterlyLoading(false); }
    }, []);

    useEffect(() => { fetchMonthlyPlans(); }, [fetchMonthlyPlans]);
    useEffect(() => { fetchQuarterlyEvals(); }, [fetchQuarterlyEvals]);

    /* ---- Reject monthly plan ---- */
    const handleRejectPlan = async () => {
        if (!rejectTarget) return;
        try {
            await api.put(`/md/monthly-plan/${rejectTarget._id}/reject`, { mdRemarks: rejectRemarks });
            toast.success('Monthly plan rejected');
            setRejectTarget(null);
            fetchMonthlyPlans();
            fetchDashboard();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to reject');
        }
    };

    /* ---- Search ---- */
    const handleSearch = (val) => {
        setSearchQuery(val);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (val.length < 1) { setSearchResults([]); setSearchOpen(false); return; }
        searchTimeout.current = setTimeout(async () => {
            try {
                const res = await api.get('/md/employees', { params: { q: val } });
                setSearchResults(res.data);
                setSearchOpen(true);
            } catch { setSearchResults([]); }
        }, 300);
    };

    /* ---- Load Employee Detail ---- */
    const loadEmployeeDetail = async (emp) => {
        setSelectedEmployee(emp);
        setEmpTab('overview');
        setEmpDetailLoading(true);
        setSearchOpen(false);
        setSearchQuery('');
        try {
            const res = await api.get(`/md/employee/${emp._id}`);
            setEmpDetail(res.data);
        } catch {
            toast.error('Failed to load employee detail');
        } finally {
            setEmpDetailLoading(false);
        }
    };

    /* ---- Close outside click for search ---- */
    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) {
                setSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading dashboard...</p>
            </div>
        );
    }

    /* ========================================================
       EMPLOYEE DETAIL VIEW
    ======================================================== */
    if (selectedEmployee && empDetail) {
        return <EmployeeDetailView
            employee={empDetail.employee}
            data={empDetail}
            tab={empTab}
            setTab={setEmpTab}
            loading={empDetailLoading}
            onBack={() => { setSelectedEmployee(null); setEmpDetail(null); }}
            navigate={navigate}
        />;
    }

    /* ========================================================
       MAIN DASHBOARD
    ======================================================== */
    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Managing Director Dashboard</h1>
                <p>Organization-wide oversight — performance metrics, submissions, and audit trail</p>
            </div>

            {/* Search Bar */}
            <div className="md-search-wrap" ref={searchRef}>
                <FiSearch className="md-search-icon" />
                <input
                    className="md-search-input"
                    type="text"
                    placeholder="Search employee or RA by name or code..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                />
                {searchOpen && searchResults.length > 0 && (
                    <div className="md-search-dropdown">
                        {searchResults.map(emp => (
                            <div key={emp._id} className="md-search-item" onClick={() => loadEmployeeDetail(emp)}>
                                <div className="md-search-avatar">{getInitials(emp.name)}</div>
                                <div className="md-search-info">
                                    <div className="md-search-name">{emp.name}</div>
                                    <div className="md-search-meta">{emp.employeeCode} • {emp.role} • {emp.department || 'N/A'}</div>
                                </div>
                                <FiChevronRight style={{ color: 'var(--text-muted)' }} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="md-dash-layout">
                {/* LEFT — Main Content */}
                <div className="md-main-content">
                    {/* Welcome Header */}
                    <div className="md-welcome-banner">
                        <div className="md-welcome-text">
                            <h2>Organization Overview</h2>
                            <p>Real-time analytics and performance metrics for FY {stats?.currentFY}</p>
                        </div>
                        <div className="md-welcome-icon"><FiActivity /></div>
                    </div>

                    {/* KPI Tiles — clickable */}
                    <div className="md-kpi-grid">
                        <div className="md-kpi-tile blue clickable" onClick={() => navigate('/md/employees')}>
                            <div className="md-kpi-label"><FiUsers /> Total Employees</div>
                            <div className="md-kpi-value">{stats?.totalEmployees}</div>
                            <div className="md-kpi-footer">
                                <span className="md-kpi-sub"><FiUserCheck /> {stats?.totalRAs} RAs</span>
                            </div>
                        </div>
                        <div className="md-kpi-tile green clickable" onClick={() => navigate('/md/monthly-overview')}>
                            <div className="md-kpi-label"><FiFileText /> Monthly Plans</div>
                            <div className="md-kpi-value">{stats?.monthlyPlansSubmitted}</div>
                            <div className="md-kpi-footer">
                                <span className="md-kpi-sub pending">{stats?.monthlyPlansPending} pending</span>
                            </div>
                        </div>
                        <div className="md-kpi-tile teal clickable" onClick={() => navigate('/md/monthly-overview')}>
                            <div className="md-kpi-label"><FiCheckCircle /> Achievements</div>
                            <div className="md-kpi-value">{stats?.monthlyAchievementsSubmitted}</div>
                            <div className="md-kpi-footer">
                                <span className="md-kpi-sub pending">{stats?.monthlyAchievementsPending} pending</span>
                            </div>
                        </div>
                        <div className="md-kpi-tile purple clickable" onClick={() => navigate('/md/approvals')}>
                            <div className="md-kpi-label"><FiTarget /> Yearly Plans</div>
                            <div className="md-kpi-value">{stats?.yearlyPlansTotal}</div>
                            <div className="md-kpi-footer">
                                <span className="md-kpi-sub pending">{stats?.yearlyPlansPending} pending</span>
                            </div>
                        </div>
                    </div>

                    {/* Charts Section */}
                    {stats && (
                        <div className="md-charts-row">
                            <div className="md-chart-card">
                                <h3><FiBarChart2 /> Monthly Overview ({stats.currentMonth})</h3>
                                <div className="md-chart-container">
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={[
                                            { name: 'Plans', Submitted: stats.monthlyPlansSubmitted, Pending: stats.monthlyPlansPending },
                                            { name: 'Achievements', Submitted: stats.monthlyAchievementsSubmitted, Pending: stats.monthlyAchievementsPending }
                                        ]} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                            <RechartsTooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                                            <Bar dataKey="Submitted" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={40} />
                                            <Bar dataKey="Pending" fill="#F97316" radius={[4, 4, 0, 0]} barSize={40} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="md-chart-card">
                                <h3><FiPieChart /> Yearly Plans (FY {stats.currentFY})</h3>
                                <div className="md-chart-container">
                                    <ResponsiveContainer width="100%" height={250}>
                                        <PieChart>
                                            <Pie
                                                data={[
                                                    { name: 'Pending', value: stats.yearlyPlansPending },
                                                    { name: 'Approved/Other', value: stats.yearlyPlansTotal - stats.yearlyPlansPending }
                                                ]}
                                                cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                                            >
                                                <Cell fill="#F97316" />
                                                <Cell fill="#22C55E" />
                                            </Pie>
                                            <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Action Modules */}
                    <div className="md-action-modules">
                        <div
                            className="md-action-module"
                            onClick={() => navigate('/md/employees')}
                            role="button" tabIndex={0}
                        >
                            <div className="md-mod-icon blue"><FiUsers /></div>
                            <div className="md-mod-content">
                                <h4>People Directory</h4>
                                <p>Search employees and open full performance profiles.</p>
                            </div>
                            <FiChevronRight className="md-mod-arrow" />
                        </div>
                        <div
                            className="md-action-module"
                            onClick={() => navigate('/md/monthly-overview')}
                            role="button" tabIndex={0}
                        >
                            <div className="md-mod-icon green"><FiFileText /></div>
                            <div className="md-mod-content">
                                <h4>Monthly Review</h4>
                                <p>Review all monthly plans, achievements, and RA scores.</p>
                            </div>
                            <FiChevronRight className="md-mod-arrow" />
                        </div>
                        <div
                            className="md-action-module"
                            onClick={() => navigate('/md/approvals')}
                            role="button" tabIndex={0}
                        >
                            <div className="md-mod-icon purple"><FiTarget /></div>
                            <div className="md-mod-content">
                                <h4>Yearly Appraisals</h4>
                                <p>Finalize yearly plan approvals and appraisals.</p>
                            </div>
                            <FiChevronRight className="md-mod-arrow" />
                        </div>
                    </div>
                </div>

                {/* RIGHT — Audit Sidebar */}
                <div className="md-audit-sidebar">
                    <div className="md-audit-header">
                        <div className="md-audit-title"><FiShield /> Audit Trail</div>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{auditTotal} total</span>
                    </div>

                    <div className="md-audit-filter">
                        <input type="date" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }} title="From" />
                        <input type="date" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }} title="To" />
                        <select value={auditFilter} onChange={e => { setAuditFilter(e.target.value); setAuditPage(1); }}>
                            <option value="">All Types</option>
                            <option value="MONTHLY_PLAN">Monthly Plan</option>
                            <option value="MONTHLY_ACHIEVEMENT">Achievement</option>
                            <option value="MONTHLY_EVALUATION">Evaluation</option>
                            <option value="YEARLY_PLAN">Yearly Plan</option>
                            <option value="YEARLY_APPRAISAL_REPORT">Appraisal Report</option>
                            <option value="QUARTERLY_EVALUATION">Quarterly</option>
                        </select>
                    </div>

                    <div className="md-audit-list">
                        {auditLogs.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                                No audit logs found
                            </div>
                        ) : auditLogs.map(log => {
                            const ai = getAuditIcon(log.action);
                            return (
                                <div key={log._id} className="md-audit-item">
                                    <div className={`md-audit-icon ${ai.cls}`}>{ai.icon}</div>
                                    <div className="md-audit-info">
                                        <div className="md-audit-user">{log.userId?.name || 'System'}</div>
                                        <div className="md-audit-desc">
                                            {log.action?.replace(/_/g, ' ')} — {log.entityType?.replace(/_/g, ' ')}
                                        </div>
                                        <div className="md-audit-time">{formatTimeAgo(log.timestamp)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Pagination */}
                    <div className="md-pagination">
                        <button disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>Prev</button>
                        <span>Page {auditPage}</span>
                        <button disabled={auditLogs.length < 15} onClick={() => setAuditPage(p => p + 1)}>Next</button>
                    </div>

                    <div className="md-audit-more">
                        <Link to="/md/audit">View Full Audit Trail →</Link>
                    </div>
                </div>
            </div>

            {/* Reject Modal */}
            {rejectTarget && (
                <div className="mp-overlay" onClick={() => setRejectTarget(null)}>
                    <div className="mp-modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                        <div className="mp-modal-header">
                            <div>
                                <h2>Reject Monthly Plan</h2>
                                <div className="mp-modal-meta">
                                    {rejectTarget.employeeId?.name} — {rejectTarget.month}
                                </div>
                            </div>
                            <button className="mp-modal-close" onClick={() => setRejectTarget(null)}><FiX /></button>
                        </div>
                        <div style={{ padding: '20px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                Remarks (optional)
                            </div>
                            <textarea
                                style={{
                                    width: '100%', minHeight: '100px', padding: '10px', border: '1px solid var(--border-default)',
                                    borderRadius: 'var(--radius-md)', fontSize: '0.875rem', background: 'var(--bg-page)',
                                    color: 'var(--text-primary)', boxSizing: 'border-box'
                                }}
                                placeholder="Reason for rejection..."
                                value={rejectRemarks}
                                onChange={e => setRejectRemarks(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                                <button className="btn btn-primary" style={{ background: '#DC2626' }} onClick={handleRejectPlan}>
                                    <FiXCircle /> Reject Plan
                                </button>
                                <button className="btn btn-secondary" onClick={() => setRejectTarget(null)}>Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ========================================================
   EMPLOYEE DETAIL VIEW — analytics per employee
======================================================== */
function EmployeeDetailView({ employee, data, tab, setTab, onBack }) {
    if (!employee) return null;

    const monthlyEvals = data.monthlyEvaluations || [];
    const quarterlyEvals = data.quarterlyEvaluations || [];
    const monthlyPlans = data.monthlyPlans || [];
    const monthlyAchievements = data.monthlyAchievements || [];
    const yearlyPlans = data.yearlyPlans || [];
    const yearlyReports = data.yearlyReports || [];

    // Calculate score max for bar chart
    const maxScore = 10;

    return (
        <div className="fade-in">
            {/* Back */}
            <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: '16px' }}>
                <FiArrowLeft /> Back to Dashboard
            </button>

            <div className="md-emp-detail-panel">
                <div className="md-emp-detail-header">
                    <div className="md-emp-avatar-lg">{getInitials(employee.name)}</div>
                    <div className="md-emp-info">
                        <h3>{employee.name}</h3>
                        <p>{employee.employeeCode} • {employee.department || 'N/A'} • {employee.role}
                            {employee.reportingAuthorityId && ` • RA: ${employee.reportingAuthorityId.name}`}
                        </p>
                    </div>
                </div>

                <div className="md-emp-detail-body">
                    {/* Tabs */}
                    <div className="md-emp-tabs">
                        {['overview', 'monthly', 'quarterly', 'yearly'].map(t => (
                            <button key={t} className={`md-emp-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                                {t === 'overview' && <><FiBarChart2 /> Analytics</>}
                                {t === 'monthly' && <><FiFileText /> Monthly</>}
                                {t === 'quarterly' && <><FiBarChart2 /> Quarterly</>}
                                {t === 'yearly' && <><FiTarget /> Yearly</>}
                            </button>
                        ))}
                    </div>

                    {/* === OVERVIEW / ANALYTICS TAB === */}
                    {tab === 'overview' && (
                        <>
                            {/* Monthly Evaluation Scores Chart */}
                            <div className="md-chart-wrap">
                                <div className="md-chart-title">Monthly Evaluation Trend</div>
                                {monthlyEvals.length === 0 ? (
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No evaluations yet</p>
                                ) : (
                                    <div className="md-recharts-container">
                                        <ResponsiveContainer width="100%" height={260}>
                                            <LineChart data={[...monthlyEvals].reverse()} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                                <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                                <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                                <RechartsTooltip cursor={{ stroke: 'var(--border-default)', strokeWidth: 1, strokeDasharray: '3 3' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                                <Line type="monotone" dataKey="score" name="Score" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, fill: '#3B82F6', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </div>

                            {/* Quarterly Evaluation Scores */}
                            <div className="md-chart-wrap">
                                <div className="md-chart-title">Quarterly Evaluation Averages</div>
                                {quarterlyEvals.length === 0 ? (
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No quarterly evaluations yet</p>
                                ) : (
                                    <div className="md-recharts-container">
                                        <ResponsiveContainer width="100%" height={260}>
                                            <BarChart data={[...quarterlyEvals].reverse()} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                                <XAxis dataKey="quarter" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                                <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                                <RechartsTooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                                <Bar dataKey="averageScore" name="Avg Score" radius={[4, 4, 0, 0]} barSize={40}>
                                                    {[...quarterlyEvals].reverse().map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={getScoreColor(entry.averageScore)} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </div>

                            {/* Summary Cards */}
                            <div className="md-kpi-grid" style={{ marginBottom: 0 }}>
                                <div className="md-kpi-tile blue">
                                    <div className="md-kpi-label">Monthly Plans</div>
                                    <div className="md-kpi-value">{monthlyPlans.length}</div>
                                </div>
                                <div className="md-kpi-tile green">
                                    <div className="md-kpi-label">Achievements</div>
                                    <div className="md-kpi-value">{monthlyAchievements.length}</div>
                                </div>
                                <div className="md-kpi-tile purple">
                                    <div className="md-kpi-label">Monthly Evals</div>
                                    <div className="md-kpi-value">{monthlyEvals.length}</div>
                                </div>
                                <div className="md-kpi-tile teal">
                                    <div className="md-kpi-label">Quarterly Evals</div>
                                    <div className="md-kpi-value">{quarterlyEvals.length}</div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* === MONTHLY TAB === */}
                    {tab === 'monthly' && (
                        <>
                            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '12px' }}>Monthly Plans & Achievements</h4>
                            <div className="md-plan-list">
                                {monthlyPlans.length === 0 ? (
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No monthly plans</p>
                                ) : monthlyPlans.map(plan => {
                                    const ach = monthlyAchievements.find(a => a.monthlyPlanId?._id === plan._id || a.monthlyPlanId === plan._id);
                                    const evl = monthlyEvals.find(e => e.month === plan.month);
                                    return (
                                        <div key={plan._id} className="md-plan-item" style={{ flexWrap: 'wrap' }}>
                                            <div className="md-plan-month">{plan.month}</div>
                                            <div className="md-plan-text">{plan.planDetails}</div>
                                            <span className={`md-plan-badge ${plan.status?.toLowerCase()}`}>{plan.status}</span>
                                            {ach && <span style={{ fontSize: '0.625rem', color: 'var(--success)', fontWeight: 700 }}>✓ Achievement</span>}
                                            {evl && (
                                                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: getScoreColor(evl.score) }}>
                                                    Score: {evl.score}/10
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* === QUARTERLY TAB === */}
                    {tab === 'quarterly' && (
                        <>
                            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '12px' }}>Quarterly Evaluations</h4>
                            {quarterlyEvals.length === 0 ? (
                                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No quarterly evaluations</p>
                            ) : quarterlyEvals.map(qe => (
                                <div key={qe._id} className="md-eval-row">
                                    <div className="md-eval-month">{qe.quarter}</div>
                                    <div className="md-eval-bar-track">
                                        <div className="md-eval-bar-fill" style={{
                                            width: `${(qe.averageScore / 10) * 100}%`,
                                            background: getScoreColor(qe.averageScore)
                                        }} />
                                    </div>
                                    <div className="md-eval-score" style={{ color: getScoreColor(qe.averageScore) }}>
                                        {qe.averageScore?.toFixed(1)}/10
                                    </div>
                                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                        RA: {qe.raId?.name || 'N/A'}
                                    </div>
                                    {qe.remarks && (
                                        <div style={{ flex: '0 0 100%', fontSize: '0.75rem', fontStyle: 'italic', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            "{qe.remarks}"
                                        </div>
                                    )}
                                </div>
                            ))}
                        </>
                    )}

                    {/* === YEARLY TAB === */}
                    {tab === 'yearly' && (
                        <>
                            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '12px' }}>Yearly Plans</h4>
                            {yearlyPlans.length === 0 ? (
                                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No yearly plans</p>
                            ) : yearlyPlans.map(plan => (
                                <div key={plan._id} className="yp-plan-card" style={{ marginBottom: '10px' }}>
                                    <div className="yp-plan-header">
                                        <div className="yp-plan-year">
                                            <FiCalendar /> FY {plan.financialYear}
                                            <span className="yp-plan-version">v{plan.version}</span>
                                        </div>
                                        <span className={`yp-status ${plan.status === 'APPROVED' ? 'approved' : plan.status === 'REJECTED' ? 'rejected' : 'pending'}`}>
                                            {plan.status}
                                        </span>
                                    </div>
                                    <div className="yp-plan-field" style={{ marginTop: '8px' }}>
                                        <div className="yp-plan-field-label">Plan & Objectives</div>
                                        <div className="yp-plan-field-value">{plan.planAndObjectives}</div>
                                    </div>
                                </div>
                            ))}

                            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '20px 0 12px' }}>Yearly Appraisal Reports</h4>
                            {yearlyReports.length === 0 ? (
                                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No appraisal reports</p>
                            ) : yearlyReports.map(report => (
                                <div key={report._id} className="yp-eval-card" style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <strong>FY {report.financialYear}</strong>
                                        <span className={`yp-status ${report.status === 'COMPLETED' ? 'approved' : 'pending'}`}>
                                            {report.status?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div className="yp-plan-field">
                                        <div className="yp-plan-field-label">Work / KRA</div>
                                        <div className="yp-plan-field-value">{report.workKRA}</div>
                                    </div>
                                    <div style={{ marginTop: '8px', display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                                        {report.raScore != null && <span>RA: <strong>{report.raScore}/10</strong></span>}
                                        {report.hrdScore != null && <span>HRD: <strong>{report.hrdScore}/10</strong></span>}
                                        {report.mdFinalScore != null && <span>MD: <strong>{report.mdFinalScore}/10</strong></span>}
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default MDDashboard;
