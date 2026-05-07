import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiSearch, FiUsers, FiUser, FiBarChart2, FiFileText, FiTarget,
    FiCheckCircle, FiChevronRight, FiFilter, FiGrid, FiList,
    FiBriefcase, FiMail, FiCalendar, FiRefreshCw, FiUserCheck, FiX
} from 'react-icons/fi';
import '../md/MDEmployeeList.css';

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

const ROLE_COLORS = {
    EMPLOYEE: { bg: 'rgba(59,130,246,.1)', color: '#3B82F6', label: 'Employee' },
    RA: { bg: 'rgba(168,85,247,.1)', color: '#A855F7', label: 'Reporting Authority' },
    HRD: { bg: 'rgba(34,197,94,.1)', color: '#22C55E', label: 'HRD' },
};

const getDeptStyles = (dept) => {
    switch ((dept || '').toUpperCase()) {
        case 'IT': return { bg: '#e0f2fe', color: '#0369a1' };
        case 'CONTENT': return { bg: '#dcfce7', color: '#15803d' };
        case 'NETWORK': return { bg: '#f3e8ff', color: '#7c3aed' };
        default: return { bg: '#f1f5f9', color: '#475569' };
    }
};

const HRDEmployeeListPage = () => {
    const navigate = useNavigate();
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQ, setSearchQ] = useState('');
    const [roleFilter, setRoleFilter] = useState(''); // '' | 'EMPLOYEE' | 'RA'
    const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
    const [deptFilter, setDeptFilter] = useState('');

    const fetchEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/hrd/employees', {
                params: { q: searchQ || undefined, role: roleFilter || undefined, limit: 200 }
            });
            setEmployees(Array.isArray(res.data) ? res.data : []);
        } catch {
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    }, [searchQ, roleFilter]);

    useEffect(() => {
        document.title = "Org Directory";
        fetchEmployees();
    }, [fetchEmployees]);

    /* derived */
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();

    const filtered = employees.filter(e => {
        if (deptFilter && e.department !== deptFilter) return false;
        return true;
    });

    const stats = {
        total: employees.length,
        employees: employees.filter(e => e.role === 'EMPLOYEE').length,
        ras: employees.filter(e => e.role === 'RA').length,
    };

    const avgReports = stats.ras > 0 ? Math.round(stats.employees / stats.ras) : 0;

    const handleEmployeeClick = (emp) => {
        navigate(`/hrd/employee/${emp._id}`);
    };

    const roleLabel = roleFilter === 'EMPLOYEE' ? 'Employees Only' : roleFilter === 'RA' ? 'Reporting Authorities Only' : '';
    const showFilterRow = roleFilter || deptFilter;

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="mel-page-title">Org Directory</h1>
                    <p>Browse and manage your workforce — click any profile to view performance history and evaluations.</p>
                </div>
            </div>

            {/* Stats */}
            <div className="mel-stats-row">
                <div className="mel-stat">
                    <div className="mel-stat-icon"><FiUsers /></div>
                    <div className="mel-stat-content">
                        <div className="mel-stat-value">{stats.total}</div>
                        <div className="mel-stat-label">Active Members</div>
                    </div>
                </div>
                <div className="mel-stat">
                    <div className="mel-stat-icon"><FiUser /></div>
                    <div className="mel-stat-content">
                        <div className="mel-stat-value">{stats.employees}</div>
                        <div className="mel-stat-label">Employees</div>
                        <div className="mel-stat-sub">across {departments.length} departments</div>
                    </div>
                </div>
                <div className="mel-stat">
                    <div className="mel-stat-icon"><FiUserCheck /></div>
                    <div className="mel-stat-content">
                        <div className="mel-stat-value">{stats.ras}</div>
                        <div className="mel-stat-label">Reporting Authorities</div>
                        <div className="mel-stat-sub">avg {avgReports} direct reports each</div>
                    </div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="mel-filter-bar-container">
                <div className="mel-filter-bar">
                    <div className="mel-search-wrap">
                        <FiSearch className="mel-search-icon" />
                        <input
                            type="text"
                            className="mel-search-input"
                            placeholder="Search by name or employee code..."
                            value={searchQ}
                            onChange={e => setSearchQ(e.target.value)}
                        />
                    </div>

                    <div className="mel-filter-controls">
                        <div className="mel-filter-group">
                            <FiFilter />
                            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                                <option value="">All Roles</option>
                                <option value="EMPLOYEE">Employees Only</option>
                                <option value="RA">Reporting Authorities Only</option>
                            </select>
                        </div>

                        {departments.length > 0 && (
                            <div className="mel-filter-group">
                                <FiBriefcase />
                                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                                    <option value="">All Departments</option>
                                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                        )}

                        <div className="mel-view-toggle">
                            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid view"><FiGrid /></button>
                            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="List view"><FiList /></button>
                        </div>

                        <button className="mel-refresh-btn" onClick={fetchEmployees} title="Refresh"><FiRefreshCw /></button>
                    </div>
                </div>

                {showFilterRow && (
                    <div className="mel-active-filters">
                        {roleFilter && (
                            <div className="mel-filter-pill">
                                Role: {roleLabel}
                                <span className="mel-filter-pill-clear" onClick={() => setRoleFilter('')}><FiX /></span>
                            </div>
                        )}
                        {deptFilter && (
                            <div className="mel-filter-pill">
                                Department: {deptFilter}
                                <span className="mel-filter-pill-clear" onClick={() => setDeptFilter('')}><FiX /></span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="mel-result-meta">{loading ? 'Loading...' : `${filtered.length} people`}</div>

            {/* Content */}
            {loading ? (
                <div className="mel-loading"><div className="spinner" /><p>Loading directory...</p></div>
            ) : filtered.length === 0 ? (
                <div className="mel-empty">
                    <div className="mel-empty-icon"><FiUsers /></div>
                    <h3>No people found</h3>
                    <p>Try adjusting your search or filters</p>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="mel-grid">
                    {filtered.map(emp => {
                        const roleInfo = ROLE_COLORS[emp.role] || ROLE_COLORS.EMPLOYEE;
                        const deptStyle = getDeptStyles(emp.department);
                        const isRA = emp.role === 'RA';

                        return (
                            <div key={emp._id} className="mel-card" onClick={() => handleEmployeeClick(emp)}>
                                <div className="mel-card-top-row">
                                    <span className="mel-role-badge" style={{ background: roleInfo.bg, color: roleInfo.color }}>
                                        {roleInfo.label}
                                    </span>
                                </div>
                                <div
                                    className="mel-card-avatar"
                                    style={isRA ? { background: '#1e293b', color: '#ffffff' } : { background: '#f97316', color: '#ffffff' }}
                                >
                                    {getInitials(emp.name)}
                                </div>
                                <div className="mel-card-name">{emp.name}</div>
                                <div className="mel-card-code">{emp.employeeCode}</div>

                                {emp.department && (
                                    <div className="mel-card-dept-tag" style={{ background: deptStyle.bg, color: deptStyle.color }}>
                                        <FiBriefcase /> {emp.department}
                                    </div>
                                )}
                                <button className="mel-card-cta">
                                    View Profile <FiChevronRight />
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="mel-table-card">
                    <table className="mel-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Code</th>
                                <th>Role</th>
                                <th>Department</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((emp, i) => {
                                const roleInfo = ROLE_COLORS[emp.role] || ROLE_COLORS.EMPLOYEE;
                                const isRA = emp.role === 'RA';
                                return (
                                    <tr key={emp._id} className="mel-row" onClick={() => handleEmployeeClick(emp)}>
                                        <td className="mel-cell-num">{i + 1}</td>
                                        <td>
                                            <div className="mel-row-emp">
                                                <div
                                                    className="mel-row-avatar"
                                                    style={isRA ? { background: '#1e293b', color: '#ffffff' } : { background: '#f97316', color: '#ffffff' }}
                                                >
                                                    {getInitials(emp.name)}
                                                </div>
                                                <span>{emp.name}</span>
                                            </div>
                                        </td>
                                        <td className="mel-cell-code">{emp.employeeCode}</td>
                                        <td>
                                            <span className="mel-role-badge" style={{ background: roleInfo.bg, color: roleInfo.color }}>
                                                {roleInfo.label}
                                            </span>
                                        </td>
                                        <td>{emp.department || '—'}</td>
                                        <td><FiChevronRight style={{ color: 'var(--text-muted)' }} /></td>
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

export default HRDEmployeeListPage;

