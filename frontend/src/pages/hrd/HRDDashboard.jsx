import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
    ResponsiveContainer, PieChart, Pie, Cell, LabelList
} from 'recharts';
import {
    FiSearch, FiUsers, FiUserCheck, FiFileText, FiCheckCircle,
    FiAlertCircle, FiBarChart2, FiAward, FiChevronRight, FiCalendar,
    FiPieChart, FiList, FiAlertTriangle, FiClock,
    FiInfo, FiTrendingUp, FiTrendingDown, FiMinus, FiEye,
    FiUserPlus, FiX
} from 'react-icons/fi';
import './HRDDashboard.css';

/* ─────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────── */
const DEPT_COLORS = [
    '#185FA5', '#3B6D11', '#BA7517', '#993C1D',
    '#534AB7', '#0F6E56', '#A32D2D', '#854F0B'
];

/* ─────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────── */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPrevMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '00')}`;
}

function formatMonthLabel(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatPrevMonthName(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' });
}

function getScoreColor(score) {
    if (score === null || score === undefined) return 'var(--text-muted)';
    if (score >= 80) return '#3B6D11';
    if (score >= 60) return '#BA7517';
    return '#A32D2D';
}

function getScoreBg(score) {
    if (score === null || score === undefined) return 'var(--bg-muted)';
    if (score >= 80) return '#EAF3DE';
    if (score >= 60) return '#FAEEDA';
    return '#FCEBEB';
}

/* ─────────────────────────────────────────────────────
   MINI SPARKLINE
───────────────────────────────────────────────────── */
const Sparkline = ({ data = [], color = '#3B6D11', width = 52, height = 22 }) => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - 4 - ((v - min) / range) * (height - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
        <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};

/* ─────────────────────────────────────────────────────
   TREND BAR CHART TOOLTIP
───────────────────────────────────────────────────── */
const TrendTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const completed = payload.find(p => p.dataKey === 'completed')?.value || 0;
    const pending = payload.find(p => p.dataKey === 'pending')?.value || 0;
    const total = completed + pending;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return (
        <div className="hrd-tooltip">
            <div className="hrd-tooltip-title">{label}</div>
            <div className="hrd-tooltip-row">
                <span className="hrd-tooltip-dot" style={{ background: '#3B6D11' }} />
                <span>Completed</span><strong>{completed}</strong>
            </div>
            <div className="hrd-tooltip-row">
                <span className="hrd-tooltip-dot" style={{ background: '#BA7517' }} />
                <span>Pending</span><strong>{pending}</strong>
            </div>
            <div className="hrd-tooltip-divider" />
            <div className="hrd-tooltip-rate">{rate}% completion rate</div>
        </div>
    );
};

/* ─────────────────────────────────────────────────────
   DONUT TOOLTIP — compact pill, positioned above chart
   so it NEVER overlaps the center "22 Total" label
───────────────────────────────────────────────────── */
const DonutTooltip = ({ active, payload, deptTotal }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    const pct = deptTotal > 0 ? Math.round((d.value / deptTotal) * 100) : 0;
    return (
        <div className="hrd-donut-tooltip">
            <span className="hrd-donut-tt-dot" style={{ background: d.payload.fill }} />
            <span className="hrd-donut-tt-name">{d.name}</span>
            <span className="hrd-donut-tt-val">{d.value} · {pct}%</span>
        </div>
    );
};

/* ─────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────── */
const HRDDashboard = () => {
    const navigate = useNavigate();

    const [month, setMonth] = useState(getCurrentMonth());
    const [stats, setStats] = useState(null);
    const [prevStats, setPrevStats] = useState(null);
    const [raList, setRaList] = useState([]);
    const [trendData, setTrendData] = useState([]);
    const [deptStats, setDeptStats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [chartsLoading, setChartsLoading] = useState(true);
    const [expandedRA, setExpandedRA] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef(null);
    const searchTimeout = useRef(null);

    /* ── RA Assignment Modal ── */
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [selectedRAForAssign, setSelectedRAForAssign] = useState(null);
    const [availableEmployees, setAvailableEmployees] = useState([]);
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(new Set());
    const [assignLoading, setAssignLoading] = useState(false);

    const openAssignModal = async (ra) => {
        setSelectedRAForAssign(ra);
        setSelectedEmployeeIds(new Set());
        setAssignModalOpen(true);
        try {
            const res = await api.get('/hrd/ra/available-employees');
            setAvailableEmployees(res.data);
        } catch { toast.error('Failed to fetch available employees'); }
    };

    const toggleEmployeeSelection = (id) => {
        const next = new Set(selectedEmployeeIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedEmployeeIds(next);
    };

    const submitAssignEmployees = async () => {
        if (selectedEmployeeIds.size === 0) { toast.error('Please select at least one employee'); return; }
        setAssignLoading(true);
        try {
            await api.put(`/hrd/ra/${selectedRAForAssign._id}/assign-employees`, {
                employeeIds: Array.from(selectedEmployeeIds)
            });
            toast.success('Employees assigned successfully');
            setAssignModalOpen(false);
            fetchData();
        } catch { toast.error('Failed to assign employees'); }
        finally { setAssignLoading(false); }
    };

    /* ── Data fetching ── */
    const fetchData = useCallback(async () => {
        setLoading(true);
        const prev = getPrevMonth(month);
        try {
            const [statsRes, prevStatsRes, raRes] = await Promise.all([
                api.get('/hrd/dashboard', { params: { month } }),
                api.get('/hrd/dashboard', { params: { month: prev } }),
                api.get('/hrd/ra-list', { params: { month } })
            ]);
            setStats(statsRes.data);
            setPrevStats(prevStatsRes.data);
            setRaList(raRes.data);
        } catch { toast.error('Failed to load dashboard data'); }
        finally { setLoading(false); }
    }, [month]);

    const fetchCharts = useCallback(async () => {
        setChartsLoading(true);
        try {
            const [trendRes, deptRes] = await Promise.all([
                api.get('/hrd/evaluation-trend', { params: { months: 6 } }),
                api.get('/hrd/department-stats')
            ]);
            setTrendData(trendRes.data);
            setDeptStats(deptRes.data);
        } catch { /* non-critical */ }
        finally { setChartsLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { fetchCharts(); }, [fetchCharts]);

    /* ── Search ── */
    const handleSearch = (val) => {
        setSearchQuery(val);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (val.length < 1) { setSearchResults([]); setSearchOpen(false); return; }
        searchTimeout.current = setTimeout(async () => {
            try {
                const res = await api.get('/hrd/search', { params: { q: val } });
                setSearchResults(res.data);
                setSearchOpen(true);
            } catch { setSearchResults([]); }
        }, 250);
    };

    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const goToDetail = (userId, role) => {
        setSearchOpen(false); setSearchQuery('');
        if (role === 'RA') {
            setExpandedRA(userId);
            setTimeout(() => {
                const el = document.getElementById(`ra-${userId}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        } else {
            navigate(`/hrd/employee/${userId}`);
        }
    };

    /* ── Computed ── */
    const alerts = useMemo(() => {
        if (!stats || !raList.length) return [];
        const list = [];
        raList.forEach(ra => {
            const pending = ra.employeeCount - ra.evaluated;
            if (ra.employeeCount === 0) {
                list.push({ id: `ra-empty-${ra._id}`, type: 'info', message: `${ra.name} has no employees assigned — setup incomplete`, cta: 'Fix' });
            } else if (pending >= 5) {
                list.push({ id: `ra-pending-${ra._id}`, type: 'warning', message: `${ra.name} has ${pending} pending evaluations this month`, cta: 'Review' });
            }
        });
        if (stats.orgHealthScore < 30 && stats.totalEmployees > 0) {
            list.unshift({ id: 'health-danger', type: 'danger', message: `Evaluation completion is critically low at ${stats.orgHealthScore}% this month`, cta: 'View' });
        }
        if (stats.pendingEvaluations > 0) {
            list.push({ id: 'pending-global', type: 'pending', message: `${stats.pendingEvaluations} evaluation${stats.pendingEvaluations > 1 ? 's' : ''} pending across the organisation this month`, cta: 'View' });
        }
        return list.slice(0, 5);
    }, [stats, raList]);

    const kpiDelta = (key) => {
        if (!stats || !prevStats) return null;
        return (stats[key] || 0) - (prevStats[key] || 0);
    };

    const deptTotal = useMemo(() => deptStats.reduce((s, d) => s + d.count, 0), [deptStats]);

    if (loading) {
        return (
            <div className="hrd-loading">
                <div className="hrd-loading-spinner" />
                <p>Loading HRD Dashboard…</p>
            </div>
        );
    }

    /* ─────────────────────────────────────────────────
       RENDER
    ───────────────────────────────────────────────── */
    return (
        <div className="hrd-root fade-in">

            {/* ── Page Header with month filter inline ── */}
            <div className="hrd-page-header">
                <div className="hrd-page-header-left">
                    <h1 className="hrd-page-title">HRD Dashboard</h1>
                    <p className="hrd-page-sub">
                        Organisation-wide performance overview — {formatMonthLabel(month)}
                    </p>
                </div>
                <div className="hrd-month-filter">
                    <FiCalendar style={{ fontSize: 15, color: 'var(--text-muted)' }} />
                    <label>Viewing month</label>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
                </div>
            </div>

            {/* ── Search Bar — directly below title ── */}
            <div className="hrd-search-section" ref={searchRef}>
                <div className="hrd-search-wrap">
                    <FiSearch className="hrd-search-icon" />
                    <input
                        type="text"
                        className="hrd-search-input"
                        placeholder="Search employees or reporting authorities…"
                        value={searchQuery}
                        onChange={e => handleSearch(e.target.value)}
                        onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }}
                    />
                    {searchOpen && (
                        <div className="hrd-search-results">
                            {searchResults.length === 0 ? (
                                <div className="hrd-search-empty">No results for "{searchQuery}"</div>
                            ) : searchResults.map(u => (
                                <div key={u._id} className="hrd-search-item" onClick={() => goToDetail(u._id, u.role)}>
                                    <div className={`hrd-search-avatar ${u.role === 'RA' ? 'ra' : ''}`}>{getInitials(u.name)}</div>
                                    <div className="hrd-search-info">
                                        <div className="hrd-search-name">{u.name}</div>
                                        <div className="hrd-search-meta">{u.employeeCode} · {u.department || 'N/A'}</div>
                                    </div>
                                    <span className={`hrd-role-tag ${u.role.toLowerCase()}`}>{u.role}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── KPI Cards ── */}
            {stats && (
                <div className="hrd-kpi-grid">
                    <KPICard label="Total Employees" value={stats.totalEmployees} sub={`${stats.totalRAs} reporting authorities`} icon={<FiUsers />} delta={kpiDelta('totalEmployees')} prevLabel={formatPrevMonthName(getPrevMonth(month))} sparkData={trendData.map(d => d.completed + d.pending)} color="blue" />
                    <KPICard label="Plans This Month" value={stats.plansThisMonth} sub="Total plans submitted" icon={<FiFileText />} delta={kpiDelta('plansThisMonth')} prevLabel={formatPrevMonthName(getPrevMonth(month))} sparkData={trendData.map(d => d.completed + d.pending)} color="green" />
                    <KPICard label="Evaluated" value={stats.evaluationsThisMonth} sub={`${stats.pendingEvaluations} still pending`} icon={<FiCheckCircle />} delta={kpiDelta('evaluationsThisMonth')} prevLabel={formatPrevMonthName(getPrevMonth(month))} sparkData={trendData.map(d => d.completed)} color="orange" warn={stats.pendingEvaluations > 0} />
                    <KPICard label="Quarterly Reports" value={stats.totalQuarterly} sub="All time total" icon={<FiBarChart2 />} delta={kpiDelta('totalQuarterly')} prevLabel={formatPrevMonthName(getPrevMonth(month))} sparkData={trendData.map(d => d.completed)} color="purple" />
                </div>
            )}

            {/* ── Alert / Insight Strip — now BELOW KPI cards ── */}
            {alerts.length > 0 && (
                <div className="hrd-alert-strip">
                    {alerts.map(alert => (
                        <div key={alert.id} className={`hrd-alert-pill hrd-alert-${alert.type}`}>
                            <span className="hrd-alert-icon">
                                {alert.type === 'warning' && <FiAlertTriangle />}
                                {alert.type === 'pending' && <FiClock />}
                                {alert.type === 'info' && <FiInfo />}
                                {alert.type === 'danger' && <FiAlertCircle />}
                            </span>
                            <span className="hrd-alert-msg">{alert.message}</span>
                            <button className="hrd-alert-cta">{alert.cta}</button>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Shortcuts: Monthly Overview | Employee Overview | Yearly Appraisal ── */}
            <div className="hrd-shortcuts">
                <Link to="/hrd/monthly-overview" className="hrd-shortcut">
                    <div className="hrd-shortcut-icon green"><FiList /></div>
                    <div className="hrd-shortcut-body">
                        <h4>Monthly Overview</h4>
                        <p>Comprehensive tracking of all employee monthly plans</p>
                    </div>
                    <FiChevronRight className="hrd-shortcut-arrow" />
                </Link>
                <Link to="/hrd/employees" className="hrd-shortcut">
                    <div className="hrd-shortcut-icon blue"><FiUsers /></div>
                    <div className="hrd-shortcut-body">
                        <h4>Employee Overview</h4>
                        <p>Interactive overview of all employees and reporting authorities</p>
                    </div>
                    <FiChevronRight className="hrd-shortcut-arrow" />
                </Link>
                <Link to="/hrd/yearly-appraisal" className="hrd-shortcut">
                    <div className="hrd-shortcut-icon amber"><FiAward /></div>
                    <div className="hrd-shortcut-body">
                        <h4>Yearly Appraisal</h4>
                        <p>Generate yearly appraisals and provide HRD review marks</p>
                    </div>
                    <FiChevronRight className="hrd-shortcut-arrow" />
                </Link>
            </div>

            {/* ── Charts Row ── */}
            <div className="hrd-charts-row">

                {/* Trend Bar Chart */}
                <div className="hrd-chart-card">
                    <div className="hrd-chart-header">
                        <div>
                            <h3 className="hrd-chart-title"><FiBarChart2 /> Evaluation Trend</h3>
                            <p className="hrd-chart-sub">Last 6 months — completed vs pending</p>
                        </div>
                    </div>
                    {chartsLoading ? (
                        <div className="hrd-chart-skeleton">
                            {[40, 65, 55, 80, 45, 70].map((h, i) => (
                                <div key={i} className="hrd-skeleton-bar" style={{ height: `${h}%` }} />
                            ))}
                        </div>
                    ) : trendData.length > 0 ? (
                        <div className="hrd-chart-body">
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={trendData} margin={{ top: 20, right: 16, left: -16, bottom: 0 }} barGap={4}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <RechartsTooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                                    <Bar dataKey="completed" name="Completed" fill="#3B6D11" radius={[4, 4, 0, 0]} barSize={18} maxBarSize={28}>
                                        <LabelList dataKey="completed" position="top" formatter={v => v > 0 ? v : ''} style={{ fontSize: 10, fill: '#3B6D11', fontWeight: 600 }} />
                                    </Bar>
                                    <Bar dataKey="pending" name="Pending" fill="#BA7517" radius={[4, 4, 0, 0]} barSize={18} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                            <div className="hrd-chart-legend">
                                <span className="hrd-legend-item"><span className="hrd-legend-dot" style={{ background: '#3B6D11' }} />Completed</span>
                                <span className="hrd-legend-item"><span className="hrd-legend-dot" style={{ background: '#BA7517' }} />Pending</span>
                            </div>
                        </div>
                    ) : (
                        <div className="hrd-chart-empty">No trend data available</div>
                    )}
                </div>

                {/* Workforce Donut */}
                <div className="hrd-chart-card">
                    <div className="hrd-chart-header">
                        <div>
                            <h3 className="hrd-chart-title"><FiPieChart /> Workforce Distribution</h3>
                            <p className="hrd-chart-sub">Employees by department</p>
                        </div>
                    </div>
                    {chartsLoading ? (
                        <div className="hrd-donut-skeleton"><div className="hrd-skeleton-circle" /></div>
                    ) : deptStats.length > 0 ? (
                        <div className="hrd-chart-body">
                            <div className="hrd-donut-wrap">
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={deptStats}
                                            dataKey="count"
                                            nameKey="department"
                                            cx="50%" cy="50%"
                                            innerRadius={52}
                                            outerRadius={75}
                                            paddingAngle={3}
                                            labelLine={false}
                                        >
                                            {deptStats.map((_, i) => (
                                                <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        {/*
                                          FIX: Custom tooltip positioned at top-left (0, -48) of the chart
                                          so it renders ABOVE the donut and never overlaps the center label.
                                        */}
                                        <RechartsTooltip
                                            content={<DonutTooltip deptTotal={deptTotal} />}
                                            position={{ x: 0, y: -48 }}
                                            allowEscapeViewBox={{ x: true, y: true }}
                                            offset={0}
                                            wrapperStyle={{ pointerEvents: 'none' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                {/* Always-visible center label */}
                                <div className="hrd-donut-center">
                                    <span className="hrd-donut-total">{deptTotal}</span>
                                    <span className="hrd-donut-label">Total</span>
                                </div>
                            </div>
                            <div className="hrd-dept-legend">
                                {deptStats.map((d, i) => (
                                    <div key={d.department} className="hrd-dept-legend-item">
                                        <span className="hrd-dept-dot" style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                                        <span className="hrd-dept-name">{d.department}</span>
                                        <span className="hrd-dept-count">{d.count}</span>
                                        <span className="hrd-dept-pct">{Math.round((d.count / deptTotal) * 100)}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="hrd-chart-empty">No department data available</div>
                    )}
                </div>
            </div>

            {/* ── Reporting Authorities ── */}
            <div className="hrd-section-header">
                <span className="hrd-section-title"><FiUserCheck /> Reporting Authorities</span>
                <span className="hrd-section-count">{raList.length} RAs</span>
            </div>

            <div className="hrd-ra-grid">
                {raList.map(ra => {
                    const progress = ra.employeeCount > 0 ? Math.round((ra.evaluated / ra.employeeCount) * 100) : 0;
                    const isExpanded = expandedRA === ra._id;
                    const isEmpty = ra.employeeCount === 0;
                    return (
                        <div
                            key={ra._id}
                            id={`ra-${ra._id}`}
                            className={`hrd-ra-card${isExpanded ? ' active' : ''}${isEmpty ? ' empty' : ''}`}
                            onClick={() => !isEmpty && setExpandedRA(isExpanded ? null : ra._id)}
                        >
                            <div className="hrd-ra-top">
                                <div className="hrd-ra-avatar">{getInitials(ra.name)}</div>
                                <div className="hrd-ra-info">
                                    <div className="hrd-ra-name">{ra.name}</div>
                                    <div className="hrd-ra-meta">{ra.employeeCode} · {ra.department || 'N/A'}</div>
                                </div>
                                {!isEmpty && (
                                    <>
                                        <div className={`hrd-ra-progress-badge ${progress === 100 ? 'done' : progress > 0 ? 'partial' : 'none'}`}>{progress}%</div>
                                        <button className="hrd-ra-quick-assign" title="Assign more employees" onClick={e => { e.stopPropagation(); openAssignModal(ra); }}><FiUserPlus /></button>
                                    </>
                                )}
                            </div>
                            {isEmpty ? (
                                <div className="hrd-ra-empty-state">
                                    <p>No employees assigned yet</p>
                                    <button className="hrd-ra-assign-btn" onClick={e => { e.stopPropagation(); openAssignModal(ra); }}>+ Assign employees</button>
                                </div>
                            ) : (
                                <>
                                    <div className="hrd-ra-stats">
                                        <div className="hrd-ra-stat"><div className="hrd-ra-stat-val">{ra.employeeCount}</div><div className="hrd-ra-stat-key">Employees</div></div>
                                        <div className="hrd-ra-stat"><div className="hrd-ra-stat-val" style={{ color: '#3B6D11' }}>{ra.evaluated}</div><div className="hrd-ra-stat-key">Evaluated</div></div>
                                        <div className="hrd-ra-stat"><div className="hrd-ra-stat-val" style={{ color: (ra.employeeCount - ra.evaluated) > 0 ? '#BA7517' : 'var(--text-muted)' }}>{ra.employeeCount - ra.evaluated}</div><div className="hrd-ra-stat-key">Pending</div></div>
                                    </div>
                                    <div>
                                        <div className="hrd-ra-progress-meta"><span>Evaluation Progress</span><span>{progress}%</span></div>
                                        <div className="hrd-ra-progress-track">
                                            <div className="hrd-ra-progress-fill" style={{ width: `${progress}%`, background: progress === 100 ? '#3B6D11' : progress >= 50 ? '#BA7517' : '#E85523' }} />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Employees under expanded RA ── */}
            {expandedRA && (() => {
                const ra = raList.find(r => r._id === expandedRA);
                if (!ra || !ra.employees || ra.employees.length === 0) return null;
                return (
                    <div className="hrd-emp-section">
                        <div className="hrd-section-header">
                            <span className="hrd-section-title" style={{ fontSize: '1rem' }}><FiUsers /> Employees under {ra.name}</span>
                            <span className="hrd-section-count">{ra.employees.length} members</span>
                        </div>
                        <div className="hrd-emp-grid">
                            {ra.employees.map(emp => {
                                const scoreColor = getScoreColor(emp.lastScore);
                                const scoreBg = getScoreBg(emp.lastScore);
                                return (
                                    <div key={emp._id} className="hrd-emp-card" onClick={() => navigate(`/hrd/employee/${emp._id}`)}>
                                        <div className="hrd-emp-avatar">{getInitials(emp.name)}</div>
                                        <div className="hrd-emp-body">
                                            <div className="hrd-emp-top-row">
                                                <div className="hrd-emp-name">{emp.name}</div>
                                                <span className="hrd-emp-status-badge" style={{ background: emp.evaluationStatus === 'evaluated' ? '#EAF3DE' : emp.evaluationStatus === 'pending' ? '#FAEEDA' : '#F1EFE8', color: emp.evaluationStatus === 'evaluated' ? '#27500A' : emp.evaluationStatus === 'pending' ? '#633806' : '#5F5E5A' }}>
                                                    {emp.evaluationStatus === 'evaluated' ? 'Evaluated' : emp.evaluationStatus === 'pending' ? 'Pending' : 'Not started'}
                                                </span>
                                            </div>
                                            <div className="hrd-emp-meta">{emp.employeeCode} · {emp.department || 'N/A'}</div>
                                            <div className="hrd-emp-score-row">
                                                <div className="hrd-emp-score-bar-track">
                                                    <div className="hrd-emp-score-bar-fill" style={{ width: emp.lastScore != null ? `${emp.lastScore}%` : '0%', background: scoreColor }} />
                                                </div>
                                                <span className="hrd-emp-score-chip" style={{ background: scoreBg, color: scoreColor }}>
                                                    {emp.lastScore != null ? `${Math.round(emp.lastScore)}/100` : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="hrd-emp-actions">
                                            <button className="hrd-emp-action-btn" title="View profile" onClick={e => { e.stopPropagation(); navigate(`/hrd/employee/${emp._id}`); }}><FiEye /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {/* ── Assign Employees Modal ── */}
            {assignModalOpen && selectedRAForAssign && (
                <div className="hrd-modal-overlay fade-in" onClick={() => setAssignModalOpen(false)}>
                    <div className="hrd-assign-modal" onClick={e => e.stopPropagation()}>
                        <div className="hrd-assign-header">
                            <div>
                                <h3>Assign Employees to {selectedRAForAssign.name}</h3>
                                <p>Select employees to move or assign to this reporting authority</p>
                            </div>
                            <button className="hrd-modal-close" onClick={() => setAssignModalOpen(false)}><FiX /></button>
                        </div>
                        <div className="hrd-assign-body">
                            {availableEmployees.length === 0 ? (
                                <div className="hrd-assign-empty">No active employees found.</div>
                            ) : (
                                <div className="hrd-assign-list">
                                    {availableEmployees.map(emp => {
                                        const isSelected = selectedEmployeeIds.has(emp._id);
                                        const isAlreadyAssigned = emp.reportingAuthorityId?._id === selectedRAForAssign._id;
                                        return (
                                            <div key={emp._id} className={`hrd-assign-item${isSelected ? ' selected' : ''}${isAlreadyAssigned ? ' disabled' : ''}`} onClick={() => !isAlreadyAssigned && toggleEmployeeSelection(emp._id)}>
                                                <input type="checkbox" checked={isSelected || isAlreadyAssigned} disabled={isAlreadyAssigned} onChange={() => { }} />
                                                <div className="hrd-assign-emp-info">
                                                    <div className="hrd-assign-emp-name">{emp.name}</div>
                                                    <div className="hrd-assign-emp-meta">
                                                        {emp.employeeCode} · {emp.department || 'N/A'}
                                                        {emp.reportingAuthorityId && <span className="hrd-assign-current-ra">(Current RA: {emp.reportingAuthorityId.name})</span>}
                                                    </div>
                                                </div>
                                                {isAlreadyAssigned && <span className="hrd-assign-badge">Already Assigned</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="hrd-assign-footer">
                            <button className="hrd-btn-secondary" onClick={() => setAssignModalOpen(false)} disabled={assignLoading}>Cancel</button>
                            <button className="hrd-btn-primary" onClick={submitAssignEmployees} disabled={selectedEmployeeIds.size === 0 || assignLoading}>
                                {assignLoading ? 'Assigning...' : `Assign ${selectedEmployeeIds.size} Employee(s)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────────────────
   KPI CARD
───────────────────────────────────────────────────── */
const KPICard = ({ label, value, sub, icon, delta, prevLabel, sparkData, color, warn }) => {
    const hasDelta = delta !== null && delta !== undefined;
    const isUp = hasDelta && delta > 0;
    const isDown = hasDelta && delta < 0;
    const isFlat = hasDelta && delta === 0;
    const sparkColor = color === 'green' ? '#3B6D11' : color === 'orange' ? '#BA7517' : color === 'purple' ? '#534AB7' : '#185FA5';
    return (
        <div className={`hrd-kpi-card hrd-kpi-${color}`}>
            <div className="hrd-kpi-header">
                <span className="hrd-kpi-label"><span className="hrd-kpi-icon">{icon}</span>{label}</span>
                <Sparkline data={sparkData} color={sparkColor} width={52} height={22} />
            </div>
            <div className="hrd-kpi-value">{value}</div>
            <div className="hrd-kpi-footer">
                {hasDelta && (
                    <span className={`hrd-delta-chip ${isUp ? 'up' : isDown ? 'down' : 'flat'}`}>
                        {isUp && <FiTrendingUp />}{isDown && <FiTrendingDown />}{isFlat && <FiMinus />}
                        {isUp ? `+${delta}` : isDown ? `${delta}` : 'No change'} vs {prevLabel}
                    </span>
                )}
                {warn ? <span className="hrd-kpi-warn"><FiAlertCircle /> {sub}</span> : <span className="hrd-kpi-sub-text">{sub}</span>}
            </div>
        </div>
    );
};

export default HRDDashboard;