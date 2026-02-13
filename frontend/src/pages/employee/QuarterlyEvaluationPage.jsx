import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiFilter, FiMessageSquare } from 'react-icons/fi';

const QuarterlyEvaluationPage = () => {
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterQuarter, setFilterQuarter] = useState('');

    useEffect(() => {
        const fetchEvaluations = async () => {
            try {
                const params = {};
                if (filterQuarter) params.quarter = filterQuarter;
                const res = await api.get('/ra/quarterly-evaluations', { params });
                setEvaluations(res.data?.data || []);
            } catch (err) {
                toast.error('Failed to load quarterly evaluations');
            } finally {
                setLoading(false);
            }
        };
        fetchEvaluations();
    }, [filterQuarter]);

    const quarters = ['Q1-2025', 'Q2-2025', 'Q3-2025', 'Q4-2025', 'Q1-2026', 'Q2-2026', 'Q3-2026', 'Q4-2026'];

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
                <h1>Quarterly Evaluation</h1>
                <p>View your quarterly performance remarks from your reporting authority</p>
            </div>

            <div className="filter-bar">
                <FiFilter />
                <select value={filterQuarter} onChange={(e) => setFilterQuarter(e.target.value)}>
                    <option value="">All Quarters</option>
                    {quarters.map((q) => (
                        <option key={q} value={q}>{q}</option>
                    ))}
                </select>
            </div>

            {evaluations.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon"><FiMessageSquare /></div>
                    <h3>No Quarterly Evaluations</h3>
                    <p>No quarterly evaluations have been generated for your account yet.</p>
                </div>
            ) : (
                <div className="cards-grid">
                    {evaluations.map((ev) => (
                        <div key={ev._id} className="card">
                            <div className="card-header">
                                <h3>{ev.quarter}</h3>
                                <span className="badge badge-evaluated">Evaluated</span>
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                                <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                    Remarks
                                </label>
                                <p style={{ fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
                                    {ev.remarks || 'No remarks provided.'}
                                </p>
                            </div>
                            {ev.employee && (
                                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                                    Employee: {ev.employee.name} ({ev.employee.employeeCode})
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default QuarterlyEvaluationPage;
