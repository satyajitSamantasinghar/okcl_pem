import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiFilter, FiPlusCircle } from 'react-icons/fi';

const RAQuarterlyEvaluationPage = () => {
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterQuarter, setFilterQuarter] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form
    const [employeeId, setEmployeeId] = useState('');
    const [quarter, setQuarter] = useState('');
    const [months, setMonths] = useState(['', '', '']);
    const [remarks, setRemarks] = useState('');

    const fetchEvaluations = async () => {
        setLoading(true);
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

    useEffect(() => {
        fetchEvaluations();
    }, [filterQuarter]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!employeeId || !quarter || months.some((m) => !m)) {
            toast.error('Please fill all fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/ra/quarterly-evaluation', {
                employeeId,
                quarter,
                months,
                remarks,
            });
            toast.success('Quarterly evaluation generated!');
            setShowForm(false);
            setEmployeeId('');
            setQuarter('');
            setMonths(['', '', '']);
            setRemarks('');
            fetchEvaluations();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to generate');
        } finally {
            setSubmitting(false);
        }
    };

    const quarters = ['Q1-2025', 'Q2-2025', 'Q3-2025', 'Q4-2025', 'Q1-2026', 'Q2-2026', 'Q3-2026', 'Q4-2026'];

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading quarterly evaluations...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Quarterly Evaluation</h1>
                <p>Generate quarterly evaluations from monthly performance data</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
                    <FiPlusCircle /> Generate Quarterly Evaluation
                </button>
            </div>

            {showForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Generate Quarterly Evaluation</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Employee ID</label>
                            <input
                                type="text"
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                                placeholder="Enter employee's MongoDB ID..."
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Quarter</label>
                            <select value={quarter} onChange={(e) => setQuarter(e.target.value)} required>
                                <option value="">Select Quarter</option>
                                {quarters.map((q) => (
                                    <option key={q} value={q}>{q}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Three Months (evaluated)</label>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                {months.map((m, i) => (
                                    <input
                                        key={i}
                                        type="month"
                                        value={m}
                                        onChange={(e) => {
                                            const newMonths = [...months];
                                            newMonths[i] = e.target.value;
                                            setMonths(newMonths);
                                        }}
                                        required
                                        style={{ flex: '1', minWidth: '150px' }}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Remarks</label>
                            <textarea
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                placeholder="Quarterly performance summary..."
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Generating...' : 'Generate'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="filter-bar">
                <FiFilter />
                <select value={filterQuarter} onChange={(e) => setFilterQuarter(e.target.value)}>
                    <option value="">All Quarters</option>
                    {quarters.map((q) => (
                        <option key={q} value={q}>{q}</option>
                    ))}
                </select>
            </div>

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Quarter</th>
                            <th>Average Score</th>
                            <th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {evaluations.length === 0 ? (
                            <tr>
                                <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                    No quarterly evaluations found
                                </td>
                            </tr>
                        ) : (
                            evaluations.map((ev) => (
                                <tr key={ev._id}>
                                    <td>
                                        <strong>{ev.employee?.name || 'Unknown'}</strong>
                                        <br />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            {ev.employee?.employeeCode}
                                        </span>
                                    </td>
                                    <td>{ev.quarter}</td>
                                    <td>
                                        {ev.averageScore !== null ? (
                                            <strong style={{ color: 'var(--primary)' }}>{ev.averageScore?.toFixed(1)}/10</strong>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                                        )}
                                    </td>
                                    <td style={{ maxWidth: '300px' }}>{ev.remarks || '—'}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RAQuarterlyEvaluationPage;
