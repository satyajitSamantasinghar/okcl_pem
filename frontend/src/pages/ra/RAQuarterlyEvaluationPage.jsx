import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiBarChart2, FiX, FiEdit3, FiCalendar,
    FiCheckCircle, FiFileText, FiAlertCircle
} from 'react-icons/fi';
import './RAQuarterlyEvaluationPage.css';

/* =====================================================
   HELPERS
===================================================== */
function getCurrentQuarter() {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `Q${q}-${now.getFullYear()}`;
}

function buildQuarterOptions() {
    const opts = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    for (let y = currentYear - 1; y <= currentYear; y++) {
        for (let q = 1; q <= 4; q++) {
            opts.push(`Q${q}-${y}`);
        }
    }
    return opts;
}

function formatMonthLabel(monthStr) {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatMonthLong(monthStr) {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2);
}

function getScoreColor(score) {
    if (score >= 8) return '#22C55E';
    if (score >= 6) return '#F97316';
    if (score >= 4) return '#EAB308';
    return '#EF4444';
}

function getScoreGradient(score) {
    if (score >= 8) return 'linear-gradient(135deg, #22C55E, #16A34A)';
    if (score >= 6) return 'linear-gradient(135deg, #F97316, #EA580C)';
    if (score >= 4) return 'linear-gradient(135deg, #EAB308, #CA8A04)';
    return 'linear-gradient(135deg, #EF4444, #DC2626)';
}

/* =====================================================
   RADIAL GAUGE COMPONENT
===================================================== */
const RadialGauge = ({ score, size = 160 }) => {
    const radius = (size - 24) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 10) * circumference;
    const dashOffset = circumference - progress;
    const color = getScoreColor(score);

    return (
        <div className="qtr-gauge" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle
                    className="qtr-gauge-bg"
                    cx={size / 2} cy={size / 2} r={radius}
                />
                <circle
                    className="qtr-gauge-fill"
                    cx={size / 2} cy={size / 2} r={radius}
                    stroke={color}
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                />
            </svg>
            <div className="qtr-gauge-center">
                <span className="qtr-gauge-value" style={{ color }}>{score.toFixed(1)}</span>
                <span className="qtr-gauge-label">out of 10</span>
            </div>
        </div>
    );
};

