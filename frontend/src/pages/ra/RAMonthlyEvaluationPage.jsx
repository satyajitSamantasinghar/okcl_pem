import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiFilter, FiStar, FiMessageSquare, FiEye } from 'react-icons/fi';

const RAMonthlyEvaluationPage = () => {
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    // Evaluation form state
    const [evaluatingId, setEvaluatingId] = useState(null);
    const [score, setScore] = useState('');
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Detail view state
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchEvaluations = async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/monthly-evaluations', { params: { month: filterMonth } });
            setEvaluations(res.data?.data || []);
        } catch (err) {
            toast.error('Failed to load evaluations');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEvaluations();
    }, [filterMonth]);

    const handleEvaluate = async (e) => {
        e.preventDefault();
        if (!score || score < 0 || score > 10) {
            toast.error('Score must be between 0 and 10');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/ra/monthly-evaluation', {
                evaluationId: evaluatingId,
                score: Number(score),
                remarks,
            });
            toast.success('Evaluation submitted successfully!');
            setEvaluatingId(null);
            setScore('');
            setRemarks('');
            fetchEvaluations();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Evaluation failed');
        } finally {
            setSubmitting(false);
        }
    };

    const viewDetail = async (id) => {
        setDetailLoading(true);
        try {
            const res = await api.get(`/ra/monthly-evaluations/${id}`);
            setSelectedDetail(res.data);
        } catch (err) {
            toast.error('Failed to load details');
        } finally {
            setDetailLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading evaluations...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Monthly Evaluation</h1>
                <p>Review employee monthly submissions and provide evaluation marks and remarks</p>
            </div>

            <div className="filter-bar">
                <FiFilter />
                <input
                    type="month"
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                />
            </div>

            {/* Detail Modal */}
            {selectedDetail && (
                <div className="modal-overlay" onClick={() => setSelectedDetail(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Evaluation Details</h2>
                        {detailLoading ? (
                            <div className="loading-container"><div className="spinner" /></div>
                        ) : (
                            <>
                                <div className="form-group">
                                    <label>Plan Details</label>
                                    <div className="card" style={{ background: 'var(--bg-muted)', border: 'none', padding: '16px' }}>
                                        {selectedDetail.plan?.planDetails || 'No plan details'}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Achievement</label>
                                    <div className="card" style={{ background: 'var(--bg-muted)', border: 'none', padding: '16px' }}>
                                        {selectedDetail.achievement?.achievementDetails || 'No achievement submitted yet'}
                                    </div>
                                </div>
                                {selectedDetail.remarks && (
                                    <div className="form-group">
                                        <label>RA Remarks</label>
                                        <p>{selectedDetail.remarks}</p>
                                    </div>
                                )}
                                {selectedDetail.score !== null && (
                                    <div className="form-group">
                                        <label>Score</label>
                                        <p style={{ fontWeight: '700', fontSize: '1.25rem', color: 'var(--primary)' }}>{selectedDetail.score}/10</p>
                                    </div>
                                )}
                            </>
                        )}
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setSelectedDetail(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Evaluation Form Modal */}
            {evaluatingId && (
                <div className="modal-overlay" onClick={() => setEvaluatingId(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Submit Evaluation</h2>
                        <form onSubmit={handleEvaluate}>
                            <div className="form-group">
                                <label>Score (0-10)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.5"
                                    value={score}
                                    onChange={(e) => setScore(e.target.value)}
                                    required
                                    placeholder="Enter score..."
                                />
                            </div>
                            <div className="form-group">
                                <label>Remarks</label>
                                <textarea
                                    value={remarks}
                                    onChange={(e) => setRemarks(e.target.value)}
                                    placeholder="Provide feedback and remarks..."
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setEvaluatingId(null)}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? 'Submitting...' : 'Submit Evaluation'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Evaluations Table */}
            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Month</th>
                            <th>Score</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {evaluations.length === 0 ? (
                            <tr>
                                <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                    No evaluations found for this month
                                </td>
                            </tr>
                        ) : (
                            evaluations.map((ev) => (
                                <tr key={ev._id}>
                                    <td>
                                        <strong>{ev.employee?.name || 'Unknown'}</strong>
                                        <br />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            {ev.employee?.employeeCode} • {ev.employee?.department}
                                        </span>
                                    </td>
                                    <td>{ev.month}</td>
                                    <td>
                                        {ev.score !== null && ev.score !== undefined ? (
                                            <strong style={{ color: 'var(--primary)' }}>{ev.score}/10</strong>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                                        )}
                                    </td>
                                    <td>
                                        <span className={`badge ${ev.status === 'EVALUATED' ? 'badge-evaluated' : 'badge-pending'}`}>
                                            {ev.status}
                                        </span>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-sm btn-secondary" onClick={() => viewDetail(ev._id)}>
                                                <FiEye /> View
                                            </button>
                                            {ev.status !== 'EVALUATED' && (
                                                <button className="btn btn-sm btn-primary" onClick={() => setEvaluatingId(ev._id)}>
                                                    <FiStar /> Evaluate
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RAMonthlyEvaluationPage;
