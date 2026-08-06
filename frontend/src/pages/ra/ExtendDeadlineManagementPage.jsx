import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiClock, FiAlertTriangle, FiCalendar, FiX, FiRefreshCw, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import api from '../../services/api';
import ExtendDeadlineModal from './ExtendDeadlineModal';
import './ExtendDeadlineManagement.css';

/* ════════════════════════════════════════════════════════════
   Constants
════════════════════════════════════════════════════════════ */
const GO_LIVE = { year: 2026, month: 5 }; // Must mirror backend GO_LIVE in dateHelpers.js

const TODAY_STR = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
})();

/* ════════════════════════════════════════════════════════════
   Helpers
════════════════════════════════════════════════════════════ */
const fmtDate = (d) => {
    if (!d) return '—';
    try {
        const date = typeof d === 'string' ? new Date(d + 'T00:00:00') : new Date(d);
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return d; }
};

const fmtMonth = (str) => {
    if (!str) return '';
    const [y, m] = str.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const getInitials = (name = '') =>
    name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

/* ════════════════════════════════════════════════════════════
   Helpers
════════════════════════════════════════════════════════════ */

/**
 * Maps raw DB plan/achievement status values to human-readable labels.
 * PENDING = employee submitted, awaiting RA evaluation ("Under Review")
 * SUBMITTED = same as PENDING in the achievement flow
 * EVALUATED = RA has scored it
 * REJECTED = RA sent back for revision
 * DRAFT = employee saved but hasn't submitted yet
 * MISSING = no record exists at all
 */
function planStatusLabel(status) {
    switch (status) {
        case 'PENDING':   return 'Submitted';
        case 'SUBMITTED': return 'Submitted';
        case 'EVALUATED': return 'Evaluated';
        case 'REJECTED':  return 'Rejected';
        case 'DRAFT':     return 'Draft';
        case 'MISSING':   return 'Missing';
        default:          return status;
    }
}

/* ════════════════════════════════════════════════════════════
   DeadlineHistoryModal
════════════════════════════════════════════════════════════ */
const DeadlineHistoryModal = ({ params, onClose, onExtend, canExtend }) => {
    const [ctx, setCtx]     = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetch = async () => {
            setLoading(true);
            setError('');
            try {
                const res = await api.get('/ra/extend-deadline/context', { params });
                setCtx(res.data);
            } catch (err) {
                setError(err.response?.data?.message || 'Failed to load extension details.');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [params.employeeId, params.month, params.year, params.type]);

    const handleExtend = () => {
        onClose();
        onExtend();
    };

    return createPortal(
        <div className="edmp-hist-overlay" onClick={onClose}>
            <div className="edmp-hist-modal" onClick={e => e.stopPropagation()}>
                <div className="edmp-hist-header">
                    <h3 className="edmp-hist-title">
                        Extension History — {params.type === 'PLAN' ? '📋 Plan' : '🏆 Progress'}
                    </h3>
                    <button className="edmp-hist-close" onClick={onClose}><FiX /></button>
                </div>

                <div className="edmp-hist-body">
                    {loading ? (
                        <div className="edmp-loading">
                            <div className="edmp-spinner" />
                            <br />Loading…
                        </div>
                    ) : error ? (
                        <div style={{ padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#B91C1C', fontSize: '0.82rem' }}>
                            ⚠ {error}
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                                <div style={{ flex: 1, minWidth: '140px', padding: '12px', background: '#F9FAFB', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '0.78rem', color: '#374151' }}>
                                    <div style={{ fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.66rem', marginBottom: '5px' }}>Original Deadline</div>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#111827' }}>{fmtDate(ctx?.baseDeadline)}</div>
                                </div>
                                <div style={{ flex: 1, minWidth: '140px', padding: '12px', background: ctx?.isExtended ? '#FFF7ED' : '#F9FAFB', borderRadius: '8px', border: `1px solid ${ctx?.isExtended ? '#FED7AA' : '#E5E7EB'}`, fontSize: '0.78rem', color: '#374151' }}>
                                    <div style={{ fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.66rem', marginBottom: '5px' }}>
                                        {ctx?.isExtended ? 'Current Deadline (Extended)' : 'Effective Deadline'}
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: ctx?.isExtended ? '#92400E' : '#111827' }}>
                                        {fmtDate(ctx?.effectiveDeadline)}
                                    </div>
                                </div>
                                <div style={{ flex: 1, minWidth: '140px', padding: '12px', background: '#F9FAFB', borderRadius: '8px', border: '1px solid #E5E7EB', fontSize: '0.78rem', color: '#374151' }}>
                                    <div style={{ fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.66rem', marginBottom: '5px' }}>Max Ceiling</div>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#111827' }}>{fmtDate(ctx?.maxDate)}</div>
                                </div>
                            </div>

                            {ctx?.extensionHistory?.length > 0 ? (
                                <>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
                                        Extension History ({ctx.extensionHistory.length})
                                    </div>
                                    <div className="edmp-timeline">
                                        {ctx.extensionHistory.map((h, i) => (
                                            <div key={h.id || i} className="edmp-timeline-item">
                                                <div className="edmp-timeline-row">
                                                    <span className="edmp-timeline-dates">
                                                        {fmtDate(h.oldDeadline)} → {fmtDate(h.newDeadline)}
                                                    </span>
                                                    <span className="edmp-timeline-by">by {h.extendedByName}</span>
                                                </div>
                                                <div className="edmp-timeline-reason">"{h.reason}"</div>
                                                {h.notifiedEmployee && (
                                                    <div style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: '4px' }}>✓ Employee notified</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: '0.85rem' }}>
                                    <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>📋</div>
                                    No extensions have been granted for this item yet.
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="edmp-hist-footer">
                    <button className="edmp-action-btn secondary" onClick={onClose}>Close</button>
                    {!loading && !error && canExtend && (
                        <button className="edmp-action-btn" onClick={handleExtend}>
                            ⏱ {ctx?.isExtended ? 'Extend Again' : 'Grant Extension'}
                        </button>
                    )}
                    {!loading && !error && !canExtend && (
                        <span style={{ fontSize: '0.78rem', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            ✅ Submission already received — no extension needed
                        </span>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

/* ════════════════════════════════════════════════════════════
   WindowClosedBadge
   Muted non-clickable badge shown instead of an Extend button
   when isStillExtendable === false.
════════════════════════════════════════════════════════════ */
/* `maxedOut` distinguishes two different reasons the Extend button is gone:
     - maxedOut=false → today has passed the ceiling date (a true time-expired window)
     - maxedOut=true  → the deadline has already been extended all the way to
                         the ceiling; the window itself may still be "open" by
                         date, there's just no further room to move it */
const WindowClosedBadge = ({ closedAt, maxedOut }) => (
    <span
        className="edmp-window-closed"
        title={maxedOut
            ? `Already extended to the maximum allowed date (${fmtDate(closedAt)}).`
            : `Extension window closed on ${fmtDate(closedAt)}`}
    >
        🔒 {maxedOut ? 'Max reached' : 'Window closed'}
        {closedAt && (
            <span className="edmp-window-closed-date">on {fmtDate(closedAt)}</span>
        )}
    </span>
);

/* ════════════════════════════════════════════════════════════
   OutstandingTab
   Lists ACTIONABLE missed deadlines (isStillExtendable=true)
   returned by GET /ra/missed-deadlines.
   Shows a collapsible secondary section for permanently expired items.
════════════════════════════════════════════════════════════ */
const OutstandingTab = () => {
    const [data, setData]               = useState(null);
    const [loading, setLoading]         = useState(true);
    const [histParams, setHistParams]   = useState(null);
    const [extendTarget, setExtendTarget] = useState(null);

    // Expired section state
    const [expiredOpen, setExpiredOpen]         = useState(false);
    const [expiredItems, setExpiredItems]       = useState([]);
    const [expiredLoading, setExpiredLoading]   = useState(false);
    const [expiredFetched, setExpiredFetched]   = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/missed-deadlines');
            setData(res.data);
        } catch {
            toast.error('Failed to load overdue submissions.');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleExpired = async () => {
        if (expiredOpen) {
            setExpiredOpen(false);
            return;
        }
        setExpiredOpen(true);
        if (!expiredFetched) {
            setExpiredLoading(true);
            try {
                const res = await api.get('/ra/missed-deadlines', { params: { includeExpired: 'true' } });
                setExpiredItems(res.data?.expiredItems ?? []);
                setExpiredFetched(true);
            } catch {
                toast.error('Failed to load expired submissions.');
            } finally {
                setExpiredLoading(false);
            }
        }
    };

    if (loading) {
        return (
            <div className="edmp-loading">
                <div className="edmp-spinner" />
                <br />Loading overdue submissions…
            </div>
        );
    }

    if (!data || data.items.length === 0) {
        return (
            <>
                <div className="edmp-empty">
                    <span className="edmp-empty-icon">✅</span>
                    <div className="edmp-empty-title">No actionable overdue submissions</div>
                    <div className="edmp-empty-sub">
                        {data?.expiredCount > 0
                            ? `${data.expiredCount} submission${data.expiredCount !== 1 ? 's' : ''} were permanently missed — extension window has closed.`
                            : 'All your employees are on track!'
                        }
                    </div>
                </div>
                {/* Still show the expired toggle if there are expired items */}
                {data?.expiredCount > 0 && (
                    <div style={{ marginTop: '12px' }}>
                        <ExpiredSection
                            expiredCount={data.expiredCount}
                            expiredOpen={expiredOpen}
                            expiredLoading={expiredLoading}
                            expiredItems={expiredItems}
                            onToggle={toggleExpired}
                        />
                    </div>
                )}
            </>
        );
    }

    const { totalCount, byMonth, items, expiredCount } = data;

    return (
        <>
            {/* Summary pills — actionable only */}
            <div className="edmp-summary-pills">
                <span className="edmp-pill edmp-pill-red">
                    <FiAlertTriangle size={12} /> {totalCount} actionable overdue submission{totalCount !== 1 ? 's' : ''}
                </span>
                {byMonth.slice(0, 3).map(bm => (
                    <span key={bm.month} className="edmp-pill edmp-pill-orange">
                        {bm.label}: {bm.count}
                    </span>
                ))}
                {byMonth.length > 3 && (
                    <span className="edmp-pill edmp-pill-orange">+{byMonth.length - 3} more months</span>
                )}
                <button
                    onClick={load}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', marginLeft: 'auto' }}
                >
                    <FiRefreshCw size={13} /> Refresh
                </button>
            </div>

            {/* Main actionable table — sorted soonest-expiring first by backend */}
            <div className="edmp-table-card">
              <div className="edmp-table-scroll">
                <table className="edmp-table">
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Month</th>
                            <th>Type</th>
                            <th>Base Deadline</th>
                            <th>Effective Deadline</th>
                            <th>Extensions</th>
                            <th>Ext. Window Closes</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr
                                key={`${item.employeeId}:${item.month}:${item.type}`}
                                onClick={() => setHistParams({
                                    employeeId: item.employeeId,
                                    month: parseInt(item.month.split('-')[1], 10),
                                    year: parseInt(item.month.split('-')[0], 10),
                                    type: item.type,
                                    _row: item,
                                })}
                            >
                                <td>
                                    <div className="edmp-emp-cell">
                                        <div className="edmp-avatar">{getInitials(item.employeeName)}</div>
                                        <div>
                                            <div className="edmp-emp-name">{item.employeeName}</div>
                                            <div className="edmp-emp-meta">
                                                {item.employeeCode && `#${item.employeeCode}`}
                                                {item.department && ` · ${item.department}`}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td>{fmtMonth(item.month)}</td>
                                <td>
                                    <span className={item.type === 'PLAN' ? 'edmp-type-plan' : 'edmp-type-achievement'}>
                                        {item.type === 'PLAN' ? '📋 Plan' : '🏆 Progress'}
                                    </span>
                                </td>
                                <td>
                                    <span className="edmp-deadline">{fmtDate(item.baseDeadline)}</span>
                                </td>
                                <td>
                                    {item.isExtended ? (
                                        <span className="edmp-deadline-extended">
                                            🔁 {fmtDate(item.effectiveDeadline)}
                                        </span>
                                    ) : (
                                        <span className="edmp-deadline edmp-overdue-label">
                                            {fmtDate(item.effectiveDeadline)}
                                        </span>
                                    )}
                                </td>
                                <td>
                                    {item.extensionCount > 0 ? (
                                        <span className="edmp-ext-badge">🔁 ×{item.extensionCount}</span>
                                    ) : (
                                        <span className="edmp-ext-none">None</span>
                                    )}
                                </td>
                                <td>
                                    {/* Highlight if closing within 2 days */}
                                    <UrgencyDate dateStr={item.extensionWindowClosesAt} />
                                </td>
                                <td>
                                    {/* All items in the actionable list have isStillExtendable=true */}
                                    <button
                                        className="edmp-action-btn"
                                        onClick={e => {
                                            e.stopPropagation();
                                            setExtendTarget({
                                                employee: {
                                                    id: item.employeeId,
                                                    name: item.employeeName,
                                                    employeeCode: item.employeeCode,
                                                    department: item.department,
                                                },
                                                monthYear: {
                                                    month: parseInt(item.month.split('-')[1], 10),
                                                    year: parseInt(item.month.split('-')[0], 10),
                                                },
                                                missingType: item.type === 'PLAN' ? 'plan' : 'progress',
                                            });
                                        }}
                                    >
                                        ⏱ Extend
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
            </div>

            {/* Expired collapsible section */}
            {expiredCount > 0 && (
                <ExpiredSection
                    expiredCount={expiredCount}
                    expiredOpen={expiredOpen}
                    expiredLoading={expiredLoading}
                    expiredItems={expiredItems}
                    onToggle={toggleExpired}
                />
            )}

            {/* History modal */}
            {histParams && (
                <DeadlineHistoryModal
                    params={histParams}
                    onClose={() => setHistParams(null)}
                    onExtend={() => {
                        const r = histParams._row;
                        setExtendTarget({
                            employee: {
                                id: r.employeeId, name: r.employeeName,
                                employeeCode: r.employeeCode, department: r.department,
                            },
                            monthYear: {
                                month: parseInt(r.month.split('-')[1], 10),
                                year: parseInt(r.month.split('-')[0], 10),
                            },
                            missingType: r.type === 'PLAN' ? 'plan' : 'Progress',
                        });
                        setHistParams(null);
                    }}
                />
            )}

            {/* Extend modal */}
            {extendTarget && (
                <ExtendDeadlineModal
                    employee={extendTarget.employee}
                    month={fmtMonth(`${extendTarget.monthYear.year}-${String(extendTarget.monthYear.month).padStart(2, '0')}`)}
                    monthYear={extendTarget.monthYear}
                    missingType={extendTarget.missingType}
                    originalDeadline={null}
                    onClose={() => setExtendTarget(null)}
                    onConfirm={() => { setExtendTarget(null); load(); }}
                />
            )}
        </>
    );
};

/* ════════════════════════════════════════════════════════════
   UrgencyDate
   Shows extensionWindowClosesAt in orange/red if ≤ 2 days away.
════════════════════════════════════════════════════════════ */
const UrgencyDate = ({ dateStr }) => {
    if (!dateStr) return <span className="edmp-deadline">—</span>;
    const closes = new Date(dateStr + 'T23:59:59');
    const now    = new Date();
    const daysLeft = Math.ceil((closes - now) / (1000 * 60 * 60 * 24));

    if (daysLeft <= 1) {
        return (
            <span style={{ color: '#B91C1C', fontWeight: 700, fontSize: '0.8rem' }}>
                {fmtDate(dateStr)} ⚠
            </span>
        );
    }
    if (daysLeft <= 3) {
        return (
            <span style={{ color: '#92400E', fontWeight: 600, fontSize: '0.8rem' }}>
                {fmtDate(dateStr)}
            </span>
        );
    }
    return <span className="edmp-deadline">{fmtDate(dateStr)}</span>;
};

/* ════════════════════════════════════════════════════════════
   ExpiredSection
   Collapsible read-only list of permanently missed items.
   Only fetched on first expand (lazy).
════════════════════════════════════════════════════════════ */
const ExpiredSection = ({ expiredCount, expiredOpen, expiredLoading, expiredItems, onToggle }) => (
    <div className="edmp-expired-section">
        <button className="edmp-expired-toggle" onClick={onToggle}>
            {expiredOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            {expiredCount} additional submission{expiredCount !== 1 ? 's' : ''} were permanently missed
            (extension window closed)
            <span className="edmp-expired-toggle-hint">{expiredOpen ? 'Hide' : 'Show'}</span>
        </button>

        {expiredOpen && (
            expiredLoading ? (
                <div className="edmp-loading" style={{ padding: '24px' }}>
                    <div className="edmp-spinner" />
                </div>
            ) : expiredItems.length === 0 ? (
                <div style={{ padding: '16px', fontSize: '0.82rem', color: '#9CA3AF', textAlign: 'center' }}>
                    No data available.
                </div>
            ) : (
                <div className="edmp-table-card" style={{ marginTop: '8px', borderColor: '#E5E7EB' }}>
                  <div className="edmp-table-scroll">
                    <table className="edmp-table edmp-table-muted">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Month</th>
                                <th>Type</th>
                                <th>Base Deadline</th>
                                <th>Effective Deadline</th>
                                <th>Extensions</th>
                                <th>Window Closed</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expiredItems.map((item) => (
                                <tr key={`exp:${item.employeeId}:${item.month}:${item.type}`}>
                                    <td>
                                        <div className="edmp-emp-cell">
                                            <div className="edmp-avatar" style={{ background: '#9CA3AF' }}>
                                                {getInitials(item.employeeName)}
                                            </div>
                                            <div>
                                                <div className="edmp-emp-name" style={{ color: '#6B7280' }}>{item.employeeName}</div>
                                                <div className="edmp-emp-meta">
                                                    {item.employeeCode && `#${item.employeeCode}`}
                                                    {item.department && ` · ${item.department}`}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ color: '#6B7280' }}>{fmtMonth(item.month)}</td>
                                    <td>
                                        <span className={item.type === 'PLAN' ? 'edmp-type-plan' : 'edmp-type-achievement'}>
                                            {item.type === 'PLAN' ? '📋 Plan' : '🏆 Progress'}
                                        </span>
                                    </td>
                                    <td><span className="edmp-deadline">{fmtDate(item.baseDeadline)}</span></td>
                                    <td><span className="edmp-deadline">{fmtDate(item.effectiveDeadline)}</span></td>
                                    <td>
                                        {item.extensionCount > 0
                                            ? <span className="edmp-ext-badge">🔁 ×{item.extensionCount}</span>
                                            : <span className="edmp-ext-none">None</span>
                                        }
                                    </td>
                                    <td>
                                        <span style={{ fontSize: '0.78rem', color: '#6B7280' }}>
                                            {fmtDate(item.extensionWindowClosesAt)}
                                        </span>
                                    </td>
                                    <td>
                                        {/* Read-only — no extend button, nothing to do */}
                                        <span className="edmp-window-closed" style={{ cursor: 'default' }}>
                                            🔒 Window closed
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
                </div>
            )
        )}
    </div>
);

/* ════════════════════════════════════════════════════════════
   ByMonthTab
   Full roster for a single month, plan + achievement columns.
   Uses isStillExtendable to control action buttons.
════════════════════════════════════════════════════════════ */
const ByMonthTab = () => {
    const [selectedMonth, setSelectedMonth] = useState(TODAY_STR);
    const [data, setData]                   = useState(null);
    const [loading, setLoading]             = useState(false);
    const [histParams, setHistParams]       = useState(null);
    const [extendTarget, setExtendTarget]   = useState(null);

    const load = useCallback(async (month) => {
        setLoading(true);
        try {
            const res = await api.get('/ra/deadline-management', { params: { month } });
            setData(res.data);
        } catch {
            toast.error('Failed to load deadline data.');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(selectedMonth); }, [selectedMonth, load]);

    const goLiveStr = `${GO_LIVE.year}-${String(GO_LIVE.month).padStart(2, '0')}`;

    const openExtend = (emp, type) => {
        const [y, m] = selectedMonth.split('-').map(Number);
        setExtendTarget({
            employee: { id: emp.employeeId, name: emp.employeeName, employeeCode: emp.employeeCode, department: emp.department },
            monthYear: { month: m, year: y },
            missingType: type === 'PLAN' ? 'plan' : 'Progress',
        });
    };

    const openHistory = (emp, type) => {
        const [y, m] = selectedMonth.split('-').map(Number);
        setHistParams({ employeeId: emp.employeeId, month: m, year: y, type, _emp: emp });
    };

    return (
        <>
            {/* Month picker */}
            <div className="edmp-month-bar">
                <label className="edmp-month-label" htmlFor="edmp-month-picker">
                    <FiCalendar size={14} /> Month:
                </label>
                <input
                    id="edmp-month-picker"
                    type="month"
                    className="edmp-month-input"
                    value={selectedMonth}
                    min={goLiveStr}
                    max={TODAY_STR}
                    onChange={e => setSelectedMonth(e.target.value)}
                />
                {data && <span style={{ fontSize: '0.82rem', color: '#6B7280' }}>{data.label}</span>}
            </div>

            {loading ? (
                <div className="edmp-loading">
                    <div className="edmp-spinner" />
                    <br />Loading roster…
                </div>
            ) : !data || data.employees.length === 0 ? (
                <div className="edmp-empty">
                    <span className="edmp-empty-icon">👥</span>
                    <div className="edmp-empty-title">No employees found for this month</div>
                    <div className="edmp-empty-sub">Try selecting a different month.</div>
                </div>
            ) : (
                <div className="edmp-table-card">
                  <div className="edmp-table-scroll">
                    <table className="edmp-table">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Plan Status</th>
                                <th>Plan Deadline</th>
                                <th>Plan Extensions</th>
                                <th>Progress Status</th>
                                <th>Progress Deadline</th>
                                <th>Progress Extensions</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.employees.map(emp => (
                                <tr key={emp.employeeId}>
                                    <td>
                                        <div className="edmp-emp-cell">
                                            <div className="edmp-avatar">{getInitials(emp.employeeName)}</div>
                                            <div>
                                                <div className="edmp-emp-name">{emp.employeeName}</div>
                                                <div className="edmp-emp-meta">
                                                    {emp.employeeCode && `#${emp.employeeCode}`}
                                                    {emp.department && ` · ${emp.department}`}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Plan status — map raw DB enum to human label.
                                         Status precedence (resolved by backend):
                                           MISSING   → no plan submitted
                                           PENDING   → submitted, awaiting RA review
                                           EVALUATED → RA has scored it
                                           REJECTED  → RA sent back for revision */}
                                    <td>
                                        {emp.plan.status === 'MISSING'
                                            ? <span className="edmp-missing-chip">Missing</span>
                                            : emp.plan.status === 'REJECTED'
                                                ? <span className="edmp-rejected-chip">Rejected</span>
                                                : emp.plan.status === 'EVALUATED'
                                                    ? <span className="edmp-evaluated-chip">✓ Evaluated</span>
                                                    : emp.plan.status === 'DRAFT'
                                                        ? <span className="edmp-draft-chip">✎ Draft</span>
                                                        : <span className="edmp-submitted-chip">↑ {planStatusLabel(emp.plan.status)}</span>
                                        }
                                    </td>
                                    {/* Plan deadline */}
                                    <td
                                        onClick={() => openHistory(emp, 'PLAN')}
                                        title="Click to view extension history"
                                    >
                                        {emp.plan.isExtended ? (
                                            <span className="edmp-deadline-extended">
                                                🔁 {fmtDate(emp.plan.effectiveDeadline)}
                                            </span>
                                        ) : (
                                            <span className="edmp-deadline">{fmtDate(emp.plan.effectiveDeadline)}</span>
                                        )}
                                        <span className="edmp-col-sub">base: {fmtDate(emp.plan.baseDeadline)}</span>
                                    </td>
                                    {/* Plan extensions */}
                                    <td>
                                        {emp.plan.extensionCount > 0
                                            ? <span className="edmp-ext-badge">🔁 ×{emp.plan.extensionCount}</span>
                                            : <span className="edmp-ext-none">—</span>
                                        }
                                    </td>

                                    {/* Achievement status */}
                                    <td>
                                        {emp.achievement.status === 'N/A'
                                            ? <span className="edmp-na-chip">N/A (no plan)</span>
                                            : emp.achievement.status === 'MISSING'
                                                ? <span className="edmp-missing-chip">Missing</span>
                                                : emp.achievement.status === 'DRAFT'
                                                    ? <span className="edmp-draft-chip">✎ Draft</span>
                                                    : emp.achievement.status === 'EVALUATED'
                                                        ? <span className="edmp-evaluated-chip">✓ Evaluated</span>
                                                        : emp.achievement.status === 'REJECTED'
                                                            ? <span className="edmp-rejected-chip">Rejected</span>
                                                            : <span className="edmp-submitted-chip">↑ {planStatusLabel(emp.achievement.status)}</span>
                                        }
                                    </td>
                                    {/* Achievement deadline
                                         - Disable onClick when status is N/A (no plan exists)
                                           so clicking an empty cell doesn't open a nonsense modal.
                                         - Always show the deadline dates — the backend computes
                                           them for every employee regardless of submission status. */}
                                    <td
                                        onClick={emp.achievement.status !== 'N/A'
                                            ? () => openHistory(emp, 'ACHIEVEMENT')
                                            : undefined}
                                        title={emp.achievement.status !== 'N/A' ? 'Click to view extension history' : undefined}
                                        style={emp.achievement.status !== 'N/A' ? { cursor: 'pointer' } : {}}
                                    >
                                        <>
                                            {emp.achievement.isExtended ? (
                                                <span className="edmp-deadline-extended">
                                                    🔁 {fmtDate(emp.achievement.effectiveDeadline)}
                                                </span>
                                            ) : (
                                                <span className="edmp-deadline">{fmtDate(emp.achievement.effectiveDeadline)}</span>
                                            )}
                                            <span className="edmp-col-sub">base: {fmtDate(emp.achievement.baseDeadline)}</span>
                                        </>
                                    </td>
                                    {/* Achievement extensions */}
                                    <td>
                                        {emp.achievement.status !== 'N/A' && emp.achievement.extensionCount > 0
                                            ? <span className="edmp-ext-badge">🔁 ×{emp.achievement.extensionCount}</span>
                                            : <span className="edmp-ext-none">—</span>
                                        }
                                    </td>

                                    {/* Actions — gated by isStillExtendable */}
                                    <td>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {emp.plan.status === 'MISSING' && (
                                                emp.plan.isStillExtendable ? (
                                                    <button
                                                        className="edmp-action-btn"
                                                        onClick={e => { e.stopPropagation(); openExtend(emp, 'PLAN'); }}
                                                        title="Extend plan deadline"
                                                    >
                                                        Plan ⏱
                                                    </button>
                                                ) : (
                                                    <WindowClosedBadge
                                                        closedAt={emp.plan.extensionWindowClosesAt}
                                                        maxedOut={emp.plan.effectiveDeadline === emp.plan.extensionWindowClosesAt}
                                                    />
                                                )
                                            )}
                                            {emp.achievement.status === 'MISSING' && (
                                                emp.achievement.isStillExtendable ? (
                                                    <button
                                                        className="edmp-action-btn"
                                                        onClick={e => { e.stopPropagation(); openExtend(emp, 'ACHIEVEMENT'); }}
                                                        title="Extend achievement deadline"
                                                    >
                                                        Prog. ⏱
                                                    </button>
                                                ) : (
                                                    <WindowClosedBadge
                                                        closedAt={emp.achievement.extensionWindowClosesAt}
                                                        maxedOut={emp.achievement.effectiveDeadline === emp.achievement.extensionWindowClosesAt}
                                                    />
                                                )
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
                </div>
            )}

            {/* History modal
                 canExtend is true only when the submission for this type is still
                 MISSING — i.e. there's something actionable to extend toward.
                 For already-submitted or N/A items the modal is read-only. */}
            {histParams && (() => {
                const emp = histParams._emp;
                const type = histParams.type;
                const status = type === 'PLAN' ? emp?.plan?.status : emp?.achievement?.status;
                const canExtend = status === 'MISSING';
                return (
                    <DeadlineHistoryModal
                        params={histParams}
                        canExtend={canExtend}
                        onClose={() => setHistParams(null)}
                        onExtend={() => {
                            setHistParams(null);
                            openExtend(emp, type);
                        }}
                    />
                );
            })()}

            {/* Extend modal */}
            {extendTarget && (
                <ExtendDeadlineModal
                    employee={extendTarget.employee}
                    month={data?.label || fmtMonth(selectedMonth)}
                    monthYear={extendTarget.monthYear}
                    missingType={extendTarget.missingType}
                    originalDeadline={null}
                    onClose={() => setExtendTarget(null)}
                    onConfirm={() => { setExtendTarget(null); load(selectedMonth); }}
                />
            )}
        </>
    );
};

/* ════════════════════════════════════════════════════════════
   ExtendDeadlineManagementPage   (main export)
════════════════════════════════════════════════════════════ */
const ExtendDeadlineManagementPage = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('outstanding');
    const [outstandingCount, setOutstandingCount] = useState(null);

    // Fetch actionable count for the Outstanding badge
    useEffect(() => {
        api.get('/ra/missed-deadlines')
            .then(r => setOutstandingCount(r.data?.totalCount ?? 0))
            .catch(() => setOutstandingCount(0));
    }, []);

    return (
        <div className="edmp-page">
            {/* Header */}
            <div className="edmp-header">
                <h1 className="edmp-title">
                    <FiClock className="edmp-title-icon" />
                    Deadline Management
                </h1>
                <p className="edmp-subtitle">
                    Grant, review, and track submission deadline extensions for your team.
                </p>
            </div>

            {/* Tabs */}
            <div className="edmp-tabs">
                <button
                    id="edmp-tab-outstanding"
                    className={`edmp-tab ${activeTab === 'outstanding' ? 'active' : ''}`}
                    onClick={() => setActiveTab('outstanding')}
                >
                    <FiAlertTriangle size={14} />
                    Outstanding
                    {outstandingCount > 0 && (
                        <span className="edmp-tab-badge">{outstandingCount}</span>
                    )}
                </button>
                <button
                    id="edmp-tab-by-month"
                    className={`edmp-tab ${activeTab === 'byMonth' ? 'active' : ''}`}
                    onClick={() => setActiveTab('byMonth')}
                >
                    <FiCalendar size={14} />
                    By Month
                </button>
            </div>

            {/* Tab content */}
            {activeTab === 'outstanding' && <OutstandingTab />}
            {activeTab === 'byMonth' && <ByMonthTab />}
        </div>
    );
};

export default ExtendDeadlineManagementPage;