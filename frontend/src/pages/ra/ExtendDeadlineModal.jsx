import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';

/* ════════════════════════════════════════════════════════════
   ExtendDeadlineModal
   Props:
     - employee: { _id, name, employeeCode, department }
     - month: string  "May 2026"
     - monthYear: { month: number (1-12), year: number }
     - missingType: "plan" | "achievement"
     - originalDeadline: Date | null
     - onClose: () => void
     - onConfirm: (newDeadline, reason, notify, employeeName) => void  (called after success)
   ════════════════════════════════════════════════════════════ */
const ExtendDeadlineModal = ({
    employee,
    month,
    monthYear,
    missingType,
    originalDeadline,
    onClose,
    onConfirm,
}) => {
    const [newDeadline, setNewDeadline] = useState('');
    const [reason, setReason] = useState('');
    const [notify, setNotify] = useState(true);
    const [loading, setLoading] = useState(false);
    const [apiError, setApiError] = useState('');

    /* ── Compute date constraints ── */
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    /* Last day of the selected month */
    const lastDayOfMonth = monthYear
        ? new Date(monthYear.year, monthYear.month, 0).toISOString().split('T')[0]
        : '';

    /* ── Derived state ── */
    const reasonLen = reason.length;
    const reasonValid = reason.trim().length >= 10 && reason.trim().length <= 200;
    const deadlineValid = !!newDeadline && newDeadline >= todayStr && (!lastDayOfMonth || newDeadline <= lastDayOfMonth);
    const canConfirm = reasonValid && deadlineValid;

    /* ── Avatar initials ── */
    const getInitials = (name = '') =>
        name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

    /* ── Format original deadline ── */
    const formatDate = (d) => {
        if (!d) return 'Not set';
        try {
            return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch {
            return 'Invalid date';
        }
    };

    /* ── Handle confirm ── */
    const handleConfirm = async () => {
        if (!canConfirm) return;
        setApiError('');
        setLoading(true);
        try {
            await api.patch('/ra/extend-deadline', {
                employeeId: employee._id,
                month: monthYear?.month,
                year: monthYear?.year,
                type: missingType,
                newDeadline: new Date(newDeadline).toISOString(),
                reason: reason.trim(),
                notifyEmployee: notify,
            });
            toast.success(`Deadline extended for ${employee.name}. They have been notified.`);
            if (onConfirm) onConfirm(new Date(newDeadline), reason.trim(), notify, employee.name);
            onClose();
        } catch (err) {
            setApiError(err.response?.data?.message || 'Failed to extend deadline. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    /* ── Stop scroll on body ── */
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    /* ── Backdrop click ── */
    const handleBackdrop = (e) => {
        if (!loading) onClose();
    };

    return createPortal(
        <div
            className="edm-overlay"
            onClick={handleBackdrop}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1300,
                padding: '20px',
            }}
        >
            <div
                className="edm-modal"
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: '480px',
                    background: '#fff',
                    borderRadius: '12px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    animation: 'edmSlideUp 0.24s cubic-bezier(0.22,1,0.36,1) forwards',
                    maxHeight: '92vh',
                }}
            >
                {/* ── Header ── */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: '1px solid #F3F4F6',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.1rem' }}>⏱</span>
                        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
                            Extend Submission Deadline
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            color: '#6B7280',
                            fontSize: '1.1rem',
                            padding: '4px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#F3F4F6'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        ✕
                    </button>
                </div>

                {/* ── Scrollable Body ── */}
                <div style={{ overflowY: 'auto', flex: 1, padding: '20px' }}>

                    {/* Employee info row */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: '#F9FAFB',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        border: '1px solid #E5E7EB',
                    }}>
                        <div style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #F97316, #EA580C)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            flexShrink: 0,
                        }}>
                            {getInitials(employee?.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#111827', marginBottom: '2px' }}>
                                {employee?.name || 'Unknown Employee'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#6B7280', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {employee?.employeeCode && <span>#{employee.employeeCode}</span>}
                                {employee?.department && <><span>·</span><span>{employee.department}</span></>}
                                {month && <><span>·</span><span>{month}</span></>}
                            </div>
                        </div>
                    </div>

                    {/* Extending deadline for pill */}
                    <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
                            Extending deadline for:
                        </div>
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 14px',
                            borderRadius: '9999px',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            ...(missingType === 'plan'
                                ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
                                : { background: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE' }),
                        }}>
                            {missingType === 'plan' ? '📋 Monthly Plan Submission' : '🏆 Achievement Submission'}
                        </span>
                    </div>

                    {/* Deadline row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Original Deadline
                            </label>
                            <div style={{
                                padding: '9px 12px',
                                background: '#F9FAFB',
                                border: '1px solid #E5E7EB',
                                borderRadius: '8px',
                                fontSize: '0.85rem',
                                color: '#6B7280',
                                fontWeight: 500,
                            }}>
                                {formatDate(originalDeadline)}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                New Deadline <span style={{ color: '#EF4444' }}>*</span>
                            </label>
                            <input
                                type="date"
                                value={newDeadline}
                                min={todayStr}
                                max={lastDayOfMonth || undefined}
                                onChange={e => setNewDeadline(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '9px 12px',
                                    border: `1px solid ${newDeadline && !deadlineValid ? '#EF4444' : '#E5E7EB'}`,
                                    borderRadius: '8px',
                                    fontSize: '0.85rem',
                                    color: '#111827',
                                    background: '#fff',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                    cursor: 'pointer',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>
                    </div>

                    {/* Reason textarea */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Reason for Extension <span style={{ color: '#EF4444' }}>*</span>
                            </label>
                            <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: reasonLen > 180 ? '#EF4444' : '#9CA3AF',
                            }}>
                                {reasonLen}/200
                            </span>
                        </div>
                        <textarea
                            rows={3}
                            maxLength={200}
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="e.g. Medical leave, project delay, system issue..."
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${reason.length > 0 && !reasonValid ? '#EF4444' : '#E5E7EB'}`,
                                borderRadius: '8px',
                                fontSize: '0.85rem',
                                color: '#111827',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                outline: 'none',
                                lineHeight: 1.5,
                                boxSizing: 'border-box',
                                transition: 'border-color 0.15s',
                            }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#F97316'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(249,115,22,0.15)'; }}
                            onBlur={e => {
                                e.currentTarget.style.boxShadow = '';
                                e.currentTarget.style.borderColor = (reason.length > 0 && !reasonValid) ? '#EF4444' : '#E5E7EB';
                            }}
                        />
                        {reason.trim().length > 0 && reason.trim().length < 10 && (
                            <div style={{ fontSize: '0.72rem', color: '#EF4444', marginTop: '4px' }}>
                                {10 - reason.trim().length} more character{10 - reason.trim().length !== 1 ? 's' : ''} needed
                            </div>
                        )}
                    </div>

                    {/* Notify checkbox */}
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        color: '#374151',
                        fontWeight: 500,
                        marginBottom: '16px',
                        userSelect: 'none',
                    }}>
                        <input
                            type="checkbox"
                            checked={notify}
                            onChange={e => setNotify(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#F97316', cursor: 'pointer' }}
                        />
                        Notify employee via system notification
                    </label>

                    {/* API error */}
                    {apiError && (
                        <div style={{
                            padding: '10px 14px',
                            background: '#FEF2F2',
                            border: '1px solid #FECACA',
                            borderRadius: '8px',
                            color: '#B91C1C',
                            fontSize: '0.82rem',
                            fontWeight: 500,
                            marginBottom: '4px',
                        }}>
                            ⚠ {apiError}
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '10px',
                    padding: '14px 20px',
                    borderTop: '1px solid #F3F4F6',
                    flexShrink: 0,
                    background: '#FAFAFA',
                }}>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        style={{
                            padding: '8px 18px',
                            border: '1px solid #E5E7EB',
                            borderRadius: '8px',
                            background: 'transparent',
                            color: '#6B7280',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = '#D1D5DB'; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#E5E7EB'; }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm || loading}
                        style={{
                            padding: '8px 18px',
                            border: 'none',
                            borderRadius: '8px',
                            background: '#F97316',
                            color: '#fff',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            cursor: (!canConfirm || loading) ? 'not-allowed' : 'pointer',
                            opacity: (!canConfirm || loading) ? 0.5 : 1,
                            fontFamily: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.15s',
                            minWidth: '160px',
                            justifyContent: 'center',
                        }}
                        onMouseEnter={e => { if (canConfirm && !loading) e.currentTarget.style.background = '#EA580C'; }}
                        onMouseLeave={e => { if (canConfirm && !loading) e.currentTarget.style.background = '#F97316'; }}
                    >
                        {loading ? (
                            <>
                                <span style={{
                                    width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.4)',
                                    borderTopColor: '#fff', borderRadius: '50%',
                                    animation: 'edmSpin 0.65s linear infinite',
                                    display: 'inline-block',
                                }} />
                                Confirming…
                            </>
                        ) : (
                            <>✓ Confirm Extension</>
                        )}
                    </button>
                </div>
            </div>

            {/* Inline keyframes */}
            <style>{`
                @keyframes edmSlideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0)    scale(1);    }
                }
                @keyframes edmSpin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>,
        document.body
    );
};

export default ExtendDeadlineModal;
