import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './RAMonthlyEvaluation.css';
import {
    FiFilter, FiSearch, FiStar, FiEye, FiX, FiUsers, FiClock,
    FiCheckCircle, FiTrendingUp, FiClipboard, FiMessageSquare,
    FiDownload, FiChevronUp, FiChevronDown, FiChevronLeft,
    FiChevronRight, FiAward, FiCalendar, FiAlertCircle,
} from 'react-icons/fi';

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const getInitials = (name = '') =>
    name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const getScoreColor = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 8) return 'score-high';
    if (score >= 5) return 'score-mid';
    return 'score-low';
};

const getScoreLabel = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 8) return 'Excellent';
    if (score >= 5) return 'Good';
    return 'Needs Improvement';
};

const formatMonthLabel = (monthStr) => {
    if (!monthStr) return '-';
    const [year, month] = monthStr.split('-');
    return new Date(Number(year), Number(month) - 1).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
    });
};

/* ─────────────────────────────────────────
   SUMMARY CARD
───────────────────────────────────────── */
const SummaryCard = ({ icon, value, label, subtitle, color, trend }) => (
    <div className={`meval-kpi-card meval-kpi-card--${color}`}>
        <div className="meval-kpi-top">
            <div className={`meval-kpi-icon meval-kpi-icon--${color}`}>{icon}</div>
            <strong className="meval-kpi-value">{value}</strong>
        </div>
        <div className="meval-kpi-bottom">
            <span className="meval-kpi-label">{label}</span>
            {subtitle && <span className="meval-kpi-sub">{subtitle}</span>}
        </div>
    </div>
);

/* ─────────────────────────────────────────
   STATUS BADGE
───────────────────────────────────────── */
const StatusBadge = ({ status }) => {
    const isEvaluated = status === 'EVALUATED';
    return (
        <span className={`meval-badge ${isEvaluated ? 'meval-badge--evaluated' : 'meval-badge--pending'}`}>
            {isEvaluated ? <FiCheckCircle size={10} /> : <FiClock size={10} />}
            {isEvaluated ? 'Evaluated' : 'Pending'}
        </span>
    );
};