/* =====================================================
   MAIN COMPONENT
===================================================== */
const RAQuarterlyEvaluationPage = () => {
    const [quarter, setQuarter] = useState(getCurrentQuarter());
    const [evaluations, setEvaluations] = useState([]);
    const [loading, setLoading] = useState(true);

    // Detail modal
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Remarks editing
    const [editingRemarks, setEditingRemarks] = useState(false);
    const [remarksText, setRemarksText] = useState('');
    const [savingRemarks, setSavingRemarks] = useState(false);

    const quarterOptions = buildQuarterOptions();

    const fetchEvaluations = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/ra/quarterly-evaluations', {
                params: { quarter, limit: 50 }
            });
            setEvaluations(res.data?.data || []);
        } catch (err) {
            toast.error('Failed to load quarterly evaluations');
        } finally {
            setLoading(false);
        }
    }, [quarter]);

    useEffect(() => {
        fetchEvaluations();
    }, [fetchEvaluations]);

    /* Open detail modal */
    const openDetail = async (evalId) => {
        setDetailLoading(true);
        setSelectedDetail(null);
        try {
            const res = await api.get(`/ra/quarterly-evaluations/${evalId}/detail`);
            setSelectedDetail(res.data);
            setRemarksText(res.data.remarks || '');
            setEditingRemarks(false);
        } catch (err) {
            toast.error('Failed to load details');
        } finally {
            setDetailLoading(false);
        }
    };

    /* Save remarks */
    const saveRemarks = async () => {
        if (!selectedDetail) return;
        setSavingRemarks(true);
        try {
            await api.put(`/ra/quarterly-evaluations/${selectedDetail._id}/remarks`, {
                remarks: remarksText
            });
            toast.success('Remarks updated');
            setSelectedDetail(prev => ({ ...prev, remarks: remarksText }));
            setEditingRemarks(false);
            fetchEvaluations();
        } catch (err) {
            toast.error('Failed to save remarks');
        } finally {
            setSavingRemarks(false);
        }
    };

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
                <p>View quarterly performance reports auto-generated from monthly evaluations and provide quarterly remarks</p>
            </div>

            {/* Quarter Selector */}
            <div className="qtr-page-actions">
                <FiCalendar style={{ color: 'var(--text-muted)' }} />
                <div className="qtr-quarter-select">
                    <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                        {quarterOptions.map(q => (
                            <option key={q} value={q}>{q.replace('-', ' · ')}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Report Cards */}
            {evaluations.length === 0 ? (
                <div className="qtr-empty">
                    <div className="qtr-empty-icon"><FiBarChart2 /></div>
                    <h3>No Quarterly Reports Available</h3>
                    <p>
                        Quarterly reports are automatically generated once all 3 months of {quarter.replace('-', ' ')} have been evaluated for your employees.
                    </p>
                </div>
            ) : (
                <div className="qtr-reports-grid">
                    {evaluations.map(ev => (
                        <div
                            key={ev._id}
                            className="qtr-report-card"
                            onClick={() => openDetail(ev._id)}
                        >
                            <div className="qtr-report-card-top">
                                <div className="qtr-report-avatar">
                                    {getInitials(ev.employee?.name)}
                                </div>
                                <div className="qtr-report-info">
                                    <div className="qtr-report-name">{ev.employee?.name || 'Unknown'}</div>
                                    <div className="qtr-report-meta">
                                        {ev.employee?.employeeCode} • {ev.employee?.department || 'N/A'}
                                    </div>
                                </div>
                            </div>

                            <div className="qtr-report-score-row">
                                <span className="qtr-report-score-label">Quarterly Average</span>
                                <span
                                    className="qtr-report-score-value"
                                    style={{ color: getScoreColor(ev.averageScore) }}
                                >
                                    {ev.averageScore?.toFixed(1)}/10
                                </span>
                            </div>

                            <div className="qtr-report-footer">
                                {ev.hasRemarks ? (
                                    <span className="qtr-remarks-badge has-remarks">
                                        <FiCheckCircle /> Remarks Added
                                    </span>
                                ) : (
                                    <span className="qtr-remarks-badge needs-remarks">
                                        <FiAlertCircle /> Remarks Pending
                                    </span>
                                )}
                                <span className="qtr-report-view-hint">View Details →</span>
                            </div>

                            {!ev.hasRemarks && (
                                <div className="qtr-remarks-prompt">
                                    <FiEdit3 /> Add quarterly remarks for this employee
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Detail Modal */}
            {(selectedDetail || detailLoading) && (
                <div className="qtr-detail-overlay" onClick={() => { setSelectedDetail(null); setEditingRemarks(false); }}>
                    <div className="qtr-detail-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="qtr-detail-header">
                            <h2>Quarterly Report — {selectedDetail?.quarter?.replace('-', ' ')}</h2>
                            <button
                                className="qtr-detail-close"
                                onClick={() => { setSelectedDetail(null); setEditingRemarks(false); }}
                            >
                                <FiX />
                            </button>
                        </div>

                        <div className="qtr-detail-body">
                            {detailLoading ? (
                                <div className="loading-container" style={{ minHeight: '200px' }}>
                                    <div className="spinner" />
                                    <p>Loading report...</p>
                                </div>
                            ) : selectedDetail && (
                                <>
                                    {/* Employee Profile */}
                                    <div className="qtr-detail-profile">
                                        <div className="qtr-detail-avatar">
                                            {getInitials(selectedDetail.employee?.name)}
                                        </div>
                                        <div className="qtr-detail-info">
                                            <h3>{selectedDetail.employee?.name}</h3>
                                            <p>{selectedDetail.employee?.employeeCode} • {selectedDetail.employee?.department || 'No department'}</p>
                                        </div>
                                    </div>

                                    {/* Radial Gauge */}
                                    <div className="qtr-gauge-container">
                                        <RadialGauge score={selectedDetail.averageScore || 0} />
                                    </div>

                                    {/* Horizontal Bar Chart: Monthly Breakdown */}
                                    {selectedDetail.monthlyBreakdown?.length > 0 && (
                                        <div className="qtr-chart-section">
                                            <div className="qtr-chart-title">Monthly Score Breakdown</div>
                                            <div className="qtr-bar-chart">
                                                {selectedDetail.monthlyBreakdown.map((m, i) => (
                                                    <div key={i} className="qtr-bar-row">
                                                        <div className="qtr-bar-label">{formatMonthLabel(m.month)}</div>
                                                        <div className="qtr-bar-track">
                                                            <div
                                                                className="qtr-bar-fill"
                                                                style={{
                                                                    width: `${(m.score / 10) * 100}%`,
                                                                    background: getScoreGradient(m.score)
                                                                }}
                                                            >
                                                                <span className="qtr-bar-fill-text">{m.score}/10</span>
                                                            </div>
                                                        </div>
                                                        <div
                                                            className="qtr-bar-score"
                                                            style={{ color: getScoreColor(m.score) }}
                                                        >
                                                            {m.score}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Per-month remarks */}
                                            {selectedDetail.monthlyBreakdown.some(m => m.remarks) && (
                                                <div style={{ marginTop: '16px' }}>
                                                    {selectedDetail.monthlyBreakdown.map((m, i) => (
                                                        m.remarks ? (
                                                            <div key={i} style={{
                                                                padding: '10px 14px',
                                                                background: 'var(--bg-muted)',
                                                                borderRadius: 'var(--radius-md)',
                                                                marginBottom: '6px',
                                                                fontSize: '0.8125rem'
                                                            }}>
                                                                <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                                                                    {formatMonthLabel(m.month)}:
                                                                </span>{' '}
                                                                <span style={{ color: 'var(--text-primary)' }}>{m.remarks}</span>
                                                            </div>
                                                        ) : null
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Quarterly Remarks */}
                                    <div className="qtr-detail-remarks">
                                        <div className="qtr-detail-remarks-label">
                                            <FiFileText /> Quarterly Remarks
                                        </div>

                                        {editingRemarks ? (
                                            <>
                                                <textarea
                                                    value={remarksText}
                                                    onChange={(e) => setRemarksText(e.target.value)}
                                                    placeholder="Summarize the employee's quarterly performance..."
                                                    autoFocus
                                                />
                                                <div className="qtr-detail-actions">
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => {
                                                            setEditingRemarks(false);
                                                            setRemarksText(selectedDetail.remarks || '');
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={saveRemarks}
                                                        disabled={savingRemarks}
                                                    >
                                                        {savingRemarks ? 'Saving...' : 'Save Remarks'}
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className={`qtr-detail-remarks-box ${!selectedDetail.remarks ? 'qtr-detail-remarks-empty' : ''}`}>
                                                    {selectedDetail.remarks || 'No quarterly remarks added yet. Click below to add.'}
                                                </div>
                                                <div className="qtr-detail-actions">
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => setEditingRemarks(true)}
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                                    >
                                                        <FiEdit3 /> {selectedDetail.remarks ? 'Edit Remarks' : 'Add Remarks'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Generated timestamp */}
                                    {selectedDetail.generatedAt && (
                                        <div className="qtr-generated-at">
                                            <FiCheckCircle />
                                            Generated on {new Date(selectedDetail.generatedAt).toLocaleDateString('en-US', {
                                                day: 'numeric', month: 'short', year: 'numeric'
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RAQuarterlyEvaluationPage;
