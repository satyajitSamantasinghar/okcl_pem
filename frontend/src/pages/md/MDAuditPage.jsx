import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiShield, FiSend, FiEdit3, FiCheckCircle, FiXCircle,
    FiAward, FiBarChart2, FiArchive, FiArrowLeft, FiFilter
} from 'react-icons/fi';

/* ====================================================
   HELPERS
==================================================== */
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

/* ====================================================
   COMPONENT
==================================================== */
const MDAuditPage = () => {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);

    // Filters
    const [entityType, setEntityType] = useState('');
    const [action, setAction] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page, limit: 20 };
            if (entityType) params.entityType = entityType;
            if (action) params.action = action;
            if (dateFrom) params.from = dateFrom;
            if (dateTo) params.to = dateTo;
            const res = await api.get('/md/audit-logs', { params });
            setLogs(res.data.logs);
            setTotal(res.data.total);
            setTotalPages(res.data.totalPages);
        } catch {
            toast.error('Failed to load audit logs');
        } finally {
            setLoading(false);
        }
    }, [page, entityType, action, dateFrom, dateTo]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    return (
        <div className="fade-in">
            <Link to="/md" className="btn btn-secondary btn-sm" style={{ marginBottom: '16px', display: 'inline-flex' }}>
                <FiArrowLeft /> Back to Dashboard
            </Link>

            <div className="page-header">
                <h1>Audit Trail</h1>
                <p>Complete history of all actions performed across the organization ({total} records)</p>
            </div>

            {/* Filters */}
            <div className="filter-bar" style={{ flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
                <FiFilter />
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={{ padding: '8px 10px' }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>to</span>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} style={{ padding: '8px 10px' }} />
                <select value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1); }} style={{ padding: '8px 10px' }}>
                    <option value="">All Entity Types</option>
                    <option value="MONTHLY_PLAN">Monthly Plan</option>
                    <option value="MONTHLY_ACHIEVEMENT">Monthly Achievement</option>
                    <option value="MONTHLY_EVALUATION">Monthly Evaluation</option>
                    <option value="YEARLY_PLAN">Yearly Plan</option>
                    <option value="YEARLY_APPRAISAL_REPORT">Yearly Appraisal Report</option>
                    <option value="QUARTERLY_EVALUATION">Quarterly Evaluation</option>
                </select>
                <select value={action} onChange={e => { setAction(e.target.value); setPage(1); }} style={{ padding: '8px 10px' }}>
                    <option value="">All Actions</option>
                    <option value="SUBMIT">Submit</option>
                    <option value="EDIT">Edit</option>
                    <option value="APPROVE">Approve</option>
                    <option value="REJECT">Reject</option>
                    <option value="EVALUATE">Evaluate</option>
                    <option value="MD_EVALUATE">MD Evaluate</option>
                </select>
                {(entityType || action || dateFrom || dateTo) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                        setEntityType(''); setAction(''); setDateFrom(''); setDateTo(''); setPage(1);
                    }}>Clear Filters</button>
                )}
            </div>

            {/* Table */}
            {loading ? (
                <div className="loading-container"><div className="spinner" /><p>Loading...</p></div>
            ) : (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: '40px' }}></th>
                                <th>User</th>
                                <th>Action</th>
                                <th>Entity Type</th>
                                <th>Timestamp</th>
                                <th>IP Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 ? (
                                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No audit logs found</td></tr>
                            ) : logs.map(log => {
                                const ai = getAuditIcon(log.action);
                                return (
                                    <tr key={log._id}>
                                        <td>
                                            <div className={`md-audit-icon ${ai.cls}`} style={{ width: '28px', height: '28px', fontSize: '0.7rem' }}>
                                                {ai.icon}
                                            </div>
                                        </td>
                                        <td>
                                            <strong>{log.userId?.name || 'System'}</strong>
                                            <br />
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {log.userId?.employeeCode} • {log.userId?.role}
                                            </span>
                                        </td>
                                        <td>
                                            <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                                                {log.action?.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td>
                                            <span style={{ fontSize: '0.8125rem' }}>
                                                {log.entityType?.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td>
                                            {new Date(log.timestamp).toLocaleString('en-US', {
                                                day: 'numeric', month: 'short', year: 'numeric',
                                                hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{log.ipAddress || '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    ← Previous
                </button>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    Page {page} of {totalPages}
                </span>
                <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next →
                </button>
            </div>
        </div>
    );
};

export default MDAuditPage;
