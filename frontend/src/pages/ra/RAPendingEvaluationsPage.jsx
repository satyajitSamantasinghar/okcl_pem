import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
    FiAlertCircle,
    FiCalendar,
    FiCheckCircle,
    FiClipboard,
    FiClock,
    FiEye,
    FiFilter,
    FiSearch,
    FiStar,
    FiTrendingUp,
    FiUsers,
    FiX,
} from 'react-icons/fi';
import api from '../../services/api';
import './RAPendingEvaluationsPage.css';

const CURRENT_YEAR = new Date().getFullYear();

const buildMonthsForYear = (year) => (
    Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
);

const formatMonth = (monthValue) => {
    if (!monthValue) return '-';
    const [year, month] = monthValue.split('-');
    return new Date(Number(year), Number(month) - 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    });
};

const RAPendingEvaluationsPage = () => {
    const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
    const [searchText, setSearchText] = useState('');
    const [evaluations, setEvaluations] = useState([]);
    const [detailCache, setDetailCache] = useState({});
    const [loading, setLoading] = useState(true);

    const [selectedItem, setSelectedItem] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [modalMode, setModalMode] = useState('view');
    const [score, setScore] = useState('');
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const yearOptions = Array.from({ length: 5 }, (_, index) => String(CURRENT_YEAR - index));

    const fetchPendingEvaluations = async () => {
        setLoading(true);
        try {
            const monthlyResults = await Promise.allSettled(
                buildMonthsForYear(selectedYear).map((month) =>
                    api.get('/ra/monthly-evaluations', {
                        params: { month, limit: 200 },
                    }).then((res) => res.data?.data || [])
                )
            );

            const rawPending = monthlyResults
                .filter((result) => result.status === 'fulfilled')
                .flatMap((result) => result.value)
                .filter((item) => item.status === 'PENDING');

            const detailResults = await Promise.allSettled(
                rawPending.map((item) =>
                    api.get(`/ra/monthly-evaluations/${item._id}`).then((res) => ({
                        item,
                        detail: res.data,
                    }))
                )
            );

            const nextCache = {};
            const validPending = [];

            detailResults.forEach((result) => {
                if (result.status !== 'fulfilled') {
                    return;
                }

                const { item, detail: itemDetail } = result.value;
                if (!itemDetail?.plan) {
                    return;
                }

                nextCache[item._id] = itemDetail;
                validPending.push({
                    ...item,
                    hasAchievement: !!itemDetail.achievement,
                });
            });

            validPending.sort((a, b) => {
                if (a.month === b.month) {
                    return (a.employee?.name || '').localeCompare(b.employee?.name || '');
                }
                return b.month.localeCompare(a.month);
            });

            setDetailCache(nextCache);
            setEvaluations(validPending);
        } catch (err) {
            toast.error('Failed to load pending evaluations');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingEvaluations();
    }, [selectedYear]);

    const filteredEvaluations = evaluations.filter((item) => {
        const query = searchText.trim().toLowerCase();
        if (!query) return true;

        return [
            item.employee?.name,
            item.employee?.employeeCode,
            item.employee?.department,
            formatMonth(item.month),
        ]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(query));
    });

    const employeeCount = new Set(evaluations.map((item) => item.employee?._id).filter(Boolean)).size;
    const achievementReadyCount = evaluations.filter((item) => item.hasAchievement).length;
    const awaitingAchievementCount = evaluations.length - achievementReadyCount;

    const openEvaluationModal = async (item, mode = 'view') => {
        setSelectedItem(item);
        setModalMode(mode);
        setScore('');
        setRemarks('');

        const cachedDetail = detailCache[item._id];
        if (cachedDetail) {
            setDetail(cachedDetail);
            setDetailLoading(false);
            return;
        }

        setDetail(null);
        setDetailLoading(true);

        try {
            const res = await api.get(`/ra/monthly-evaluations/${item._id}`);
            if (!res.data?.plan) {
                toast.error('Monthly plan details are not available for this evaluation');
                setSelectedItem(null);
                return;
            }

            setDetail(res.data);
            setDetailCache((currentCache) => ({
                ...currentCache,
                [item._id]: res.data,
            }));
        } catch (err) {
            toast.error('Failed to load evaluation details');
            setSelectedItem(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const closeModal = () => {
        setSelectedItem(null);
        setDetail(null);
        setScore('');
        setRemarks('');
        setModalMode('view');
    };

    const handleEvaluate = async (e) => {
        e.preventDefault();

        if (!selectedItem) return;

        const numericScore = Number(score);
        if (Number.isNaN(numericScore) || numericScore < 0 || numericScore > 10) {
            toast.error('Score must be between 0 and 10');
            return;
        }

        setSubmitting(true);
        try {
            await api.post('/ra/monthly-evaluation', {
                evaluationId: selectedItem._id,
                score: numericScore,
                remarks,
            });

            toast.success('Evaluation submitted successfully');
            closeModal();
            fetchPendingEvaluations();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to submit evaluation');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="ra-pending-page fade-in">
            <section className="ra-pending-hero">
                <div className="ra-pending-hero-copy">
                    <span className="ra-pending-eyebrow">RA Evaluation Workspace</span>
                    <h1>Pending Evaluations</h1>
                    <p>
                        Review valid pending monthly evaluations for the selected year, inspect plan and achievement details,
                        and complete RA scoring from a single professional workspace.
                    </p>
                </div>

                <div className="ra-pending-toolbar">
                    <div className="ra-pending-year-filter">
                        <FiFilter />
                        <label htmlFor="ra-year-filter">Year</label>
                        <select
                            id="ra-year-filter"
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
                        >
                            {yearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>

                    <div className="ra-pending-search">
                        <FiSearch />
                        <input
                            type="text"
                            placeholder="Search employee, code, department, or month"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                    </div>
                </div>
            </section>

            <div className="ra-pending-summary">
                <div className="ra-pending-summary-card">
                    <div className="ra-pending-summary-icon amber"><FiClock /></div>
                    <div>
                        <span className="ra-pending-summary-label">Pending Reviews</span>
                        <strong>{evaluations.length}</strong>
                        <p>Validated pending items for {selectedYear}</p>
                    </div>
                </div>

                <div className="ra-pending-summary-card">
                    <div className="ra-pending-summary-icon blue"><FiUsers /></div>
                    <div>
                        <span className="ra-pending-summary-label">Employees Impacted</span>
                        <strong>{employeeCount}</strong>
                        <p>Distinct employees with pending RA reviews</p>
                    </div>
                </div>

                <div className="ra-pending-summary-card">
                    <div className="ra-pending-summary-icon green"><FiCheckCircle /></div>
                    <div>
                        <span className="ra-pending-summary-label">Achievement Available</span>
                        <strong>{achievementReadyCount}</strong>
                        <p>Pending items with achievement submissions already attached</p>
                    </div>
                </div>

                <div className="ra-pending-summary-card">
                    <div className="ra-pending-summary-icon rose"><FiAlertCircle /></div>
                    <div>
                        <span className="ra-pending-summary-label">Awaiting Achievement</span>
                        <strong>{awaitingAchievementCount}</strong>
                        <p>Pending items where the monthly plan exists but achievement is still missing</p>
                    </div>
                </div>
            </div>

            <div className="card ra-pending-list-card">
                <div className="card-header ra-pending-list-header">
                    <div>
                        <h3>Current Year Pending Queue</h3>
                        <p className="ra-pending-subtitle">
                            Only valid pending evaluations with an actual monthly plan are shown here for {selectedYear}.
                        </p>
                    </div>
                    <span className="badge badge-pending">{filteredEvaluations.length} Pending</span>
                </div>

                {loading ? (
                    <div className="loading-container">
                        <div className="spinner" />
                        <p>Loading pending evaluations...</p>
                    </div>
                ) : filteredEvaluations.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon"><FiCheckCircle /></div>
                        <h3>No pending evaluations found</h3>
                        <p>There are no valid pending evaluations for the selected year and current filters.</p>
                    </div>
                ) : (
                    <div className="ra-pending-list">
                        <div className="ra-pending-list-head">
                            <span>Employee</span>
                            <span>Month</span>
                            <span>Submission Health</span>
                            <span>Status</span>
                            <span>Actions</span>
                        </div>

                        {filteredEvaluations.map((item) => (
                            <div className="ra-pending-list-row" key={item._id}>
                                <div className="ra-pending-employee">
                                    <strong>{item.employee?.name || 'Unknown Employee'}</strong>
                                    <span>{item.employee?.employeeCode || '-'} • {item.employee?.department || '-'}</span>
                                </div>

                                <div className="ra-pending-cell">
                                    {formatMonth(item.month)}
                                </div>

                                <div className="ra-pending-cell">
                                    <span className={`badge ${item.hasAchievement ? 'badge-approved' : 'badge-pending'}`}>
                                        {item.hasAchievement ? 'Plan + achievement ready' : 'Plan ready, achievement pending'}
                                    </span>
                                </div>

                                <div className="ra-pending-cell">
                                    <span className="badge badge-pending">{item.status}</span>
                                </div>

                                <div className="ra-pending-actions">
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => openEvaluationModal(item, 'view')}
                                    >
                                        <FiEye /> View Detail
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-primary"
                                        onClick={() => openEvaluationModal(item, 'evaluate')}
                                    >
                                        <FiStar /> Evaluate
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedItem && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal ra-pending-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="ra-pending-modal-header">
                            <div>
                                <h2>{selectedItem.employee?.name || 'Employee Evaluation'}</h2>
                                <p>
                                    {selectedItem.employee?.employeeCode || '-'} • {selectedItem.employee?.department || '-'} • {formatMonth(selectedItem.month)}
                                </p>
                            </div>
                            <button type="button" className="ra-pending-close" onClick={closeModal}>
                                <FiX />
                            </button>
                        </div>

                        {detailLoading ? (
                            <div className="loading-container">
                                <div className="spinner" />
                                <p>Loading evaluation details...</p>
                            </div>
                        ) : (
                            <>
                                <div className="ra-pending-detail-grid">
                                    <div className="ra-pending-detail-card">
                                        <div className="ra-pending-detail-head">
                                            <FiClipboard />
                                            <h3>Monthly Plan</h3>
                                        </div>
                                        <div className="ra-pending-detail-body">
                                            {detail?.plan?.planDetails || 'No plan details available.'}
                                        </div>
                                    </div>

                                    <div className="ra-pending-detail-card">
                                        <div className="ra-pending-detail-head">
                                            <FiTrendingUp />
                                            <h3>Monthly Achievement</h3>
                                        </div>
                                        <div className="ra-pending-detail-body">
                                            {detail?.achievement?.achievementDetails || 'No achievement submitted yet.'}
                                        </div>
                                    </div>
                                </div>

                                {modalMode === 'evaluate' ? (
                                    <form className="ra-pending-form" onSubmit={handleEvaluate}>
                                        <div className="ra-pending-form-grid">
                                            <div className="form-group">
                                                <label htmlFor="ra-pending-score">Score</label>
                                                <input
                                                    id="ra-pending-score"
                                                    type="number"
                                                    min="0"
                                                    max="10"
                                                    step="0.5"
                                                    value={score}
                                                    onChange={(e) => setScore(e.target.value)}
                                                    placeholder="Enter score out of 10"
                                                    required
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label htmlFor="ra-pending-month">Month</label>
                                                <input
                                                    id="ra-pending-month"
                                                    type="text"
                                                    value={formatMonth(selectedItem.month)}
                                                    readOnly
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label htmlFor="ra-pending-remarks">Remarks</label>
                                            <textarea
                                                id="ra-pending-remarks"
                                                value={remarks}
                                                onChange={(e) => setRemarks(e.target.value)}
                                                placeholder="Add concise remarks about delivery, ownership, and performance."
                                            />
                                        </div>

                                        <div className="modal-actions">
                                            <button type="button" className="btn btn-secondary" onClick={closeModal}>
                                                Close
                                            </button>
                                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                                {submitting ? 'Submitting...' : 'Submit Evaluation'}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="modal-actions">
                                        <button type="button" className="btn btn-secondary" onClick={closeModal}>
                                            Close
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={() => setModalMode('evaluate')}
                                        >
                                            <FiStar /> Evaluate
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RAPendingEvaluationsPage;
