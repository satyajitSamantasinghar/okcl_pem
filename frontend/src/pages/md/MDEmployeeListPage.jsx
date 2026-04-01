import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiSearch, FiUsers, FiUser, FiBarChart2, FiFileText, FiTarget,
    FiCheckCircle, FiChevronRight, FiFilter, FiGrid, FiList,
    FiBriefcase, FiMail, FiCalendar, FiRefreshCw, FiUserCheck
} from 'react-icons/fi';
import './MDEmployeeList.css';

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

const ROLE_COLORS = {
    EMPLOYEE: { bg: 'rgba(59,130,246,.1)', color: '#3B82F6', label: 'Employee' },
    RA: { bg: 'rgba(168,85,247,.1)', color: '#A855F7', label: 'Reporting Authority' },
    HRD: { bg: 'rgba(34,197,94,.1)', color: '#22C55E', label: 'HRD' },
};

const MDEmployeeListPage = () => {
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
            const res = await api.get('/md/employees', {
                params: { q: searchQ || undefined, role: roleFilter || undefined, limit: 200 }
            });
            setEmployees(Array.isArray(res.data) ? res.data : []);
        } catch {
            toast.error('Failed to load employees');
        } finally {
            setLoading(false);
        }
    }, [searchQ, roleFilter]);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    /* derived */
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();

    const filtered = employees.filter(e => {
        if (deptFilter && e.department !== deptFilter) return false;
        return true;
    });

    const stats = {
        total:     employees.length,
        employees: employees.filter(e => e.role === 'EMPLOYEE').length,
        ras:       employees.filter(e => e.role === 'RA').length,
    };

    const handleEmployeeClick = (emp) => {
        navigate(`/md/employee/${emp._id}`);
    };

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1>People Directory</h1>
                    <p>View all employees and reporting authorities — click any person to see their full performance profile</p>
                </div>
            </div>

            {/* Stats */}
            <div className="mel-stats-row">
                <div className="mel-stat">
                    <div className="mel-stat-icon blue"><FiUsers /></div>
                    <div>
                        <div className="mel-stat-value">{stats.total}</div>
                        <div className="mel-stat-label">Total People</div>
                    </div>
                </div>
                <div className="mel-stat">
                    <div className="mel-stat-icon green"><FiUser /></div>
                    <div>
                        <div className="mel-stat-value">{stats.employees}</div>
                        <div className="mel-stat-label">Employees</div>
                    </div>
                </div>
                <div className="mel-stat">
                    <div className="mel-stat-icon purple"><FiUserCheck /></div>
                    <div>
                        <div className="mel-stat-value">{stats.ras}</div>
                        <div className="mel-stat-label">Reporting Authorities</div>
                    </div>
                </div>
            </div>

            {/* Filter bar */}
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

            <div className="mel-result-meta">{loading ? 'Loading...' : `${filtered.length} people`}</div>

            {/* Content */}
            {loading ? (
                <div className="mel-loading"><div className="spinner" /><p>Loading people directory...</p></div>
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
                        return (
                            <div key={emp._id} className="mel-card" onClick={() => handleEmployeeClick(emp)}>
                                <div className="mel-card-avatar">{getInitials(emp.name)}</div>
                                <div className="mel-card-name">{emp.name}</div>
                                <div className="mel-card-code">{emp.employeeCode}</div>
                                <span className="mel-role-badge" style={{ background: roleInfo.bg, color: roleInfo.color }}>
                                    {roleInfo.label}
                                </span>
                                {emp.department && <div className="mel-card-dept"><FiBriefcase /> {emp.department}</div>}
                                <div className="mel-card-cta">View Profile <FiChevronRight /></div>
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
                                return (
                                    <tr key={emp._id} className="mel-row" onClick={() => handleEmployeeClick(emp)}>
                                        <td className="mel-cell-num">{i + 1}</td>
                                        <td>
                                            <div className="mel-row-emp">
                                                <div className="mel-row-avatar">{getInitials(emp.name)}</div>
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

export default MDEmployeeListPage;