/* ─────────────────────────────────────────
   SCORE BAR (table)
───────────────────────────────────────── */
const ScoreBar = ({ score }) => {
    if (score === null || score === undefined) return <span className="meval-score-dash">—</span>;
    const cls = getScoreColor(score);
    return (
        <div className="meval-score-wrap">
            <span className={`meval-score-num ${cls}`}>
                {score}<span className="meval-score-denom">/10</span>
            </span>
            <div className="meval-score-bar-track">
                <div className={`meval-score-bar-fill ${cls}`} style={{ width: `${(score / 10) * 100}%` }} />
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   EXPANDABLE TEXT
───────────────────────────────────────── */
const ExpandableText = ({ text, limit = 280 }) => {
    const [expanded, setExpanded] = useState(false);
    if (!text) return <span className="meval-empty-text">Not provided</span>;
    const isLong = text.length > limit;
    const displayed = isLong && !expanded ? text.slice(0, limit) + '…' : text;
    return (
        <div className="meval-expandable">
            <p className="meval-expand-text">{displayed}</p>
            {isLong && (
                <button type="button" className="meval-expand-btn" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? 'Show Less ↑' : 'Read More ↓'}
                </button>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   DETAIL MODAL
───────────────────────────────────────── */
const DetailModal = ({ detail, detailLoading, onClose }) => {
    if (!detail && !detailLoading) return null;

    return (
        <div className="meval-overlay" onClick={onClose}>
            <div className="meval-modal meval-modal--detail" onClick={(e) => e.stopPropagation()}>

                <div className="meval-modal-header">
                    <div className="meval-modal-header-left">
                        <div className="meval-modal-avatar">{getInitials(detail?.employee?.name || '?')}</div>
                        <div>
                            <h2 className="meval-modal-title">Evaluation Details</h2>
                            {detail?.employee && (
                                <p className="meval-modal-subtitle">
                                    {detail.employee.name} &bull; {detail.employee.employeeCode} &bull; {detail.employee.department}
                                </p>
                            )}
                        </div>
                    </div>
                    <button className="meval-modal-close" onClick={onClose} aria-label="Close"><FiX /></button>
                </div>

                <div className="meval-modal-body">
                    {detailLoading ? (
                        <div className="meval-loading">
                            <div className="meval-spinner" />
                            <p>Loading details…</p>
                        </div>
                    ) : (
                        <>
                            <div className="meval-detail-section">
                                <div className="meval-detail-section-head">
                                    <FiClipboard className="meval-detail-section-icon" />
                                    <h3>Plan Details</h3>
                                </div>
                                <div className="meval-detail-section-body">
                                    <ExpandableText text={detail?.plan?.planDetails} />
                                </div>
                            </div>

                            <div className="meval-detail-section">
                                <div className="meval-detail-section-head">
                                    <FiTrendingUp className="meval-detail-section-icon meval-icon--teal" />
                                    <h3>Achievement</h3>
                                </div>
                                <div className="meval-detail-section-body">
                                    <ExpandableText text={detail?.achievement?.achievementDetails} />
                                </div>
                            </div>

                            {detail?.score !== null && detail?.score !== undefined && (
                                <div className="meval-detail-section meval-detail-section--score">
                                    <div className="meval-detail-section-head">
                                        <FiAward className={`meval-detail-section-icon ${getScoreColor(detail.score)}`} />
                                        <h3>RA Score</h3>
                                    </div>
                                    <div className="meval-detail-score-display">
                                        <span className={`meval-big-score ${getScoreColor(detail.score)}`}>{detail.score}</span>
                                        <span className="meval-big-score-denom">/10</span>
                                        <span className={`meval-score-label-chip ${getScoreColor(detail.score)}`}>
                                            {getScoreLabel(detail.score)}
                                        </span>
                                    </div>
                                    <div className="meval-score-bar-large-track">
                                        <div
                                            className={`meval-score-bar-large-fill ${getScoreColor(detail.score)}`}
                                            style={{ width: `${(detail.score / 10) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {detail?.remarks && (
                                <div className="meval-detail-section">
                                    <div className="meval-detail-section-head">
                                        <FiMessageSquare className="meval-detail-section-icon meval-icon--orange" />
                                        <h3>RA Remarks</h3>
                                    </div>
                                    <div className="meval-detail-section-body">
                                        <ExpandableText text={detail.remarks} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="meval-modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   EVALUATE MODAL
───────────────────────────────────────── */
const EvaluateModal = ({ item, onClose, onSubmit, submitting }) => {
    const [score, setScore] = useState('');
    const [remarks, setRemarks] = useState('');
    const MAX_REMARKS = 500;

    const handleScoreChange = (e) => {
        const val = e.target.value;
        if (val === '') { setScore(''); return; }
        const num = parseInt(val, 10);
        if (!isNaN(num)) setScore(Math.min(10, Math.max(1, num)));
    };

    const parsedScore = score === '' ? null : Number(score);
    const scoreColor = getScoreColor(parsedScore);
    const scoreLabel = getScoreLabel(parsedScore);
    const isValid = parsedScore >= 1 && parsedScore <= 10;

    const handleSubmit = () => {
        if (!isValid) { toast.error('Please enter a score between 1 and 10'); return; }
        onSubmit({ score: parsedScore, remarks });
    };

    return (
        <div className="meval-overlay" onClick={onClose}>
            <div className="meval-modal meval-modal--evaluate" onClick={(e) => e.stopPropagation()}>

                <div className="meval-modal-header">
                    <div className="meval-modal-header-left">
                        <div className="meval-modal-avatar">{getInitials(item?.employee?.name || '?')}</div>
                        <div>
                            <h2 className="meval-modal-title">Submit Evaluation</h2>
                            {item?.employee && (
                                <p className="meval-modal-subtitle">
                                    {item.employee.name} &bull; {formatMonthLabel(item.month)}
                                </p>
                            )}
                        </div>
                    </div>
                    <button className="meval-modal-close" onClick={onClose} aria-label="Close"><FiX /></button>
                </div>

                <div className="meval-modal-body">
                    <div className="meval-form-section">
                        <label className="meval-form-label" htmlFor="meval-score-input">
                            Score (1–10) <span className="meval-required">*</span>
                        </label>
                        <div className="meval-score-field-row">
                            <input
                                id="meval-score-input"
                                type="number"
                                min="1"
                                max="10"
                                step="1"
                                className={`meval-score-field${isValid ? ' ' + scoreColor : ''}`}
                                value={score}
                                onChange={handleScoreChange}
                                placeholder="0"
                                autoComplete="off"
                            />
                            <span className="meval-score-field-denom">/10</span>
                            {isValid && (
                                <span className={`meval-score-label-chip ${scoreColor}`}>{scoreLabel}</span>
                            )}
                        </div>
                        {isValid && (
                            <div className="meval-score-bar-track meval-score-bar-track--lg">
                                <div
                                    className={`meval-score-bar-fill ${scoreColor}`}
                                    style={{ width: `${(parsedScore / 10) * 100}%`, transition: 'width 0.35s ease' }}
                                />
                            </div>
                        )}
                        {!isValid && score !== '' && (
                            <p className="meval-field-hint"><FiAlertCircle size={12} /> Enter a value between 1 and 10</p>
                        )}
                    </div>

                    <div className="meval-form-section">
                        <div className="meval-form-label-row">
                            <label className="meval-form-label" htmlFor="meval-remarks-input">
                                Remarks <span className="meval-optional">(optional)</span>
                            </label>
                            <span className={`meval-char-counter ${remarks.length > MAX_REMARKS * 0.9 ? 'meval-char-counter--warn' : ''}`}>
                                {remarks.length}/{MAX_REMARKS}
                            </span>
                        </div>
                        <textarea
                            id="meval-remarks-input"
                            className="meval-textarea"
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value.slice(0, MAX_REMARKS))}
                            placeholder="Provide concise feedback on performance, delivery, and ownership…"
                            rows={5}
                        />
                    </div>
                </div>

                <div className="meval-modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !isValid}>
                        {submitting
                            ? <><span className="meval-btn-spinner" /> Submitting…</>
                            : <><FiCheckCircle /> Submit Evaluation</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
const ROWS_PER_PAGE = 10;

const RAMonthlyEvaluationPage = () => {
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [search, setSearch] = useState('');
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(1);
    const [detailItem, setDetailItem] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [evaluatingItem, setEvaluatingItem] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const fetchEvaluations = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/monthly-evaluations', { params: { month: filterMonth } });
            setEvaluations(res.data?.data || []);
            setPage(1);
        } catch { toast.error('Failed to load evaluations'); }
        finally { setLoading(false); }
    }, [filterMonth]);

    useEffect(() => { fetchEvaluations(); }, [fetchEvaluations]);

    const total = evaluations.length;
    const evaluated = evaluations.filter((e) => e.status === 'EVALUATED').length;
    const pending = total - evaluated;
    const completion = total > 0 ? Math.round((evaluated / total) * 100) : 0;

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = evaluations.filter((ev) => {
            if (!q) return true;
            return [ev.employee?.name, ev.employee?.employeeCode, ev.employee?.department]
                .filter(Boolean).some((v) => v.toLowerCase().includes(q));
        });
        list = [...list].sort((a, b) => {
            let aVal, bVal;
            if (sortField === 'name') { aVal = a.employee?.name || ''; bVal = b.employee?.name || ''; }
            else if (sortField === 'score') { aVal = a.score ?? -1; bVal = b.score ?? -1; }
            else if (sortField === 'status') { aVal = a.status || ''; bVal = b.status || ''; }
            else { aVal = a.month || ''; bVal = b.month || ''; }
            const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [evaluations, search, sortField, sortDir]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

    const toggleSort = (field) => {
        if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortField(field); setSortDir('asc'); }
    };

    const SortIcon = ({ field }) => {
        if (sortField !== field) return <span className="meval-sort-neutral">⇅</span>;
        return sortDir === 'asc'
            ? <FiChevronUp className="meval-sort-active" />
            : <FiChevronDown className="meval-sort-active" />;
    };

    const openDetail = async (ev) => {
        setDetailItem(ev); setDetailData(null); setDetailLoading(true);
        try {
            const res = await api.get(`/ra/monthly-evaluations/${ev._id}`);
            setDetailData({ ...res.data, employee: ev.employee });
        } catch { toast.error('Failed to load details'); }
        finally { setDetailLoading(false); }
    };

    const closeDetail = () => { setDetailItem(null); setDetailData(null); };

    const handleEvaluate = async ({ score, remarks }) => {
        setSubmitting(true);
        try {
            await api.post('/ra/monthly-evaluation', {
                evaluationId: evaluatingItem._id,
                score: Number(score),
                remarks,
            });
            toast.success('Evaluation submitted successfully!');
            setEvaluatingItem(null);
            fetchEvaluations();
        } catch (err) { toast.error(err.response?.data?.message || 'Evaluation failed'); }
        finally { setSubmitting(false); }
    };

    return (
        <div className="meval-page fade-in">

            {/* ── COMPACT HEADER ── */}
            <div className="meval-topbar">
                <div className="meval-topbar-left">
                    <div className="meval-topbar-eyebrow">
                        <FiCalendar size={11} />
                        Monthly Evaluation
                    </div>
                    <h1 className="meval-topbar-title">Employee Evaluations</h1>
                    <p className="meval-topbar-desc">
                        Review plan submissions and score your direct reports for {formatMonthLabel(filterMonth)}.
                    </p>
                </div>
                <button
                    className="btn btn-secondary meval-export-btn"
                    onClick={() => toast('PDF export coming soon!', { icon: '📄' })}
                >
                    <FiDownload size={14} /> Export
                </button>
            </div>

            {/* ── KPI STRIP ── */}
            <div className="meval-kpi-strip">
                <SummaryCard icon={<FiUsers size={16} />} value={total} label="Total" subtitle="Employees" color="blue" />
                <SummaryCard icon={<FiClock size={16} />} value={pending} label="Pending" subtitle="Awaiting evaluation" color="amber" />
                <SummaryCard icon={<FiCheckCircle size={16} />} value={evaluated} label="Evaluated" subtitle="This month" color="green" />
                <SummaryCard icon={<FiTrendingUp size={16} />} value={`${completion}%`} label="Completion" subtitle={`${evaluated}/${total} done`} color="orange" />
            </div>

            {/* ── FILTER TOOLBAR ── */}
            <div className="meval-toolbar">
                <div className="meval-filter-group">
                    <FiFilter size={13} className="meval-filter-icon" />
                    <label htmlFor="meval-month-filter" className="meval-filter-label">Month</label>
                    <input
                        id="meval-month-filter"
                        type="month"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="meval-month-input"
                    />
                </div>
                <div className="meval-toolbar-divider" />
                <div className="meval-search-wrap">
                    <FiSearch size={13} className="meval-search-icon" />
                    <input
                        type="text"
                        className="meval-search-input"
                        placeholder="Search by name, code, or department…"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    />
                    {search && (
                        <button className="meval-search-clear" onClick={() => { setSearch(''); setPage(1); }} aria-label="Clear search">
                            <FiX size={12} />
                        </button>
                    )}
                </div>
                <span className="meval-result-count">
                    {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* ── EVALUATION TABLE CARD ── */}
            <div className="meval-table-card">
                <div className="meval-table-card-header">
                    <div>
                        <h3 className="meval-table-card-title">Evaluation Queue</h3>
                        <p className="meval-table-card-sub">Click any row to view details · Use Evaluate to score</p>
                    </div>
                    <span className={`meval-badge ${pending > 0 ? 'meval-badge--pending' : 'meval-badge--evaluated'}`}>
                        {pending > 0 ? `${pending} Pending` : '✓ All Done'}
                    </span>
                </div>

                {loading ? (
                    <div className="meval-loading">
                        <div className="meval-spinner" />
                        <p>Loading evaluations…</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="meval-empty">
                        <div className="meval-empty-icon">📭</div>
                        <h3>No evaluations found</h3>
                        <p>{search ? 'Try a different name, code, or department.' : 'No monthly plan submissions for this period.'}</p>
                    </div>
                ) : (
                    <>
                        {/* Head */}
                        <div className="meval-table-head">
                            <div onClick={() => toggleSort('name')}>Employee <SortIcon field="name" /></div>
                            <div>Month</div>
                            <div onClick={() => toggleSort('score')}>Score <SortIcon field="score" /></div>
                            <div onClick={() => toggleSort('status')}>Status <SortIcon field="status" /></div>
                            <div className="meval-col-actions-head">Actions</div>
                        </div>

                        {/* Rows */}
                        <div className="meval-table-body">
                            {pageRows.map((ev, idx) => (
                                <div
                                    key={ev._id}
                                    className="meval-table-row"
                                    onClick={() => openDetail(ev)}
                                    style={{ animationDelay: `${idx * 35}ms` }}
                                >
                                    {/* Employee */}
                                    <div className="meval-cell meval-cell--employee">
                                        <div className="meval-avatar">{getInitials(ev.employee?.name)}</div>
                                        <div className="meval-employee-info">
                                            <strong>{ev.employee?.name || 'Unknown'}</strong>
                                            <span>{ev.employee?.employeeCode} &bull; {ev.employee?.department}</span>
                                        </div>
                                    </div>

                                    {/* Month */}
                                    <div className="meval-cell meval-cell--month">
                                        <FiCalendar size={12} className="meval-cell-icon" />
                                        {formatMonthLabel(ev.month)}
                                    </div>

                                    {/* Score */}
                                    <div className="meval-cell">
                                        <ScoreBar score={ev.score} />
                                    </div>

                                    {/* Status */}
                                    <div className="meval-cell">
                                        <StatusBadge status={ev.status} />
                                    </div>

                                    {/* Actions */}
                                    <div className="meval-cell meval-cell--actions" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => openDetail(ev)}
                                        >
                                            <FiEye size={13} /> View
                                        </button>
                                        {ev.status !== 'EVALUATED' && (
                                            <button
                                                className="btn btn-sm btn-primary"
                                                onClick={() => setEvaluatingItem(ev)}
                                            >
                                                <FiStar size={13} /> Evaluate
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="meval-pagination">
                                <span className="meval-page-info">
                                    Page {safePage} of {totalPages} &nbsp;·&nbsp; {filtered.length} employees
                                </span>
                                <div className="meval-page-btns">
                                    <button className="meval-page-btn" disabled={safePage === 1}
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                        <FiChevronLeft size={14} />
                                    </button>
                                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                                        .reduce((acc, n, idx, arr) => {
                                            if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…');
                                            acc.push(n);
                                            return acc;
                                        }, [])
                                        .map((item, i) => item === '…'
                                            ? <span key={`e-${i}`} className="meval-page-ellipsis">…</span>
                                            : <button key={item}
                                                className={`meval-page-btn ${item === safePage ? 'meval-page-btn--active' : ''}`}
                                                onClick={() => setPage(item)}>{item}</button>
                                        )}
                                    <button className="meval-page-btn" disabled={safePage === totalPages}
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                        <FiChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modals */}
            {detailItem && (
                <DetailModal detail={detailData} detailLoading={detailLoading} onClose={closeDetail} />
            )}
            {evaluatingItem && (
                <EvaluateModal
                    item={evaluatingItem}
                    onClose={() => setEvaluatingItem(null)}
                    onSubmit={handleEvaluate}
                    submitting={submitting}
                />
            )}
        </div>
    );
};

export default RAMonthlyEvaluationPage;