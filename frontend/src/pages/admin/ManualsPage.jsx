import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiShield, FiPlus, FiSearch, FiFilter, FiX, FiFileText,
    FiEye, FiEdit2, FiEyeOff, FiUpload,
} from 'react-icons/fi';
import './ManualsPage.css';

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */
// Mirrors backend's MANUAL_ROLES (manualController.js) — duplicated here as a
// UI constant rather than fetched, same precedent as AdminDashboard.jsx's
// STATUS_OPTIONS mirroring the backend's compliance-status enum.
const MANUAL_ROLES = ['EMPLOYEE', 'RA'];

// Suggestions only — category stays a free-text field on the backend so a
// new one never needs a migration. This list just keeps naming consistent.
const CATEGORY_SUGGESTIONS = [
    'Dashboard', 'Monthly Plan & Progress', 'Quarterly Evaluation', 'Yearly Plan', 'General',
];

const STATUS_FILTER_OPTIONS = [
    { value: 'active',   label: 'Active Only' },
    { value: 'inactive', label: 'Hidden Only' },
    { value: 'all',      label: 'All' },
];

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMPTY_FORM = { title: '', description: '', category: '', roles: [], displayOrder: 0 };

/* ─────────────────────────────────────────
   UPLOAD / EDIT MODAL
───────────────────────────────────────── */
const ManualFormModal = ({ mode, initial, onClose, onSaved }) => {
    const [form, setForm]         = useState(initial ?? EMPTY_FORM);
    const [file, setFile]         = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const toggleRole = (role) => {
        setForm(f => ({
            ...f,
            roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!form.title.trim() || !form.description.trim() || !form.category.trim()) {
            toast.error('Title, description, and category are required.');
            return;
        }
        if (form.roles.length === 0) {
            toast.error('Select at least one audience (Employee and/or RA).');
            return;
        }
        if (mode === 'create' && !file) {
            toast.error('A PDF file is required.');
            return;
        }

        const fd = new FormData();
        fd.append('title', form.title.trim());
        fd.append('description', form.description.trim());
        fd.append('category', form.category.trim());
        fd.append('displayOrder', String(form.displayOrder || 0));
        form.roles.forEach(r => fd.append('targetRoles', r));
        if (file) fd.append('file', file);

        setSubmitting(true);
        try {
            const res = mode === 'create'
                ? await api.post('/admin/manuals', fd)
                : await api.patch(`/admin/manuals/${initial.id}`, fd);
            toast.success(res.data?.message || 'Manual saved.');
            onSaved();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to save manual.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mnl-modal-overlay" onClick={onClose}>
            <div className="mnl-modal" onClick={e => e.stopPropagation()}>
                <div className="mnl-modal-header">
                    <h3>{mode === 'create' ? 'Upload Manual' : 'Edit Manual'}</h3>
                    <button className="mnl-modal-close" onClick={onClose}><FiX /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="mnl-modal-body">
                        <div className="mnl-form-group">
                            <label>Title</label>
                            <input
                                type="text"
                                value={form.title}
                                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                placeholder="e.g. How to use the Dashboard"
                                maxLength={200}
                            />
                        </div>

                        <div className="mnl-form-group">
                            <label>Description</label>
                            <textarea
                                value={form.description}
                                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                placeholder="What this manual covers, in a sentence or two"
                                rows={3}
                                maxLength={2000}
                            />
                        </div>

                        <div className="mnl-form-row">
                            <div className="mnl-form-group">
                                <label>Category</label>
                                <input
                                    type="text"
                                    list="mnl-category-suggestions"
                                    value={form.category}
                                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                                    placeholder="e.g. Monthly Plan & Progress"
                                    maxLength={100}
                                />
                                <datalist id="mnl-category-suggestions">
                                    {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
                                </datalist>
                            </div>

                            <div className="mnl-form-group mnl-form-group--narrow">
                                <label>Display Order</label>
                                <input
                                    type="number"
                                    value={form.displayOrder}
                                    onChange={e => setForm(f => ({ ...f, displayOrder: e.target.value }))}
                                    min={0}
                                />
                            </div>
                        </div>

                        <div className="mnl-form-group">
                            <label>Visible to</label>
                            <div className="mnl-role-pills">
                                {MANUAL_ROLES.map(role => (
                                    <button
                                        type="button"
                                        key={role}
                                        className={`mnl-role-pill ${form.roles.includes(role) ? 'mnl-role-pill--active' : ''}`}
                                        onClick={() => toggleRole(role)}
                                    >
                                        {role === 'EMPLOYEE' ? 'Employee' : 'RA'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mnl-form-group">
                            <label>{mode === 'create' ? 'PDF File' : 'Replace PDF File (optional)'}</label>
                            <div className="mnl-file-picker" onClick={() => fileInputRef.current?.click()}>
                                <FiUpload size={14} />
                                <span>
                                    {file ? file.name : (mode === 'edit' ? initial.fileName : 'Choose a PDF file')}
                                </span>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,.pdf"
                                hidden
                                onChange={e => setFile(e.target.files?.[0] || null)}
                            />
                        </div>
                    </div>

                    <div className="mnl-modal-footer">
                        <button type="button" className="mnl-btn-secondary" onClick={onClose} disabled={submitting}>
                            Cancel
                        </button>
                        <button type="submit" className="mnl-btn-primary" disabled={submitting}>
                            {submitting ? 'Saving…' : mode === 'create' ? 'Upload' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const ManualsPage = () => {
    const [manuals, setManuals] = useState([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch]           = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [roleFilter, setRoleFilter]   = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('active');

    const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', manual }
    const [statusUpdatingId, setStatusUpdatingId] = useState(null);
    const [viewingId, setViewingId] = useState(null);

    const fetchManuals = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/manuals');
            setManuals(res.data.manuals || []);
        } catch {
            toast.error('Failed to load manuals');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchManuals(); }, [fetchManuals]);

    const categories = useMemo(
        () => [...new Set(manuals.map(m => m.category))].sort(),
        [manuals]
    );

    const filtered = useMemo(() => {
        return manuals.filter(m => {
            if (statusFilter === 'active' && !m.isActive) return false;
            if (statusFilter === 'inactive' && m.isActive) return false;
            if (categoryFilter && m.category !== categoryFilter) return false;
            if (roleFilter !== 'ALL' && !m.targetRoles.includes(roleFilter)) return false;
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                if (!m.title.toLowerCase().includes(q) && !m.description.toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }, [manuals, search, categoryFilter, roleFilter, statusFilter]);

    const handleToggleStatus = async (manual) => {
        const nextActive = !manual.isActive;
        const confirmMsg = nextActive
            ? `Show "${manual.title}" to its target audience again?`
            : `Hide "${manual.title}"? It will no longer appear for Employees/RAs until shown again.`;
        if (!window.confirm(confirmMsg)) return;

        setStatusUpdatingId(manual.id);
        try {
            const res = await api.patch(`/admin/manuals/${manual.id}/status`, { isActive: nextActive });
            toast.success(res.data?.message || 'Status updated.');
            fetchManuals();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to update status.');
        } finally {
            setStatusUpdatingId(null);
        }
    };

    const handleView = async (manual) => {
        setViewingId(manual.id);
        try {
            const res = await api.get(`/manuals/${manual.id}/download`, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
            // Object URL is intentionally not revoked immediately — the new tab
            // needs it to stay alive to render the PDF.
        } catch {
            toast.error('Failed to open manual.');
        } finally {
            setViewingId(null);
        }
    };

    const clearFilters = () => { setSearch(''); setCategoryFilter(''); setRoleFilter('ALL'); setStatusFilter('active'); };
    const hasFilters = search || categoryFilter || roleFilter !== 'ALL' || statusFilter !== 'active';

    return (
        <div className="mnl-root fade-in">
            {/* ── Page Header ── */}
            <div className="mnl-page-header">
                <div>
                    <div className="mnl-page-eyebrow"><FiShield size={12} /> Admin Console</div>
                    <h1 className="mnl-page-title">Manuals</h1>
                    <p className="mnl-page-sub">Manage the in-app help documents shown to Employees and RAs</p>
                </div>
                <button className="mnl-upload-btn" onClick={() => setModal({ mode: 'create' })}>
                    <FiPlus size={14} /> Upload Manual
                </button>
            </div>

            {/* ── Toolbar ── */}
            <div className="mnl-toolbar">
                <div className="mnl-search-wrap">
                    <FiSearch size={13} className="mnl-search-icon" />
                    <input
                        type="text"
                        placeholder="Search by title or description…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {search && (
                        <button className="mnl-search-clear" onClick={() => setSearch('')}><FiX size={12} /></button>
                    )}
                </div>

                <div className="mnl-filter-group">
                    <label><FiFilter size={12} /> Category</label>
                    <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                        <option value="">All Categories</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div className="mnl-filter-group">
                    <label>Audience</label>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                        <option value="ALL">All Audiences</option>
                        <option value="EMPLOYEE">Employee</option>
                        <option value="RA">RA</option>
                    </select>
                </div>

                <div className="mnl-filter-group">
                    <label>Status</label>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>

                {hasFilters && (
                    <button className="mnl-clear-filters" onClick={clearFilters}>Clear filters</button>
                )}
            </div>

            {/* ── List ── */}
            <div className="mnl-table-card">
                {loading ? (
                    <div className="mnl-loading">
                        <div className="mnl-spinner" />
                        <p>Loading manuals…</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="mnl-empty">
                        <FiFileText size={28} />
                        <h3>No manuals found</h3>
                        <p>{hasFilters ? 'Try adjusting your search or filters.' : 'Upload your first manual to get started.'}</p>
                    </div>
                ) : (
                    <div className="mnl-table-scroll">
                        <div className="mnl-table-head">
                            <div>Manual</div>
                            <div>Category</div>
                            <div>Audience</div>
                            <div>File</div>
                            <div>Status</div>
                            <div>Actions</div>
                        </div>
                        <div className="mnl-table-body">
                            {filtered.map((m, idx) => (
                                <div key={m.id} className="mnl-table-row" style={{ animationDelay: `${idx * 25}ms` }}>
                                    <div className="mnl-cell mnl-cell--title">
                                        <strong>{m.title}</strong>
                                        <span>{m.description}</span>
                                    </div>
                                    <div className="mnl-cell">
                                        <span className="mnl-badge mnl-badge--category">{m.category}</span>
                                    </div>
                                    <div className="mnl-cell mnl-cell--roles">
                                        {m.targetRoles.map(r => (
                                            <span key={r} className="mnl-badge mnl-badge--role">{r === 'EMPLOYEE' ? 'Employee' : 'RA'}</span>
                                        ))}
                                    </div>
                                    <div className="mnl-cell mnl-cell--file">
                                        <span>{m.fileName}</span>
                                        <span className="mnl-file-meta">{formatFileSize(m.fileSizeBytes)} · {formatDate(m.updatedAt)}</span>
                                    </div>
                                    <div className="mnl-cell">
                                        <span className={`mnl-badge ${m.isActive ? 'mnl-badge--active' : 'mnl-badge--inactive'}`}>
                                            {m.isActive ? 'Active' : 'Hidden'}
                                        </span>
                                    </div>
                                    <div className="mnl-cell mnl-cell--actions">
                                        <button className="mnl-action-btn" title="View" onClick={() => handleView(m)} disabled={viewingId === m.id}>
                                            {viewingId === m.id ? <span className="mnl-btn-spinner" /> : <FiEye size={13} />}
                                        </button>
                                        <button className="mnl-action-btn" title="Edit" onClick={() => setModal({ mode: 'edit', manual: {
                                            id: m.id, title: m.title, description: m.description, category: m.category,
                                            roles: m.targetRoles, displayOrder: m.displayOrder, fileName: m.fileName,
                                        } })}>
                                            <FiEdit2 size={13} />
                                        </button>
                                        <button
                                            className="mnl-action-btn"
                                            title={m.isActive ? 'Hide' : 'Show'}
                                            onClick={() => handleToggleStatus(m)}
                                            disabled={statusUpdatingId === m.id}
                                        >
                                            {statusUpdatingId === m.id
                                                ? <span className="mnl-btn-spinner" />
                                                : m.isActive ? <FiEyeOff size={13} /> : <FiEye size={13} />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {modal && (
                <ManualFormModal
                    mode={modal.mode}
                    initial={modal.mode === 'edit' ? modal.manual : null}
                    onClose={() => setModal(null)}
                    onSaved={() => { setModal(null); fetchManuals(); }}
                />
            )}
        </div>
    );
};

export default ManualsPage;