import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiFilter, FiMessageSquare } from 'react-icons/fi';

// ── Go-live: first fiscal quarter the app was in production ──
// FY 2026-27 starts April 2026 → first valid quarter is Q1-2026
const GO_LIVE_FY_START  = 2026;
const GO_LIVE_QUARTER   = 1; // Q1 (April-June 2026)

// Fiscal year quarter → month mapping (April-based FY)
const QUARTER_MONTH_MAP = { 1: 4, 2: 7, 3: 10, 4: 1 };

const buildQuarterOptions = () => {
    const now            = new Date();
    const currentMonth   = now.getMonth() + 1;
    const currentYear    = now.getFullYear();
    // Current FY start year
    const currentFYStart = currentMonth >= 4 ? currentYear : currentYear - 1;
    // Current fiscal quarter (April-based)
    const currentQ = currentMonth >= 4
        ? Math.ceil((currentMonth - 3) / 3)   // Apr-Dec: Q1, Q2, Q3
        : 4;                                   // Jan-Mar: Q4

    const opts = [];
    for (let fy = GO_LIVE_FY_START; fy <= currentFYStart; fy++) {
        for (let q = 1; q <= 4; q++) {
            // Skip quarters before go-live
            if (fy === GO_LIVE_FY_START && q < GO_LIVE_QUARTER) continue;

            // Skip future quarters — check if this quarter's start month has passed
            const qStartMonth = QUARTER_MONTH_MAP[q];
            const qCalYear    = q === 4 ? fy + 1 : fy; // Q4 (Jan-Mar) is in next calendar year
            if (new Date(qCalYear, qStartMonth - 1, 1) > now) break;

            opts.push(`Q${q}-${fy}`);
        }
    }
    return opts.reverse(); // most recent first
};

const quarters = buildQuarterOptions();

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
                        <div key={ev.id} className="card">
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
