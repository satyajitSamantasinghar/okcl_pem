import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiUsers, FiFileText, FiCheckCircle,
    FiBarChart2, FiSearch, FiCalendar,
    FiClock, FiTarget, FiChevronRight,
    FiArrowLeft, FiActivity, FiPieChart, FiUsers as FiUsersIcon,
    FiAlertCircle, FiAward, FiRefreshCw, FiTrendingUp
} from 'react-icons/fi';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import './MDDashboard.css';

/* ====================================================
   HELPERS
==================================================== */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getRatioColorClass(pct) {
    if (pct >= 75) return 'green';
    if (pct >= 40) return 'amber';
    return 'red';
}

const progressBarColor = (rate) => {
    if (rate >= 75) return '#10B981';
    if (rate >= 40) return '#F59E0B';
    return '#EF4444';
};

const TOOLTIP_STYLE = {
    contentStyle: {
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-default, #E5E7EB)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        fontSize: '12px',
        padding: '10px 14px',
        color: 'var(--text-primary, #111827)'
    },
    wrapperStyle: { zIndex: 9999 },
    cursor: { fill: 'rgba(0,0,0,0.03)' },
    labelStyle: { fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }
};

/* ── Compact KPI Card (industry-standard: label + value + bar + badge) ── */
const KPICard = ({ label, value, sub, icon, iconColor, accentColor, progress, badge, badgeVariant, onClick }) => (
    <div
        className={`md-kpi-card${onClick ? ' clickable' : ''}`}
        style={{ borderLeftColor: accentColor || 'var(--border-default)' }}
        onClick={onClick}
    >
        <div className="md-kpi-row-top">
            <div className="md-kpi-icon" style={{ background: `${accentColor || '#3B82F6'}14`, color: accentColor || '#3B82F6' }}>
                {icon}
            </div>
            <span className="md-kpi-label">{label}</span>
        </div>
        <div className="md-kpi-value">{value}</div>
        {progress !== undefined && (
            <div className="md-kpi-bar-track">
                <div className="md-kpi-bar-fill" style={{
                    width: `${Math.min(100, progress)}%`,
                    background: accentColor || progressBarColor(progress)
                }} />
            </div>
        )}
        <div className="md-kpi-footer-row">
            {badge && <span className={`md-kpi-badge ${badgeVariant || 'neutral'}`}>{badge}</span>}
            {sub && <span className="md-kpi-sub">{sub}</span>}
        </div>
    </div>
);

/* ── Mini Progress Bar for RA Table ── */
const MiniBar = ({ value, max = 100, color }) => (
    <div className="md-mini-bar-wrap">
        <div className="md-mini-bar-fill" style={{ width: `${Math.min(100, value)}%`, background: color || progressBarColor(value) }} />
    </div>
);

/* ── Chart Card Wrapper ── */
const ChartCard = ({ icon, title, subtitle, badge, children, className = '' }) => (
    <div className={`md-chart-card ${className}`}>
        <div className="md-chart-card-header">
            <div className="md-chart-card-title-group">
                <h3 className="md-chart-card-title">{icon} {title}</h3>
                {subtitle && <p className="md-chart-card-sub">{subtitle}</p>}
            </div>
            {badge && <span className="md-chart-card-badge">{badge}</span>}
        </div>
        {children}
    </div>
);

