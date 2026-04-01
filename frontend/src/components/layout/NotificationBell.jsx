import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { FiBell, FiCheck, FiAlertCircle, FiFileText, FiCalendar, FiAward, FiX } from 'react-icons/fi';
import './NotificationBell.css';

function getIcon(type) {
    switch (type) {
        case 'MONTHLY_PLAN_REJECTED': return <FiAlertCircle style={{ color: '#EF4444' }} />;
        case 'YEARLY_PLAN_REJECTED': return <FiAlertCircle style={{ color: '#EF4444' }} />;
        case 'YEARLY_PLAN_APPROVED': return <FiCheck style={{ color: '#22C55E' }} />;
        case 'MONTHLY_EVALUATED': return <FiFileText style={{ color: '#3B82F6' }} />;
        case 'QUARTERLY_EVALUATED': return <FiCalendar style={{ color: '#A855F7' }} />;
        case 'YEARLY_REPORT_EVALUATED': return <FiAward style={{ color: '#F97316' }} />;
        default: return <FiBell style={{ color: '#64748B' }} />;
    }
}

function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

const NotificationBell = () => {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState({ notifications: [], unreadCount: 0 });
    const ref = useRef(null);

    const fetchNotifications = async () => {
        try {
            const res = await api.get('/notifications');
            setData(res.data);
        } catch { /* silent */ }
    };

    useEffect(() => { fetchNotifications(); const t = setInterval(fetchNotifications, 30000); return () => clearInterval(t); }, []);

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const markAllRead = async () => {
        try {
            await api.put('/notifications/read-all');
            setData(prev => ({
                ...prev,
                unreadCount: 0,
                notifications: prev.notifications.map(n => ({ ...n, read: true }))
            }));
        } catch { /* silent */ }
    };

    const markRead = async (id) => {
        try {
            await api.put(`/notifications/${id}/read`);
            setData(prev => ({
                ...prev,
                unreadCount: Math.max(0, prev.unreadCount - 1),
                notifications: prev.notifications.map(n => n._id === id ? { ...n, read: true } : n)
            }));
        } catch { /* silent */ }
    };

    return (
        <div className="notif-bell-wrap" ref={ref}>
            <button className="notif-bell-btn" onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}>
                <FiBell />
                {data.unreadCount > 0 && (
                    <span className="notif-badge">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>
                )}
            </button>

            {open && (
                <div className="notif-panel">
                    <div className="notif-panel-header">
                        <h4>Notifications</h4>
                        <div className="notif-header-actions">
                            {data.unreadCount > 0 && (
                                <button className="notif-mark-all" onClick={markAllRead}>
                                    <FiCheck /> Mark all read
                                </button>
                            )}
                            <button className="notif-close-btn" onClick={() => setOpen(false)}><FiX /></button>
                        </div>
                    </div>

                    <div className="notif-list">
                        {data.notifications.length === 0 ? (
                            <div className="notif-empty">
                                <FiBell style={{ opacity: 0.2, fontSize: '1.5rem' }} />
                                <p>No notifications yet</p>
                            </div>
                        ) : (
                            data.notifications.map(n => (
                                <div
                                    key={n._id}
                                    className={`notif-item ${n.read ? '' : 'unread'}`}
                                    onClick={() => !n.read && markRead(n._id)}
                                >
                                    <div className="notif-item-icon">{getIcon(n.type)}</div>
                                    <div className="notif-item-body">
                                        <div className="notif-item-title">{n.title}</div>
                                        <div className="notif-item-message">{n.message}</div>
                                        <div className="notif-item-time">{timeAgo(n.createdAt)}</div>
                                    </div>
                                    {!n.read && <div className="notif-unread-dot" />}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
