import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import { FiFileText, FiSearch, FiX, FiEye, FiDownload, FiBookOpen } from 'react-icons/fi';
import './MyManualsPage.css';

// ─────────────────────────────────────────────────────────────────────────────
//  MyManualsPage — shared, read-only, mounted at both /employee/manuals and
//  /ra/manuals (see App.jsx). Hits GET /manuals, which filters server-side to
//  the caller's own DB role (see manualController.js's listMyManuals) — the
//  route prefix here doesn't affect what's returned, only reachability.
// ─────────────────────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const MyManualsPage = () => {
    const [manuals, setManuals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch]   = useState('');
    const [busyId, setBusyId]   = useState(null); // manual id currently being viewed/downloaded

    const fetchManuals = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/manuals');
            setManuals(res.data.manuals || []);
        } catch {
            toast.error('Failed to load manuals');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchManuals(); }, [fetchManuals]);

    const filtered = useMemo(() => {
        if (!search.trim()) return manuals;
        const q = search.trim().toLowerCase();
        return manuals.filter(m =>
            m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
        );
    }, [manuals, search]);

    // Grouped in the order the backend already sorted them (category ASC,
    // displayOrder ASC) — Map preserves first-seen key order, so no
    // additional client-side sort is needed here.
    const grouped = useMemo(() => {
        const map = new Map();
        filtered.forEach(m => {
            if (!map.has(m.category)) map.set(m.category, []);
            map.get(m.category).push(m);
        });
        return Array.from(map.entries());
    }, [filtered]);

    // Files require the Authorization header, so a plain <a href> to the API
    // URL won't work (no way to attach a bearer token to a browser-navigated
    // link) — fetch as a blob through the authenticated api instance instead,
    // same technique as the admin ManualsPage's handleView.
    const fetchBlobUrl = async (manual) => {
        const res = await api.get(`/manuals/${manual.id}/download`, { responseType: 'blob' });
        return URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    };

    const handleView = async (manual) => {
        setBusyId(manual.id);
        try {
            const url = await fetchBlobUrl(manual);
            window.open(url, '_blank');
        } catch {
            toast.error('Failed to open manual.');
        } finally {
            setBusyId(null);
        }
    };

    const handleDownload = async (manual) => {
        setBusyId(manual.id);
        try {
            const url = await fetchBlobUrl(manual);
            const link = document.createElement('a');
            link.href = url;
            link.download = manual.fileName || `${manual.title}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch {
            toast.error('Failed to download manual.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="hlp-root fade-in">
            <div className="hlp-page-header">
                <div className="hlp-page-eyebrow"><FiBookOpen size={12} /> Help Center</div>
                <h1 className="hlp-page-title">Manuals</h1>
                <p className="hlp-page-sub">Guides and reference documents for using this app</p>
            </div>

            <div className="hlp-search-wrap">
                <FiSearch size={13} className="hlp-search-icon" />
                <input
                    type="text"
                    placeholder="Search manuals…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <button className="hlp-search-clear" onClick={() => setSearch('')}><FiX size={12} /></button>
                )}
            </div>

            {loading ? (
                <div className="hlp-loading">
                    <div className="hlp-spinner" />
                    <p>Loading manuals…</p>
                </div>
            ) : grouped.length === 0 ? (
                <div className="hlp-empty">
                    <FiFileText size={32} />
                    <h3>No manuals available yet</h3>
                    <p>{search ? 'Try a different search term.' : "Check back later — your admin hasn't added any manuals yet."}</p>
                </div>
            ) : (
                grouped.map(([category, items]) => (
                    <div key={category} className="hlp-category-section">
                        <h2 className="hlp-category-title">{category}</h2>
                        <div className="hlp-manual-grid">
                            {items.map(m => (
                                <div key={m.id} className="hlp-manual-card">
                                    <div className="hlp-manual-icon"><FiFileText size={20} /></div>
                                    <div className="hlp-manual-info">
                                        <h3>{m.title}</h3>
                                        <p>{m.description}</p>
                                        <span className="hlp-manual-meta">
                                            PDF · {formatFileSize(m.fileSizeBytes)} · Updated {formatDate(m.updatedAt)}
                                        </span>
                                    </div>
                                    <div className="hlp-manual-actions">
                                        <button
                                            className="hlp-btn hlp-btn--primary"
                                            onClick={() => handleView(m)}
                                            disabled={busyId === m.id}
                                        >
                                            {busyId === m.id ? <span className="hlp-btn-spinner" /> : <><FiEye size={13} /> View</>}
                                        </button>
                                        <button
                                            className="hlp-btn hlp-btn--secondary"
                                            onClick={() => handleDownload(m)}
                                            disabled={busyId === m.id}
                                        >
                                            <FiDownload size={13} /> Download
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default MyManualsPage;