/* ====================================================
   COMPONENT
==================================================== */
const currentYear = new Date().getFullYear();
const MDDashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [lastRefreshed, setLastRefreshed] = useState(new Date());

    useEffect(() => {
        const emp = location.state?.openEmployee;
        if (emp) { loadEmployeeDetail(emp); window.history.replaceState({}, ''); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(String(currentYear));

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

    // Data lists
    const [monthlyPlansList, setMonthlyPlansList] = useState([]);
    const [yearlyPlansList, setYearlyPlansList] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);

    /* ---- Fetches ---- */
    const fetchDashboard = useCallback(async () => {
        try {
            const res = await api.get('/md/dashboard');
            setStats(res.data);
            setLastRefreshed(new Date());
        } catch { toast.error('Failed to load dashboard'); }
        finally { setLoading(false); }
    }, []);

    const fetchMonthlyPlans = useCallback(async () => {
        try { const res = await api.get('/md/monthly-plans', { params: { year: selectedYear } }); setMonthlyPlansList(res.data); } catch { /* silent */ }
    }, [selectedYear]);

    const fetchYearlyPlans = useCallback(async () => {
        try { const res = await api.get('/md/yearly-plans'); setYearlyPlansList(res.data); } catch { /* silent */ }
    }, []);

    const fetchAllEmployees = useCallback(async () => {
        try { const res = await api.get('/md/employees'); setAllEmployees(res.data); } catch { /* silent */ }
    }, []);

    useEffect(() => {
        fetchDashboard(); fetchMonthlyPlans(); fetchYearlyPlans(); fetchAllEmployees();
    }, [fetchDashboard, fetchMonthlyPlans, fetchYearlyPlans, fetchAllEmployees]);

    const handleRefresh = () => {
        setLoading(true);
        fetchDashboard(); fetchMonthlyPlans(); fetchYearlyPlans(); fetchAllEmployees();
    };

    /* ---- Derived metrics ---- */
    const empTotal = stats?.totalEmployees || 1;
    const mpCount = stats?.monthlyPlansSubmitted || 0;
    const achCount = stats?.monthlyAchievementsSubmitted || 0;
    const ypCount = stats?.yearlyPlansTotal || 0;
    const ypPending = stats?.yearlyPlansPending || 0;
    const ypApproved = Math.max(0, ypCount - ypPending);

    const mpPct = Math.round((mpCount / empTotal) * 100);
    const achPct = Math.round((achCount / Math.max(mpCount, 1)) * 100);
    const ypPct = ypCount > 0 ? Math.round((ypApproved / ypCount) * 100) : 0;

    const currentMonth = (() => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    })();

    const evaluationsThisMonth = useMemo(() =>
        monthlyPlansList.filter(p => p.month === currentMonth && p.evaluationStatus === 'EVALUATED').length,
        [monthlyPlansList, currentMonth]
    );
    const evalPct = Math.round((evaluationsThisMonth / Math.max(mpCount, 1)) * 100);

    // Composite org health score (weighted average of key metrics)
    const orgHealthScore = Math.round((mpPct * 0.35) + (evalPct * 0.35) + (ypPct * 0.3));

    // 6-month trend
    const trendData = useMemo(() => {
        const dataMap = {};
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            dataMap[mStr] = { month: mStr, submitted: 0, achieved: 0, evaluated: 0 };
        }
        monthlyPlansList.forEach(p => {
            if (dataMap[p.month]) {
                dataMap[p.month].submitted += 1;
                if (p.hasAchievement) dataMap[p.month].achieved += 1;
                if (p.evaluationStatus === 'EVALUATED') dataMap[p.month].evaluated += 1;
            }
        });
        return Object.keys(dataMap).sort().map(k => ({
            month: new Date(dataMap[k].month + '-01').toLocaleDateString('en-US', { month: 'short' }),
            'Plans': dataMap[k].submitted,
            'Achievements': dataMap[k].achieved,
            'Evaluations': dataMap[k].evaluated
        }));
    }, [monthlyPlansList]);

    // Workforce distribution
    const deptStats = useMemo(() => {
        const counts = {};
        allEmployees.forEach(emp => {
            const d = emp.department || 'Unassigned';
            counts[d] = (counts[d] || 0) + 1;
        });
        return Object.keys(counts).map(dept => ({ department: dept, count: counts[dept] })).sort((a, b) => b.count - a.count);
    }, [allEmployees]);
    const DEPT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6'];

    // RA Leaderboard
    const raLeaderboard = useMemo(() => {
        const raMap = {};
        allEmployees.filter(e => e.role === 'RA').forEach(ra => {
            raMap[ra.id] = { id: ra.id, name: ra.name, teamEmployeeIds: new Set(), plansThisMonth: 0, achievementsThisMonth: 0, evaluatedTotal: 0 };
        });
        allEmployees.forEach(emp => {
            if (emp.role === 'EMPLOYEE' && emp.reportingAuthorityId) {
                const raId = emp.reportingAuthorityId?.id || emp.reportingAuthorityId;
                if (raMap[raId]) raMap[raId].teamEmployeeIds.add(String(emp.id));
            }
        });
        monthlyPlansList.forEach(p => {
            const empId = String(p.employeeId?.id || p.employeeId);
            const isNow = p.month === currentMonth;
            Object.values(raMap).forEach(ra => {
                if (ra.teamEmployeeIds.has(empId)) {
                    if (isNow) ra.plansThisMonth += 1;
                    if (isNow && p.hasAchievement) ra.achievementsThisMonth += 1;
                    if (p.evaluationStatus === 'EVALUATED') ra.evaluatedTotal += 1;
                }
            });
        });
        return Object.values(raMap).map(ra => {
            const teamSize = ra.teamEmployeeIds.size;
            const subPct = teamSize > 0 ? Math.round((ra.plansThisMonth / teamSize) * 100) : 0;
            const achPct = ra.plansThisMonth > 0 ? Math.round((ra.achievementsThisMonth / ra.plansThisMonth) * 100) : 0;
            return { name: ra.name, teamSize, subPct, achPct, evaluated: ra.evaluatedTotal };
        }).sort((a, b) => b.evaluated - a.evaluated || b.subPct - a.subPct);
    }, [allEmployees, monthlyPlansList, currentMonth]);

    // Yearly pending count
    const pendingYearlyCount = useMemo(() => yearlyPlansList.filter(p => p.status === 'PENDING').length, [yearlyPlansList]);

    // Number of RAs
    const totalRAs = stats?.totalRAs || allEmployees.filter(e => e.role === 'RA').length || 0;

    /* ---- Search ---- */
    const handleSearch = (val) => {
        setSearchQuery(val);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (val.length < 1) { setSearchResults([]); setSearchOpen(false); return; }
        searchTimeout.current = setTimeout(async () => {
            try { const res = await api.get('/md/employees', { params: { q: val } }); setSearchResults(res.data); setSearchOpen(true); }
            catch { setSearchResults([]); }
        }, 300);
    };

    const loadEmployeeDetail = async (emp) => {
        setSelectedEmployee(emp); setEmpTab('overview'); setEmpDetailLoading(true);
        setSearchOpen(false); setSearchQuery('');
        try { const res = await api.get(`/md/employee/${emp.id}`); setEmpDetail(res.data); }
        catch { toast.error('Failed to load employee detail'); }
        finally { setEmpDetailLoading(false); }
    };

    useEffect(() => {
        const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* ---- Format last refreshed ---- */
    const refreshedLabel = lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading executive dashboard...</p>
            </div>
        );
    }

    if (selectedEmployee && empDetail) {
        return <EmployeeDetailView
            employee={empDetail.employee} data={empDetail}
            tab={empTab} setTab={setEmpTab}
            loading={empDetailLoading}
            onBack={() => { setSelectedEmployee(null); setEmpDetail(null); }}
            navigate={navigate}
        />;
    }

    /* ========================================================
       RENDER
    ======================================================== */
    return (
        <div className="md-dashboard-container md-fade-in fade-in">

            {/* ── Page Header ── */}
            <div className="md-page-header">
                <div className="md-page-header-left">
                    <h1 className="md-page-title">Managing Director Dashboard</h1>
                    <p className="md-page-sub">Executive organisation-wide performance oversight</p>
                </div>
                <div className="md-page-header-right">
                    {/* Search */}
                    <div className="md-nav-search" ref={searchRef}>
                        <FiSearch size={13} />
                        <input type="text" placeholder="Search employee or RA..." value={searchQuery} onChange={e => handleSearch(e.target.value)} />
                        {searchOpen && searchResults.length > 0 && (
                            <div className="md-search-dropdown">
                                {searchResults.map(emp => (
                                    <div key={emp.id} className="md-search-item" onClick={() => loadEmployeeDetail(emp)}>
                                        <div className="md-search-avatar">{getInitials(emp.name)}</div>
                                        <div className="md-search-info">
                                            <div className="md-search-name">{emp.name}</div>
                                            <div className="md-search-meta">{emp.employeeCode} • {emp.role}</div>
                                        </div>
                                        <FiChevronRight style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Year filter */}
                    <div className="md-year-filter">
                        <FiCalendar size={12} />
                        <label htmlFor="md-year-select">FY</label>
                        <select id="md-year-select" value={selectedYear} onChange={e => setSelectedYear(e.target.value)}>
                            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                                <option key={y} value={y}>{y}–{y + 1}</option>
                            ))}
                        </select>
                    </div>
                    {/* Refresh */}
                    <button className="md-refresh-btn" onClick={handleRefresh} title="Refresh data">
                        <FiRefreshCw size={13} />
                    </button>
                </div>
            </div>

            {/* ── Executive Pulse Strip ── */}
            <div className="md-pulse-strip">
                <div className="md-pulse-item">
                    <span className="md-pulse-dot blue" />
                    <span className="md-pulse-val">{stats?.totalEmployees ?? 0}</span>
                    <span className="md-pulse-lbl">Employees</span>
                </div>
                <div className="md-pulse-divider" />
                <div className="md-pulse-item">
                    <span className="md-pulse-dot purple" />
                    <span className="md-pulse-val">{totalRAs}</span>
                    <span className="md-pulse-lbl">Reporting Authorities</span>
                </div>
                <div className="md-pulse-divider" />
                <div className="md-pulse-item">
                    <span className="md-pulse-dot green" />
                    <span className="md-pulse-val">{ypApproved}/{ypCount}</span>
                    <span className="md-pulse-lbl">Yearly Plans Approved</span>
                </div>
                <div className="md-pulse-divider" />
                <div className="md-pulse-item">
                    <span className={`md-pulse-dot ${orgHealthScore >= 70 ? 'green' : orgHealthScore >= 40 ? 'amber' : 'red'}`} />
                    <span className="md-pulse-val">{orgHealthScore}%</span>
                    <span className="md-pulse-lbl">Org Health Score</span>
                </div>
                <div className="md-pulse-divider" />
                <div className="md-pulse-item md-pulse-item--muted">
                    <FiRefreshCw size={11} />
                    <span className="md-pulse-lbl">Refreshed at {refreshedLabel}</span>
                </div>
            </div>

            {/* ── Alert Banner (only if pending) ── */}
            {pendingYearlyCount > 0 ? (
                <div className="md-alert-banner md-alert-banner--warning">
                    <div className="md-alert-banner-icon"><FiAlertCircle /></div>
                    <div className="md-alert-banner-body">
                        <span className="md-alert-banner-title">
                            <span className="md-alert-count">{pendingYearlyCount}</span>
                            {' '}yearly plan{pendingYearlyCount !== 1 ? 's' : ''} {pendingYearlyCount !== 1 ? 'are' : 'is'} awaiting your review
                        </span>
                        <span className="md-alert-banner-sub">Open each plan in full before approving or rejecting</span>
                    </div>
                    <Link to="/md/approvals" className="md-alert-banner-cta">
                        Review Plans <FiChevronRight size={14} />
                    </Link>
                </div>
            ) : (
                <div className="md-alert-banner md-alert-banner--success">
                    <div className="md-alert-banner-icon"><FiCheckCircle /></div>
                    <div className="md-alert-banner-body">
                        <span className="md-alert-banner-title">All yearly plans are up to date</span>
                        <span className="md-alert-banner-sub">No pending approvals at this time</span>
                    </div>
                </div>
            )}

            {/* ── Section: Organisation Overview ── */}
            <div className="md-section-header">
                <span className="md-section-title"><FiUsers size={15} /> Organisation Overview</span>
                <span className="md-section-badge">{new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            </div>

            {/* KPI Cards Grid */}
            <div className="md-kpi-grid">
                <KPICard
                    label="Total Employees"
                    value={stats?.totalEmployees ?? 0}
                    sub={`${totalRAs} reporting ${totalRAs === 1 ? 'authority' : 'authorities'}`}
                    icon={<FiUsersIcon />}
                    iconColor="#3B82F6"
                    accentColor="#3B82F6"
                    onClick={() => navigate('/md/employees')}
                />
                <KPICard
                    label="Monthly Plans Submitted"
                    value={`${mpCount} / ${empTotal}`}
                    sub={`${empTotal - mpCount} not yet submitted`}
                    icon={<FiFileText />}
                    iconColor="#8B5CF6"
                    accentColor="#8B5CF6"
                    progress={mpPct}
                    badge={`${mpPct}% rate`}
                    badgeVariant={getRatioColorClass(mpPct)}
                    onClick={() => navigate('/md/monthly-overview')}
                />
                <KPICard
                    label="Yearly Plans Approved"
                    value={`${ypApproved} / ${ypCount}`}
                    sub={ypPending > 0 ? `${ypPending} pending review` : 'All plans resolved'}
                    icon={<FiTarget />}
                    iconColor="#10B981"
                    accentColor="#10B981"
                    progress={ypPct}
                    badge={`${ypPct}% approved`}
                    badgeVariant={getRatioColorClass(ypPct)}
                    onClick={() => navigate('/md/approvals')}
                />
                <KPICard
                    label="RA Evaluations This Month"
                    value={evaluationsThisMonth}
                    sub={`of ${mpCount} submitted plans`}
                    icon={<FiCheckCircle />}
                    iconColor="#F59E0B"
                    accentColor="#F59E0B"
                    progress={evalPct}
                    badge={`${evalPct}% evaluated`}
                    badgeVariant={getRatioColorClass(evalPct)}
                />
            </div>

            {/* ── Section: Performance Analytics ── */}
            <div className="md-section-header">
                <span className="md-section-title"><FiActivity size={15} /> Performance Analytics</span>
                <span className="md-section-badge">Last 6 months</span>
            </div>

            <ChartCard
                icon={<FiActivity size={14} />}
                title="Organisation Performance Trend"
                subtitle="Monthly plans submitted, achievements uploaded, and evaluations completed"
                badge="6-month view"
            >
                <div className="md-chart-body">
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={trendData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }} barGap={2} barCategoryGap="22%">
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} axisLine={false} tickLine={false} />
                            <RechartsTooltip {...TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconType="circle" iconSize={8} />
                            <Bar dataKey="Plans" fill="#3B82F6" radius={[3, 3, 0, 0]} maxBarSize={36} />
                            <Bar dataKey="Achievements" fill="#22C55E" radius={[3, 3, 0, 0]} maxBarSize={36} />
                            <Bar dataKey="Evaluations" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={36} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>

            {/* ── Section: RA & Workforce Data ── */}
            <div className="md-section-header">
                <span className="md-section-title"><FiBarChart2 size={15} /> RA Team Performance</span>
                <span className="md-section-badge">{totalRAs} reporting {totalRAs === 1 ? 'authority' : 'authorities'}</span>
            </div>

            <div className="md-charts-row">

                {/* RA Performance Table */}
                <ChartCard
                    icon={<FiBarChart2 size={14} />}
                    title="RA Performance Comparison"
                    subtitle="Submission, achievement and evaluation rates per RA"
                    className="md-chart-card--ra"
                >
                    {raLeaderboard.length === 0 ? (
                        <p className="md-empty-state">No RA data available</p>
                    ) : (
                        <div className="md-ra-table">
                            <div className="md-ra-table-header">
                                <span>RA</span>
                                <span>Team</span>
                                <span>Submission</span>
                                <span>Achievement</span>
                                <span>Evals Done</span>
                            </div>
                            <div className="md-ra-rows">
                                {raLeaderboard.map((ra, idx) => (
                                    <div key={`${ra.name}-${idx}`} className="md-ra-row">
                                        {/* Name + avatar */}
                                        <div className="md-ra-name-cell">
                                            <div className="md-ra-avatar">{getInitials(ra.name)}</div>
                                            <span className="md-ra-name">{ra.name}</span>
                                        </div>
                                        {/* Team size */}
                                        <div className="md-ra-cell">
                                            <span className="md-ra-num">{ra.teamSize}</span>
                                        </div>
                                        {/* Submission rate with mini bar */}
                                        <div className="md-ra-cell md-ra-cell--bar">
                                            <span className="md-ra-pct" style={{ color: progressBarColor(ra.subPct) }}>{ra.subPct}%</span>
                                            <MiniBar value={ra.subPct} color={progressBarColor(ra.subPct)} />
                                        </div>
                                        {/* Achievement rate with mini bar */}
                                        <div className="md-ra-cell md-ra-cell--bar">
                                            <span className="md-ra-pct" style={{ color: progressBarColor(ra.achPct) }}>{ra.achPct}%</span>
                                            <MiniBar value={ra.achPct} color={progressBarColor(ra.achPct)} />
                                        </div>
                                        {/* Evaluations done */}
                                        <div className="md-ra-cell">
                                            <span className="md-ra-num" style={{ color: ra.evaluated > 0 ? '#10B981' : '#94A3B8' }}>
                                                {ra.evaluated}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* Summary row */}
                            {raLeaderboard.length > 0 && (
                                <div className="md-ra-summary-row">
                                    <span>Total</span>
                                    <span>{raLeaderboard.reduce((s, r) => s + r.teamSize, 0)}</span>
                                    <span style={{ color: progressBarColor(Math.round(raLeaderboard.reduce((s, r) => s + r.subPct, 0) / raLeaderboard.length)) }}>
                                        {Math.round(raLeaderboard.reduce((s, r) => s + r.subPct, 0) / raLeaderboard.length)}% avg
                                    </span>
                                    <span style={{ color: progressBarColor(Math.round(raLeaderboard.reduce((s, r) => s + r.achPct, 0) / raLeaderboard.length)) }}>
                                        {Math.round(raLeaderboard.reduce((s, r) => s + r.achPct, 0) / raLeaderboard.length)}% avg
                                    </span>
                                    <span style={{ color: '#10B981' }}>{raLeaderboard.reduce((s, r) => s + r.evaluated, 0)}</span>
                                </div>
                            )}
                        </div>
                    )}
                </ChartCard>

                {/* Yearly Plans Donut */}
                <ChartCard
                    icon={<FiPieChart size={14} />}
                    title="Yearly Plans"
                    subtitle="Approval breakdown"
                    badge={`${empTotal} total`}
                >
                    <div style={{ position: 'relative' }}>
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={[
                                        { name: 'Approved', value: ypApproved },
                                        { name: 'Under Review', value: ypPending },
                                        { name: 'Not Started', value: Math.max(0, empTotal - ypCount) }
                                    ]}
                                    cx="50%" cy="50%" innerRadius={62} outerRadius={85} paddingAngle={2} dataKey="value"
                                >
                                    <Cell fill="#10B981" />
                                    <Cell fill="#F59E0B" />
                                    <Cell fill="#E2E8F0" />
                                </Pie>
                                <RechartsTooltip {...TOOLTIP_STYLE} formatter={(v, n) => [`${v} employees`, n]} />
                                <Legend verticalAlign="bottom" height={32} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px' }} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="md-donut-center">
                            <div className="md-donut-num">{ypApproved}</div>
                            <div className="md-donut-txt">approved</div>
                        </div>
                    </div>
                </ChartCard>

                {/* Workforce Distribution */}
                <ChartCard
                    icon={<FiPieChart size={14} />}
                    title="Workforce"
                    subtitle="Distribution by department"
                    badge={`${empTotal} total`}
                >
                    {deptStats.length > 0 ? (
                        <>
                            <div style={{ position: 'relative' }}>
                                <ResponsiveContainer width="100%" height={170}>
                                    <PieChart>
                                        <Pie data={deptStats} dataKey="count" nameKey="department" cx="50%" cy="50%" innerRadius={52} outerRadius={75} paddingAngle={3} labelLine={false}>
                                            {deptStats.map((_, i) => <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />)}
                                        </Pie>
                                        <RechartsTooltip {...TOOLTIP_STYLE} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="md-donut-center">
                                    <div className="md-donut-num">{empTotal}</div>
                                    <div className="md-donut-txt">total</div>
                                </div>
                            </div>
                            <div className="md-dept-legend">
                                {deptStats.map((d, i) => (
                                    <div key={d.department} className="md-dept-row">
                                        <span className="md-dept-dot" style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                                        <span className="md-dept-name">{d.department}</span>
                                        <span className="md-dept-count">{d.count}</span>
                                        <span className="md-dept-pct">{Math.round((d.count / empTotal) * 100)}%</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <p className="md-empty-state">No department data</p>}
                </ChartCard>
            </div>

            {/* ── Section: Quick Access ── */}
            <div className="md-section-header">
                <span className="md-section-title"><FiChevronRight size={15} /> Quick Access</span>
                <span className="md-section-badge">4 modules</span>
            </div>

            <div className="md-shortcut-bar">
                {[
                    { icon: <FiUsersIcon />, color: '#3B82F6', bg: '#EFF6FF', title: 'Employee Overview', desc: 'Search and manage the entire employee base', route: '/md/employees' },
                    { icon: <FiClock />, color: '#F97316', bg: 'rgba(249,115,22,0.1)', title: 'Monthly Overview', desc: 'Track monthly plan and progress submissions', route: '/md/monthly-overview' },
                    { icon: <FiTarget />, color: '#10B981', bg: '#ECFDF5', title: 'Yearly Plans & Appraisals', desc: 'Review and act on employee yearly plans', route: '/md/approvals', badge: pendingYearlyCount || null },
                    { icon: <FiAward />, color: '#8B5CF6', bg: '#F5F3FF', title: 'Audit Trail', desc: 'Complete activity and approval history', route: '/md/audit' }
                ].map((item) => (
                    <div key={item.route} className="md-shortcut" onClick={() => navigate(item.route)}>
                        <div className="md-shortcut-icon" style={{ background: item.bg, color: item.color }}>{item.icon}</div>
                        <div className="md-shortcut-body">
                            <h4>{item.title}</h4>
                            <p>{item.desc}</p>
                        </div>
                        {item.badge > 0 && <span className="md-shortcut-badge">{item.badge}</span>}
                        <FiChevronRight className="md-shortcut-arrow" />
                    </div>
                ))}
            </div>

        </div>
    );
};

/* ========================================================
   EMPLOYEE DETAIL VIEW
======================================================== */
function EmployeeDetailView({ employee, data, tab, setTab, onBack }) {
    if (!employee) return null;
    const monthlyEvals = data.monthlyEvaluations || [];
    const quarterlyEvals = data.quarterlyEvaluations || [];
    const monthlyPlans = data.monthlyPlans || [];
    const yearlyPlans = data.yearlyPlans || [];

    return (
        <div className="fade-in">
            <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: '16px' }}>
                <FiArrowLeft /> Back to Dashboard
            </button>
            <div className="md-emp-detail-panel">
                <div className="md-emp-detail-header">
                    <div className="md-emp-avatar-lg">{getInitials(employee.name)}</div>
                    <div className="md-emp-info">
                        <h3>{employee.name}</h3>
                        <p>{employee.employeeCode} • {employee.department || 'N/A'} • {employee.role}</p>
                    </div>
                </div>
                <div className="md-emp-detail-body">
                    <div className="md-emp-tabs">
                        {['overview', 'monthly', 'quarterly', 'yearly'].map(t => (
                            <button key={t} className={`md-emp-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                            </button>
                        ))}
                    </div>
                    {tab === 'overview' && (
                        <div className="md-chart-wrap">
                            <div className="md-chart-title">Monthly Evaluation Trend</div>
                            {monthlyEvals.length === 0 ? <p className="md-empty-state">No evaluations yet</p> : (
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={[...monthlyEvals].reverse()} margin={{ top: 16, right: 16, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                        <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: '10px', fontSize: '12px', padding: '8px 12px' }} wrapperStyle={{ zIndex: 9999 }} />
                                        <Line type="monotone" dataKey="score" name="Score" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 3.5 }} activeDot={{ r: 5 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    )}
                    {tab === 'monthly' && (
                        <div className="md-plan-list">
                            {monthlyPlans.length === 0 ? <p className="md-empty-state">No monthly plans</p> : monthlyPlans.map(plan => (
                                <div key={plan.id} className="md-plan-item">
                                    <div className="md-plan-month">{plan.month}</div>
                                    <div className="md-plan-text">{plan.planDetails}</div>
                                    <span className={`md-plan-badge ${plan.status?.toLowerCase()}`}>{plan.status}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {tab === 'quarterly' && (
                        <>
                            {quarterlyEvals.length === 0 ? <p className="md-empty-state">No quarterly evaluations</p> : quarterlyEvals.map(qe => (
                                <div key={qe.id} className="md-eval-row">
                                    <div className="md-eval-month">{qe.quarter}</div>
                                    <div className="md-eval-score">{qe.averageScore?.toFixed(1)}/10</div>
                                </div>
                            ))}
                        </>
                    )}
                    {tab === 'yearly' && (
                        <>
                            {yearlyPlans.length === 0 ? <p className="md-empty-state">No yearly plans</p> : yearlyPlans.map(plan => (
                                <div key={plan.id} className="yp-plan-card" style={{ marginBottom: '10px' }}>
                                    <div className="yp-plan-year"><FiCalendar /> FY {plan.financialYear}</div>
                                    <span className={`yp-status ${plan.status.toLowerCase()}`}>{plan.status}</span>
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
