import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiFileText, FiTrendingUp, FiCheckCircle, FiX, FiCalendar,
    FiClock, FiSearch, FiFilter, FiChevronLeft, FiChevronRight,
    FiAlertCircle, FiMessageSquare, FiChevronDown, FiArrowUp, FiArrowDown,
    FiStar, FiXCircle, FiShield, FiEye
} from 'react-icons/fi';
import './MDMonthlyOverview.css';

/* ─── helpers ─────────────────────────────────────── */
const currentYear  = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i);
const MONTHS = [
    { v: '01', l: 'January' }, { v: '02', l: 'February' }, { v: '03', l: 'March' },
    { v: '04', l: 'April' },   { v: '05', l: 'May' },      { v: '06', l: 'June' },
    { v: '07', l: 'July' },    { v: '08', l: 'August' },   { v: '09', l: 'September' },
    { v: '10', l: 'October' }, { v: '11', l: 'November' }, { v: '12', l: 'December' },
];

function fmtMonth(m) {
    if (!m) return '—';
    const [y, mo] = m.split('-');
    return new Date(y, parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function scoreColor(s) {
    if (s == null) return 'var(--text-muted)';
    if (s >= 8) return '#22C55E';
    if (s >= 6) return '#F97316';
    if (s >= 4) return '#EAB308';
    return '#EF4444';
}

const PAGE_SIZE = 10;

/* ─── component ──────────────────────────────────── */
const MDMonthlyOverviewPage = () => {
    const [plans,   setPlans]   = useState([]);
    const [loading, setLoading] = useState(true);

    /* filters */
    const [filterYear,   setFilterYear]   = useState(String(currentYear));
    const [filterMonth,  setFilterMonth]  = useState(currentMonth);
    const [filterStatus, setFilterStatus] = useState('');
    const [searchQ,      setSearchQ]      = useState('');
    const [sortOrder,    setSortOrder]    = useState('latest');
    const [page,         setPage]         = useState(1);

    /* detail modal */
    const [selected, setSelected] = useState(null);

    /* reject modal */
    const [rejectTarget,  setRejectTarget]  = useState(null);
    const [rejectRemarks, setRejectRemarks] = useState('');
    const [rejecting,     setRejecting]     = useState(false);

    /* ── fetch ── */
    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            // Note: If filterMonth is empty, it will not pass the 'month' parameter
            // meaning the backend will return ALL plans.
            // But if filterMonth is set to eg '03', it passes '2026-03'.
            // Ensure filterMonth has a default value so it restricts to current month.
            const params = {
                year: filterYear,
                month: filterMonth ? `${filterYear}-${filterMonth}` : undefined,
                status: filterStatus || undefined,
                sort: sortOrder,
                page,
                limit: PAGE_SIZE,
                q: searchQ || undefined,
            };
            const res = await api.get('/md/monthly-plans', { params });
            const all = Array.isArray(res.data) ? res.data : [];
            setPlans(all);
        } catch {
            toast.error('Failed to load monthly plans');
        } finally {
            setLoading(false);
        }
    }, [filterYear, filterMonth, filterStatus, sortOrder, page, searchQ]);

    useEffect(() => { fetchPlans(); }, [fetchPlans]);
    useEffect(() => { setPage(1); }, [filterYear, filterMonth, filterStatus, sortOrder, searchQ]);

    /* ── derived: sort + search + paginate ── */
    const processed = (() => {
        let list = [...plans];

        if (searchQ.trim()) {
            const q = searchQ.toLowerCase();
            list = list.filter(p =>
                p.employeeId?.name?.toLowerCase().includes(q) ||
                p.employeeId?.employeeCode?.toLowerCase().includes(q)
            );
        }

        if (filterStatus) {
            list = list.filter(p => {
                if (filterStatus === 'EVALUATED') return p.evaluationStatus === 'EVALUATED';
                if (filterStatus === 'REJECTED')  return p.status === 'REJECTED';
                if (filterStatus === 'PENDING')   return p.evaluationStatus !== 'EVALUATED' && p.status !== 'REJECTED';
                return true;
            });
        }

        list.sort((a, b) => {
            const da = new Date(a.submittedAt).getTime();
            const db = new Date(b.submittedAt).getTime();
            return sortOrder === 'latest' ? db - da : da - db;
        });

        return list;
    })();

    const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
    const pageSlice  = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const getStatusInfo = (plan) => {
        if (plan.status === 'REJECTED')            return { label: 'Rejected by MD',        cls: 'rejected' };
        if (plan.evaluationStatus === 'EVALUATED') return { label: 'Evaluated',             cls: 'evaluated' };
        if (plan.hasAchievement)                   return { label: 'Achievement Submitted', cls: 'achievement' };
        if (plan.status === 'APPROVED' || plan.status === 'ACHIEVEMENT_PENDING' || plan.status === 'EVALUATION_PENDING') return { label: 'Plan Approved', cls: 'achievement' };
        return                                            { label: 'Plan Submitted',        cls: 'submitted' };
    };

    const stats = {
        total:       processed.length,
        evaluated:   processed.filter(p => p.evaluationStatus === 'EVALUATED').length,
        achievement: processed.filter(p => p.hasAchievement).length,
        rejected:    processed.filter(p => p.status === 'REJECTED').length,
    };

    /* ── reject handler ── */
    const handleReject = async () => {
        if (!rejectTarget) return;
        setRejecting(true);
        try {
            await api.put(`/md/monthly-plan/${rejectTarget._id}/reject`, { mdRemarks: rejectRemarks });
            toast.success('Monthly plan rejected');
            setRejectTarget(null);
            setRejectRemarks('');
            fetchPlans();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Rejection failed');
        } finally {
            setRejecting(false);
        }
    };

    /* ══════════════════════════════════════════════════
       REJECT MODAL
    ══════════════════════════════════════════════════ */
    const renderRejectModal = () => {
        if (!rejectTarget) return null;
        return (
            <div className="mmo-overlay" onClick={() => setRejectTarget(null)}>
                <div className="mmo-reject-modal" onClick={e => e.stopPropagation()}>
                    <div className="mmo-reject-modal-header">
                        <div>
                            <h3><FiAlertCircle /> Reject Monthly Plan</h3>
                            <p>{rejectTarget.employeeId?.name} · {fmtMonth(rejectTarget.month)}</p>
                        </div>
                        <button className="mmo-modal-close" onClick={() => setRejectTarget(null)}><FiX /></button>
                    </div>
                    <div className="mmo-reject-modal-body">
                        <div className="mmo-reject-plan-preview">
                            <div className="mmo-sec-label"><FiFileText /> Plan Details</div>
                            <div className="mmo-sec-content">{rejectTarget.planDetails}</div>
                        </div>
                        <div className="mmo-reject-form-group">
                            <label><FiMessageSquare /> Rejection Remarks (optional)</label>
                            <textarea
                                placeholder="Provide your reason for rejection so the employee can resubmit appropriately..."
                                value={rejectRemarks}
                                onChange={e => setRejectRemarks(e.target.value)}
                                rows={4}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="mmo-reject-modal-footer">
                        <button
                            className="mmo-reject-confirm-btn"
                            onClick={handleReject}
                            disabled={rejecting}
                        >
                            <FiXCircle /> {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
                        </button>
                        <button className="mmo-reject-cancel-btn" onClick={() => setRejectTarget(null)}>Cancel</button>
                    </div>
                </div>
            </div>
        );
    };

    /* ══════════════════════════════════════════════════
       DETAIL MODAL
    ══════════════════════════════════════════════════ */
    const renderDetail = () => {
        if (!selected) return null;
        const isEval     = selected.evaluationStatus === 'EVALUATED';
        const isRejected = selected.status === 'REJECTED';
        const canReject  = !isEval && !isRejected;

        return (
            <div className="mmo-overlay" onClick={() => setSelected(null)}>
                <div className="mmo-detail-modal" onClick={e => e.stopPropagation()}>
                    {/* ── Sticky Header ── */}
                    <div className="mmo-modal-header">
                        <div className="mmo-modal-header-left">
                            <div className="mmo-modal-avatar">{getInitials(selected.employeeId?.name)}</div>
                            <div className="mmo-modal-header-info">
                                <h2>{selected.employeeId?.name}</h2>
                                <p>{selected.employeeId?.employeeCode} · {selected.employeeId?.department || '—'} · {fmtMonth(selected.month)}</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {canReject && (
                                <button
                                    className="mmo-inline-reject-btn"
                                    onClick={() => { setSelected(null); setRejectTarget(selected); setRejectRemarks(''); }}
                                >
                                    <FiXCircle /> Reject Plan
                                </button>
                            )}
                            <button className="mmo-modal-close" onClick={() => setSelected(null)}><FiX /></button>
                        </div>
                    </div>

                    {/* ── Status Banners ── */}
                    {isRejected && (
                        <div className="mmo-status-banner rejected">
                            <FiAlertCircle /> This plan has been rejected by MD
                        </div>
                    )}
                    {isEval && (
                        <div className="mmo-status-banner evaluated">
                            <FiCheckCircle /> Evaluated by RA — cannot be rejected
                        </div>
                    )}

                    {/* ── Progress Stepper ── */}
                    <div className="mmo-modal-stepper">
                        <div className="mmo-step done"><div className="mmo-step-dot"><FiFileText /></div><span>Plan</span></div>
                        <div className={`mmo-step-line ${selected.hasAchievement ? 'done' : ''}`} />
                        <div className={`mmo-step ${selected.hasAchievement ? 'done' : 'pending'}`}><div className="mmo-step-dot"><FiTrendingUp /></div><span>Achievement</span></div>
                        <div className={`mmo-step-line ${isEval ? 'done' : ''}`} />
                        <div className={`mmo-step ${isEval ? 'done' : 'pending'}`}><div className="mmo-step-dot"><FiCheckCircle /></div><span>Evaluated</span></div>
                    </div>

                    {/* ── Scrollable Body ── */}
                    <div className="mmo-modal-body">
                        {/* ── Plan Section ── */}
                        <div className="mmo-detail-section">
                            <div className="mmo-detail-section-header">
                                <FiFileText /> Monthly Plan
                            </div>
                            <div className="mmo-detail-section-body">
                                <div className="mmo-detail-text-block">{selected.planDetails || '—'}</div>
                                <div className="mmo-detail-meta"><FiClock /> Submitted {fmtDate(selected.submittedAt)}</div>
                            </div>
                        </div>

                        {/* ── Achievement Section ── */}
                        <div className="mmo-detail-section">
                            <div className="mmo-detail-section-header">
                                <FiTrendingUp /> Achievement
                            </div>
                            <div className="mmo-detail-section-body">
                                {selected.achievementDetails ? (
                                    <>
                                        <div className="mmo-detail-text-block">{selected.achievementDetails}</div>
                                        {selected.achievementDate && <div className="mmo-detail-meta"><FiClock /> Submitted {fmtDate(selected.achievementDate)}</div>}
                                    </>
                                ) : (
                                    <div className="mmo-detail-not-available"><FiClock /> Not yet submitted</div>
                                )}
                            </div>
                        </div>

                        {/* ── RA Evaluation Section ── */}
                        <div className="mmo-detail-section">
                            <div className="mmo-detail-section-header">
                                <FiShield /> RA Evaluation
                            </div>
                            <div className="mmo-detail-section-body">
                                {isEval ? (
                                    <div className="mmo-ra-eval-card">
                                        {/* Score Row */}
                                        {selected.evaluationScore != null && (
                                            <div className="mmo-ra-score-row">
                                                <div className="mmo-ra-score-number" style={{ color: scoreColor(selected.evaluationScore) }}>
                                                    {selected.evaluationScore}<span className="mmo-ra-score-max">/10</span>
                                                </div>
                                                <div className="mmo-ra-bar-container">
                                                    <div className="mmo-ra-bar-label">Score</div>
                                                    <div className="mmo-ra-bar-track">
                                                        <div className="mmo-ra-bar-fill"
                                                            style={{ width: `${(selected.evaluationScore / 10) * 100}%`, background: scoreColor(selected.evaluationScore) }} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {/* RA Remarks */}
                                        {selected.evaluationRemarks && (
                                            <div className="mmo-ra-remarks-block">
                                                <div className="mmo-ra-remarks-label"><FiMessageSquare /> RA Remarks</div>
                                                <div className="mmo-ra-remarks-text">{selected.evaluationRemarks}</div>
                                            </div>
                                        )}
                                        {!selected.evaluationRemarks && (
                                            <div className="mmo-ra-remarks-block">
                                                <div className="mmo-ra-remarks-label"><FiMessageSquare /> RA Remarks</div>
                                                <div className="mmo-detail-not-available" style={{ margin: 0 }}>No remarks provided</div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mmo-detail-not-available"><FiClock /> Awaiting RA evaluation</div>
                                )}
                            </div>
                        </div>

                        {/* ── MD Rejection Remarks ── */}
                        {isRejected && selected.mdRemarks && (
                            <div className="mmo-detail-section">
                                <div className="mmo-detail-section-header" style={{ color: '#EF4444' }}>
                                    <FiAlertCircle /> MD Rejection Remarks
                                </div>
                                <div className="mmo-detail-section-body">
                                    <div className="mmo-md-reject-block">{selected.mdRemarks}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    /* ══════════════════════════════════════════════════
       RENDER
    ══════════════════════════════════════════════════ */
    return (
        <div className="fade-in">
            <div className="page-header" style={{ marginBottom: '16px' }}>
                <div>
                    <h1>Monthly Plan Overview</h1>
                    <p>Review all employee monthly plans, achievements, and RA evaluation scores. Reject plans if needed.</p>
                </div>
            </div>

            {/* Stats row - Using MD KPI Tiles */}
            <div className="md-kpi-grid">
                <div className="md-kpi-tile blue">
                    <div className="md-kpi-label"><FiFileText /> Total Submissions</div>
                    <div className="md-kpi-value">{stats.total}</div>
                </div>
                <div className="md-kpi-tile green">
                    <div className="md-kpi-label"><FiTrendingUp /> Has Achievements</div>
                    <div className="md-kpi-value">{stats.achievement}</div>
                </div>
                <div className="md-kpi-tile purple">
                    <div className="md-kpi-label"><FiCheckCircle /> Evaluated</div>
                    <div className="md-kpi-value">{stats.evaluated}</div>
                </div>
                <div className="md-kpi-tile red">
                    <div className="md-kpi-label"><FiAlertCircle /> Rejected</div>
                    <div className="md-kpi-value">{stats.rejected}</div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="mmo-filter-bar">
                <div className="mmo-search-wrap">
                    <FiSearch className="mmo-search-icon" />
                    <input
                        type="text"
                        className="mmo-search-input"
                        placeholder="Search employee name or code..."
                        value={searchQ}
                        onChange={e => setSearchQ(e.target.value)}
                    />
                    {searchQ && <button className="mmo-search-clear" onClick={() => setSearchQ('')}><FiX /></button>}
                </div>

                <div className="mmo-filter-controls">
                    <div className="mmo-filter-group">
                        <FiCalendar />
                        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiFilter />
                        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                            <option value="">All Months</option>
                            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                        </select>
                    </div>

                    <div className="mmo-filter-group">
                        <FiChevronDown />
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                            <option value="">All Status</option>
                            <option value="PENDING">Pending Evaluation</option>
                            <option value="EVALUATED">Evaluated</option>
                            <option value="REJECTED">Rejected</option>
                        </select>
                    </div>

                    <button
                        className={`mmo-sort-btn ${sortOrder === 'latest' ? 'active' : ''}`}
                        onClick={() => setSortOrder(s => s === 'latest' ? 'oldest' : 'latest')}
                        title={sortOrder === 'latest' ? 'Showing: Latest first' : 'Showing: Oldest first'}
                    >
                        {sortOrder === 'latest' ? <><FiArrowDown /> Latest</> : <><FiArrowUp /> Oldest</>}
                    </button>
                </div>
            </div>

            {/* Result meta */}
            <div className="mmo-result-meta">
                {loading ? 'Loading...' : `${processed.length} plans found`}
                {(filterMonth || filterStatus || searchQ) && (
                    <button className="mmo-clear-filters" onClick={() => { setFilterMonth(currentMonth); setFilterStatus(''); setSearchQ(''); setSortOrder('latest'); }}>
                        <FiX /> Clear filters
                    </button>
                )}
                <span className="mmo-reject-hint"><FiAlertCircle /> Click row to view details · Reject button available for plans not yet RA-evaluated</span>
            </div>

            {/* Table */}
            {loading ? (
                <div className="mmo-loading">
                    <div className="spinner" />
                    <p>Loading monthly plans...</p>
                </div>
            ) : pageSlice.length === 0 ? (
                <div className="mmo-empty">
                    <div className="mmo-empty-icon"><FiFileText /></div>
                    <h3>No plans found</h3>
                    <p>Try adjusting your filters</p>
                </div>
            ) : (
                <>
                    <div className="mmo-table-card">
                        <table className="mmo-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Employee</th>
                                    <th>Month</th>
                                    <th>Plan Preview</th>
                                    <th>Progress</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                    <th>Submitted</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageSlice.map((plan, idx) => {
                                    const st = getStatusInfo(plan);
                                    const isEval     = plan.evaluationStatus === 'EVALUATED';
                                    const isRejected = plan.status === 'REJECTED';
                                    const canReject  = !isEval && !isRejected;
                                    return (
                                        <tr key={plan._id} className={`mmo-row ${isRejected ? 'mmo-row-rejected' : ''}`} onClick={() => setSelected(plan)}>
                                            <td className="mmo-cell-num">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                                            <td>
                                                <div className="mmo-emp-cell">
                                                    <div className="mmo-avatar">{getInitials(plan.employeeId?.name)}</div>
                                                    <div>
                                                        <div className="mmo-emp-name">{plan.employeeId?.name || '—'}</div>
                                                        <div className="mmo-emp-code">{plan.employeeId?.employeeCode}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="mmo-cell-month">{plan.month}</td>
                                            <td>
                                                <div className="mmo-plan-preview">{plan.planDetails}</div>
                                            </td>
                                            <td>
                                                <div className="mmo-progress">
                                                    <div className="mmo-pdot done" title="Plan submitted" />
                                                    <div className={`mmo-pline ${plan.hasAchievement ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${plan.hasAchievement ? 'done' : ''}`} title="Achievement" />
                                                    <div className={`mmo-pline ${isEval ? 'done' : ''}`} />
                                                    <div className={`mmo-pdot ${isEval ? 'done evaluated' : ''}`} title="Evaluated" />
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`mmo-status-badge ${st.cls}`}>{st.label}</span>
                                            </td>
                                            <td>
                                                {isEval && plan.evaluationScore != null ? (
                                                    <span className="mmo-score" style={{ color: scoreColor(plan.evaluationScore) }}>
                                                        <FiStar style={{ fontSize: '0.625rem' }} /> {plan.evaluationScore}/10
                                                    </span>
                                                ) : <span className="mmo-no-score">—</span>}
                                            </td>
                                            <td className="mmo-cell-date">{fmtDate(plan.submittedAt)}</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <button 
                                                        className="mmo-view-btn"
                                                        onClick={() => setSelected(plan)}
                                                        title="View Details"
                                                    >
                                                        <FiEye /> View
                                                    </button>
                                                    
                                                    {canReject ? (
                                                        <button
                                                            className="mmo-reject-btn"
                                                            onClick={() => { setRejectTarget(plan); setRejectRemarks(''); }}
                                                            title="Reject this plan"
                                                        >
                                                            <FiXCircle /> 
                                                        </button>
                                                    ) : isRejected ? (
                                                        <span className="mmo-rejected-tag">Rejected</span>
                                                    ) : (
                                                        <span className="mmo-locked-tag" title="RA has evaluated — cannot reject"><FiCheckCircle /> Evaluated</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="mmo-pagination">
                            <button className="mmo-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                <FiChevronLeft /> Prev
                            </button>
                            <div className="mmo-page-numbers">
                                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
                                    <button
                                        key={p}
                                        className={`mmo-page-num ${p === page ? 'active' : ''}`}
                                        onClick={() => setPage(p)}
                                    >{p}</button>
                                ))}
                            </div>
                            <button className="mmo-page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                Next <FiChevronRight />
                            </button>
                        </div>
                    )}
                </>
            )}

            {renderDetail()}
            {renderRejectModal()}
        </div>
    );
};

export default MDMonthlyOverviewPage;
