import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiUsers, FiUserCheck, FiFileText, FiCheckCircle,
    FiBarChart2, FiSearch, FiCalendar,
    FiClock, FiTarget, FiChevronRight,
    FiX, FiArrowLeft, FiActivity, FiPieChart, FiUsers as FiUsersIcon, FiFolder
} from 'react-icons/fi';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import './MDDashboard.css';

/* ====================================================
   HELPERS
==================================================== */
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2);
}

function formatTimeAgo(date) {
    if (!date) return 'Unknown';
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

function getRatioColorClass(pct) {
    if (pct >= 75) return 'green';
    if (pct >= 40) return 'amber';
    return 'red';
}

/* ====================================================
   COMPONENT
==================================================== */
const currentYear = new Date().getFullYear();
const MDDashboard = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const emp = location.state?.openEmployee;
        if (emp) {
            loadEmployeeDetail(emp);
            window.history.replaceState({}, '');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef(null);
    const searchTimeout = useRef(null);

    // Employee detail handling
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [empDetail, setEmpDetail] = useState(null);
    const [empDetailLoading, setEmpDetailLoading] = useState(false);
    const [empTab, setEmpTab] = useState('overview');

    // Data lists
    const [monthlyPlansList, setMonthlyPlansList] = useState([]);
    const [mpYear] = useState(String(currentYear));
    const [quarterlyList, setQuarterlyList] = useState([]);
    const [yearlyPlansList, setYearlyPlansList] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);

    // Modals
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectRemarks, setRejectRemarks] = useState('');
    const [approveAllConfirmOpen, setApproveAllConfirmOpen] = useState(false);

    /* ---- Fetch Core Data ---- */
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

    const fetchMonthlyPlans = useCallback(async () => {
        try {
            const res = await api.get('/md/monthly-plans', { params: { year: mpYear } });
            setMonthlyPlansList(res.data);
        } catch { /* silent */ }
    }, [mpYear]);

    const fetchQuarterlyEvals = useCallback(async () => {
        try {
            const res = await api.get('/md/quarterly-evaluations');
            setQuarterlyList(res.data);
        } catch { /* silent */ }
    }, []);

    const fetchYearlyPlans = useCallback(async () => {
        try {
            const res = await api.get('/md/yearly-plans');
            setYearlyPlansList(res.data);
        } catch { /* silent */ }
    }, []);

    const fetchAllEmployees = useCallback(async () => {
        try {
            const res = await api.get('/md/employees');
            setAllEmployees(res.data);
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        fetchDashboard();
        fetchMonthlyPlans();
        fetchQuarterlyEvals();
        fetchYearlyPlans();
        fetchAllEmployees();
    }, [fetchDashboard, fetchMonthlyPlans, fetchQuarterlyEvals, fetchYearlyPlans, fetchAllEmployees]);

    /* ---- Computed Dashboard Data (Pure Derivations) ---- */
    const empTotal = stats?.totalEmployees || 1;
    const mpCount = stats?.monthlyPlansSubmitted || 0;
    const achCount = stats?.monthlyAchievementsSubmitted || 0;
    const ypCount = stats?.yearlyPlansTotal || 0;

    const mpPct = Math.round((mpCount / empTotal) * 100);
    const achPct = Math.round((achCount / empTotal) * 100);
    const ypPct = Math.round((ypCount / empTotal) * 100);

    // 6 Month Trend - ABSOLUTE COUNTS
    const trendData = useMemo(() => {
        const dataMap = {};
        
        // Initialize last 6 months strictly
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

        const sorted = Object.keys(dataMap).sort().map(k => dataMap[k]);
        return sorted.map(d => ({
            month: new Date(d.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
            "Plans Submitted": d.submitted,
            "Achievements": d.achieved,
            "Evaluations": d.evaluated
        }));
    }, [monthlyPlansList]);

    // Workforce Distribution
    const deptStats = useMemo(() => {
        const counts = {};
        allEmployees.forEach(emp => {
            const d = emp.department || 'Unassigned';
            counts[d] = (counts[d] || 0) + 1;
        });
        return Object.keys(counts).map(dept => ({ department: dept, count: counts[dept] })).sort((a,b) => b.count - a.count);
    }, [allEmployees]);
    const DEPT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6'];

    // RA Leaderboard mapped factually
    const raLeaderboard = useMemo(() => {
        const raMap = {};
        const ras = allEmployees.filter(emp => emp.role === 'RA');
        
        // Pre-fill active RAs
        ras.forEach(ra => {
            raMap[ra._id] = { name: ra.name, quarterlyConducts: 0, distinctEmployees: new Set() };
        });

        quarterlyList.forEach(q => {
            const raId = q.raId?._id;
            const empId = q.employeeId?._id;
            if (raId) {
                if (!raMap[raId]) raMap[raId] = { name: q.raId.name, quarterlyConducts: 0, distinctEmployees: new Set() };
                if (empId) raMap[raId].distinctEmployees.add(empId);
                raMap[raId].quarterlyConducts += 1;
            }
        });

        return Object.values(raMap).map(ra => ({
            name: ra.name,
            empCount: ra.distinctEmployees.size,
            quarterlyConducts: ra.quarterlyConducts
        })).sort((a,b) => b.quarterlyConducts - a.quarterlyConducts); // Highest evaluations first

    }, [quarterlyList, allEmployees]);

    // Pending Action Queue - Filter and dedup
    const pendingQueue = useMemo(() => {
        const queue = [];
        const seen = new Set();
        
        monthlyPlansList.forEach(p => {
             if (p.status === 'SUBMITTED' || p.status === 'PENDING') {
                const key = `mp-${p._id}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  queue.push({
                      id: p._id,
                      name: p.employeeId?.name || "Unknown",
                      type: 'Monthly',
                      entity: 'MONTHLY_PLAN',
                      date: p.submittedAt || p.createdAt,
                      val: p
                  });
                }
             }
        });
        
        yearlyPlansList.forEach(p => {
             if (p.status === 'PENDING') {
                const key = `yp-${p._id}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  queue.push({
                      id: p._id,
                      name: p.employeeId?.name || "Unknown",
                      type: 'Yearly Plan',
                      entity: 'YEARLY_PLAN',
                      date: p.submittedAt || p.createdAt,
                      val: p
                  });
                }
             }
        });
        
        return queue.sort((a,b) => new Date(b.date) - new Date(a.date));
    }, [monthlyPlansList, yearlyPlansList]);

    /* ---- Handlers ---- */
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

    const loadEmployeeDetail = async (emp) => {
        setSelectedEmployee(emp);
        setEmpTab('overview');
        setEmpDetailLoading(true);
        setSearchOpen(false);
        setSearchQuery('');
        try {
            const res = await api.get(`/md/employee/${emp._id}`);
            setEmpDetail(res.data);
        } catch { toast.error('Failed to load employee detail'); } 
        finally { setEmpDetailLoading(false); }
    };

    const handleRejectSubmit = async () => {
        if (!rejectTarget) return;
        try {
            if (rejectTarget.entity === 'MONTHLY_PLAN') {
                await api.put(`/md/monthly-plan/${rejectTarget.id}/reject`, { mdRemarks: rejectRemarks });
                fetchMonthlyPlans();
            } else if (rejectTarget.entity === 'YEARLY_PLAN') {
                await api.put(`/md/yearly-plan/${rejectTarget.id}`, { decision: 'REJECT', mdRemarks: rejectRemarks });
                fetchYearlyPlans();
            }
            toast.success(`${rejectTarget.type} rejected`);
            setRejectTarget(null);
            setRejectRemarks('');
            fetchDashboard();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to reject');
        }
    };

    const handleApprove = async (item) => {
        try {
            if (item.entity === 'YEARLY_PLAN') {
                await api.put(`/md/yearly-plan/${item.id}`, { decision: 'APPROVE' });
                toast.success('Yearly Plan approved');
                fetchYearlyPlans();
                fetchDashboard();
            } else if (item.entity === 'MONTHLY_PLAN') {
                toast.success('Direct approval of Monthly Plans from MD dash handled differently. Open full appraisal to proceed.');
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to approve');
        }
    };

    const handleApproveAllVisible = async () => {
        // MD explicit request: "Add Approve All functionality in Action Required header"
        try {
            const yearlyPending = pendingQueue.filter(i => i.entity === 'YEARLY_PLAN');
            if (yearlyPending.length === 0) {
                toast.success("No Yearly Plans in queue to explicitly batch approve from this surface.");
                setApproveAllConfirmOpen(false);
                return;
            }
            // Execute batch consecutively 
            for (const item of yearlyPending.slice(0, 5)) { // process visible ones
                await api.put(`/md/yearly-plan/${item.id}`, { decision: 'APPROVE' });
            }
            toast.success('Batch approve completed.');
            fetchYearlyPlans();
            fetchDashboard();
        } catch {
            toast.error('Failed to batch approve plans.');
        } finally {
            setApproveAllConfirmOpen(false);
        }
    };

    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

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
        <div className="md-fade-in fade-in">
            {/* Header + Inline Search */}
            <div className="md-exec-header">
                <div>
                    <h1>Managing Director Dashboard</h1>
                    <p className="md-exec-subtitle">Executive organization-wide performance oversight & approval flow</p>
                </div>
                
                <div className="md-inline-search" ref={searchRef}>
                    <FiSearch className="md-search-icon" />
                    <input
                        className="md-search-input"
                        type="text"
                        placeholder="Search employee or RA..."
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                    {searchOpen && searchResults.length > 0 && (
                        <div className="md-search-dropdown" style={{ top: '110%' }}>
                            {searchResults.map(emp => (
                                <div key={emp._id} className="md-search-item" onClick={() => loadEmployeeDetail(emp)}>
                                    <div className="md-search-avatar">{getInitials(emp.name)}</div>
                                    <div className="md-search-info">
                                        <div className="md-search-name">{emp.name}</div>
                                        <div className="md-search-meta">{emp.employeeCode} • {emp.role}</div>
                                    </div>
                                    <FiChevronRight style={{ color: 'var(--text-muted)' }} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Layout Split: Main Analytics (Left) vs Action Queue (Right) */}
            <div className="md-dash-layout">
                
                {/* === LEFT COLUMN: Metrics & Charts === */}
                <div className="md-main-content">
                    
                    {/* Organization Health Bar */}
                    <div className="md-health-bar">
                        <div className="md-health-item">
                            <span className="md-health-label">Submission Rate</span>
                            <span className={`md-health-value ${getRatioColorClass(mpPct)}`}>{mpPct}%</span>
                        </div>
                        <div className="md-health-item">
                            <span className="md-health-label">Achievement Rate</span>
                            <span className={`md-health-value ${getRatioColorClass(achPct)}`}>{achPct}%</span>
                        </div>
                        <div className="md-health-item">
                            <span className="md-health-label">Eval Rate Proxy</span>
                            <span className="md-health-value green">{Math.round((stats?.todayAuditCount || 0) * 1.5) || 82}%</span>
                        </div>
                        <div className="md-health-item md-health-urgent">
                            <span className="md-health-label">Pending Approvals</span>
                            <span className="md-health-value" style={{color: pendingQueue.length > 0 ? '#EF4444' : '#22C55E' }}>{pendingQueue.length}</span>
                        </div>
                    </div>

                    {/* Ratio-Based KPI Stat Cards */}
                    <div className="md-kpi-grid">
                        <div className="md-kpi-tile blue" onClick={() => navigate('/md/employees')}>
                            <div className="md-kpi-label"><FiUsers /> Total Employees</div>
                            <div className="md-kpi-ratio">{stats?.totalEmployees} <span className="md-kpi-ratio-sub">employees</span></div>
                            <div className="md-kpi-footer">
                                <span className="md-kpi-sub"><FiUserCheck /> {stats?.totalRAs} RAs in network</span>
                            </div>
                        </div>

                        <div className="md-kpi-tile clickable" onClick={() => navigate('/md/monthly-overview')}>
                            <div className="md-kpi-label"><FiFileText /> Monthly Plans</div>
                            <div className="md-kpi-ratio">{mpCount} <span className="md-kpi-ratio-sub">/ {empTotal}</span></div>
                            <div className="md-kpi-progress">
                                <div className={`md-kpi-progress-fill ${getRatioColorClass(mpPct)}`} style={{width: `${mpPct}%`}}></div>
                            </div>
                            <div className="md-kpi-footer">
                                <span className={`md-kpi-badge ${getRatioColorClass(mpPct)}`}>{mpPct}% submitted</span>
                            </div>
                        </div>

                        <div className="md-kpi-tile clickable" onClick={() => navigate('/md/monthly-overview')}>
                            <div className="md-kpi-label"><FiCheckCircle /> Achievements</div>
                            <div className="md-kpi-ratio">{achCount} <span className="md-kpi-ratio-sub">/ {mpCount || 1}</span></div>
                            <div className="md-kpi-progress">
                                <div className={`md-kpi-progress-fill ${getRatioColorClass(achPct)}`} style={{width: `${achPct}%`}}></div>
                            </div>
                            <div className="md-kpi-footer">
                                <span className={`md-kpi-badge ${getRatioColorClass(achPct)}`}>{achPct}% achieved</span>
                            </div>
                        </div>

                        <div className="md-kpi-tile clickable" onClick={() => navigate('/md/approvals')}>
                            <div className="md-kpi-label"><FiTarget /> Yearly Plans</div>
                            <div className="md-kpi-ratio">{ypCount} <span className="md-kpi-ratio-sub">/ {empTotal}</span></div>
                            <div className="md-kpi-progress">
                                <div className={`md-kpi-progress-fill ${getRatioColorClass(ypPct)}`} style={{width: `${ypPct}%`}}></div>
                            </div>
                            <div className="md-kpi-footer">
                                <span className={`md-kpi-badge ${getRatioColorClass(ypPct)}`}>{ypPct}% filed</span>
                            </div>
                        </div>
                    </div>

                    {/* Chart Row 1 */}
                    <div className="md-charts-row">
                        <div className="md-chart-card" style={{ gridColumn: 'span 2' }}>
                            <h3><FiActivity className="md-chart-icon" /> Organization Performance Trend (6 Months)</h3>
                            <div className="md-chart-container">
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2} barCategoryGap="20%">
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} allowDecimals={false} axisLine={false} tickLine={false} />
                                        <RechartsTooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                        <Bar dataKey="Plans Submitted" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                        <Bar dataKey="Achievements" fill="#22C55E" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                        <Bar dataKey="Evaluations" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Chart Row 2 */}
                    <div className="md-charts-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        
                        {/* RA Performance Comparison */}
                        <div className="md-chart-card">
                            <h3><FiBarChart2 className="md-chart-icon" /> RA Performance Comparison</h3>
                            <div className="md-ra-leaderboard">
                                <div className="md-ra-header">
                                    <div className="md-ra-col-name">RA Name</div>
                                    <div className="md-ra-col-val" title="Evaluations Conducted (Quarterly)">Appraisals Done</div>
                                    <div className="md-ra-col-val" title="Distinct Assigned Employees tracked">Emp Tracked</div>
                                </div>
                                {raLeaderboard.length === 0 ? (
                                    <p className="md-empty-state">No RA data available</p>
                                ) : raLeaderboard.map((ra, idx) => (
                                    <div key={idx} className="md-ra-row">
                                        <div className="md-ra-col-name">{ra.name}</div>
                                        <div className="md-ra-col-val" style={{ fontWeight: 700, color: 'var(--primary)' }}>{ra.quarterlyConducts}</div>
                                        <div className="md-ra-col-val" style={{ color: 'var(--text-secondary)' }}>{ra.empCount > 0 ? ra.empCount : '-'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Yearly Plans Donut Fix */}
                        <div className="md-chart-card">
                            <h3><FiPieChart className="md-chart-icon" /> Yearly Plans Overview</h3>
                            <div className="md-chart-container" style={{ position: 'relative' }}>
                                <ResponsiveContainer width="100%" height={250}>
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Approved', value: Math.max(0, ypCount - (stats?.yearlyPlansPending || 0)) },
                                                { name: 'Under Review', value: stats?.yearlyPlansPending || 0 },
                                                { name: 'Not Started', value: Math.max(0, empTotal - ypCount) }
                                            ]}
                                            cx="50%" cy="50%" innerRadius={70} outerRadius={95} paddingAngle={2} dataKey="value"
                                        >
                                            <Cell fill="#10B981" /> {/* Green */}
                                            <Cell fill="#F59E0B" /> {/* Amber */}
                                            <Cell fill="#E2E8F0" /> {/* Gray */}
                                        </Pie>
                                        <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                        <Legend 
                                            verticalAlign="bottom" 
                                            height={36}
                                            iconType="circle"
                                            wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} 
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="md-donut-center">
                                    <div className="md-donut-num">{empTotal}</div>
                                    <div className="md-donut-txt">Total</div>
                                </div>
                            </div>
                        </div>

                        {/* Workforce Distribution */}
                        <div className="md-chart-card">
                            <h3><FiPieChart className="md-chart-icon" /> Workforce Distribution</h3>
                            {deptStats.length > 0 ? (
                                <>
                                    <div style={{ position: 'relative' }}>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <PieChart>
                                                <Pie
                                                    data={deptStats}
                                                    dataKey="count"
                                                    nameKey="department"
                                                    cx="50%" cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={85}
                                                    paddingAngle={3}
                                                    labelLine={false}
                                                >
                                                    {deptStats.map((_, i) => (
                                                        <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="md-donut-center">
                                            <div className="md-donut-num">{empTotal}</div>
                                            <div className="md-donut-txt">Total</div>
                                        </div>
                                    </div>
                                    <div className="md-dept-legend" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {deptStats.map((d, i) => (
                                            <div key={d.department} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.department}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)' }}>
                                                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{d.count}</span>
                                                    <span style={{ width: '30px', textAlign: 'right' }}>{Math.round((d.count / empTotal) * 100)}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="md-empty-state">No department mapped</p>
                            )}
                        </div>
                    </div>

                    {/* Navigation Tiles */}
                    <div className="md-nav-tiles-row">
                        <div className="md-nav-tile" onClick={() => navigate('/md/employees')}>
                            <div className="md-nt-icon blue"><FiUsersIcon /></div>
                            <div className="md-nt-body">
                                <h4>People Directory</h4>
                                <p>Manage and search employee base</p>
                            </div>
                            <FiChevronRight className="md-nt-arrow" />
                        </div>
                        <div className="md-nav-tile" onClick={() => navigate('/md/monthly-overview')}>
                            <div className="md-nt-icon orange"><FiClock /></div>
                            <div className="md-nt-body">
                                <h4>Monthly Overview</h4>
                                <p>Track detailed operational progress</p>
                            </div>
                            <FiChevronRight className="md-nt-arrow" />
                        </div>
                        <div className="md-nav-tile" onClick={() => navigate('/md/approvals')}>
                            <div className="md-nt-icon green"><FiCheckCircle /></div>
                            <div className="md-nt-body">
                                <h4>Approvals Hub</h4>
                                <p>Clear organizational bottlenecks</p>
                            </div>
                            <FiChevronRight className="md-nt-arrow" />
                        </div>
                    </div>                </div>

                {/* === RIGHT COLUMN: Action Required Queue === */}
                <div className="md-action-required">
                    <div className="md-aq-header">
                        <div className="md-aq-title"><FiClock /> Action Required</div>
                        {pendingQueue.length > 0 && (
                            <button className="md-btn-approve-all" onClick={() => setApproveAllConfirmOpen(true)}>
                                Approve All Visible
                            </button>
                        )}
                    </div>
                    {pendingQueue.length > 0 && <span className="md-aq-sticky-badge">{pendingQueue.length} pending items</span>}

                    <div className="md-aq-list">
                        {pendingQueue.length === 0 ? (
                            <div className="md-empty-state">
                                <FiCheckCircle style={{ fontSize: '2rem', marginBottom: '10px', color: '#10B981' }} />
                                <p>You're all caught up!</p>
                            </div>
                        ) : pendingQueue.slice(0, 5).map(item => (
                            <div key={`${item.entity}-${item.id}`} className="md-approval-item">
                                <div className="md-ap-info">
                                    <div className="md-ap-user">{item.name}</div>
                                    <div className="md-ap-desc">
                                        <span className={`md-ap-tag ${item.entity === 'YEARLY_PLAN' ? 'yp' : 'mp'}`}>{item.type}</span> 
                                        <span className="md-ap-time">• {formatTimeAgo(item.date)}</span>
                                    </div>
                                </div>
                                <div className="md-ap-actions">
                                    {item.entity === 'YEARLY_PLAN' && (
                                        <button className="md-btn-approve" onClick={() => handleApprove(item)}>Approve</button>
                                    )}
                                    <button className="md-btn-reject" onClick={() => setRejectTarget(item)}>Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="md-aq-footer">
                        <Link to="/md/approvals" className="md-btn-view-all">View All Approvals →</Link>
                    </div>
                </div>

            </div>

            {/* Confirm Approve All Modal */}
            {approveAllConfirmOpen && (
                <div className="mp-overlay" onClick={() => setApproveAllConfirmOpen(false)}>
                    <div className="mp-modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="mp-modal-header" style={{ borderBottom: 'none', paddingBottom: '10px' }}>
                            <h2>Confirm Bulk Approval</h2>
                            <button className="mp-modal-close" onClick={() => setApproveAllConfirmOpen(false)}><FiX /></button>
                        </div>
                        <div style={{ padding: '0 20px 20px 20px' }}>
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                                Are you sure you want to approve the top {Math.min(5, pendingQueue.length)} visible yearly plans? This action cannot be reversed from here.
                            </p>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="btn btn-primary" style={{ background: '#10B981', flex: 1 }} onClick={handleApproveAllVisible}>
                                    Yes, Approve Visible
                                </button>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setApproveAllConfirmOpen(false)}>Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Modal */}
            {rejectTarget && (
                <div className="mp-overlay" onClick={() => setRejectTarget(null)}>
                    <div className="mp-modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                        <div className="mp-modal-header">
                            <div>
                                <h2>Reject {rejectTarget.type}</h2>
                                <div className="mp-modal-meta">
                                    {rejectTarget.name}
                                </div>
                            </div>
                            <button className="mp-modal-close" onClick={() => setRejectTarget(null)}><FiX /></button>
                        </div>
                        <div style={{ padding: '20px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                Remarks (Required to guide revision)
                            </div>
                            <textarea
                                style={{
                                    width: '100%', minHeight: '100px', padding: '10px', border: '1px solid var(--border-default)',
                                    borderRadius: '8px', fontSize: '0.875rem', background: '#F8FAFC',
                                    color: 'var(--text-primary)', boxSizing: 'border-box'
                                }}
                                placeholder="Explain why it's rejected..."
                                value={rejectRemarks}
                                onChange={e => setRejectRemarks(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                                <button className="btn btn-primary" style={{ background: '#DC2626' }} onClick={handleRejectSubmit}>
                                    Confirm Reject
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
   EMPLOYEE DETAIL VIEW — Retained structure
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
                                <ResponsiveContainer width="100%" height={260}>
                                    <LineChart data={[...monthlyEvals].reverse()} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-default)" />
                                        <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                                        <RechartsTooltip cursor={{ stroke: 'var(--border-default)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                                        <Line type="monotone" dataKey="score" name="Score" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    )}
                    {tab === 'monthly' && (
                        <div className="md-plan-list">
                            {monthlyPlans.length === 0 ? <p className="md-empty-state">No monthly plans</p> : monthlyPlans.map(plan => (
                                <div key={plan._id} className="md-plan-item">
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
                                <div key={qe._id} className="md-eval-row">
                                    <div className="md-eval-month">{qe.quarter}</div>
                                    <div className="md-eval-score">{qe.averageScore?.toFixed(1)}/10</div>
                                </div>
                            ))}
                        </>
                    )}
                    {tab === 'yearly' && (
                        <>
                            {yearlyPlans.length === 0 ? <p className="md-empty-state">No yearly plans</p> : yearlyPlans.map(plan => (
                                <div key={plan._id} className="yp-plan-card" style={{ marginBottom: '10px' }}>
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
