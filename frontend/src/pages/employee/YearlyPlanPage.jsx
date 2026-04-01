import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
    FiSend, FiTarget, FiEdit3, FiCalendar, FiFileText,
    FiCheckCircle, FiAlertCircle, FiClock, FiChevronDown, FiChevronUp,
    FiDownload, FiRefreshCw
} from 'react-icons/fi';
import './YearlyPlanPage.css';

/* ====================================================
   HELPERS
==================================================== */
const yearOptions = ['2024-25', '2025-26', '2026-27', '2027-28'];

function getStatusInfo(status) {
    const map = {
        PENDING: { label: 'Pending', cls: 'pending', icon: <FiClock /> },
        APPROVED: { label: 'Approved', cls: 'approved', icon: <FiCheckCircle /> },
        REJECTED: { label: 'Rejected', cls: 'rejected', icon: <FiAlertCircle /> },
        EDITED: { label: 'Edited', cls: 'edited', icon: <FiEdit3 /> },
        EDITED_AFTER_APPROVAL: { label: 'Edited After Approval', cls: 'edited-after', icon: <FiEdit3 /> },
    };
    return map[status] || { label: status, cls: 'pending', icon: <FiClock /> };
}

/* ====================================================
   COMPONENT
==================================================== */
const YearlyPlanPage = () => {
    const [plans, setPlans] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('plans');

    // Plan Form
    const [showPlanForm, setShowPlanForm] = useState(false);
    const [financialYear, setFinancialYear] = useState('');
    const [planAndObjectives, setPlanAndObjectives] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Edit state
    const [editingPlanId, setEditingPlanId] = useState(null);
    const [editPlanAndObjectives, setEditPlanAndObjectives] = useState('');

    // Report Form
    const [showReportForm, setShowReportForm] = useState(false);
    const [reportYear, setReportYear] = useState('');
    const [workKRA, setWorkKRA] = useState('');
    const [additionalAssignments, setAdditionalAssignments] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');

    // Resubmit state (for REJECTED plans)
    const [resubmittingPlanId, setResubmittingPlanId] = useState(null);
    const [resubmitContent, setResubmitContent] = useState('');

    // Edit history
    const [showHistoryFor, setShowHistoryFor] = useState(null);

    const fetchData = async () => {
        try {
            const [plansRes, reportsRes] = await Promise.all([
                api.get('/employee/yearly-plans'),
                api.get('/employee/yearly-appraisal-reports')
            ]);
            setPlans(plansRes.data);
            setReports(reportsRes.data);
        } catch {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    /* ----- Submit Plan ----- */
    const handleSubmitPlan = async (e) => {
        e.preventDefault();
        if (!financialYear || !planAndObjectives) {
            toast.error('Please fill all fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-plan', { financialYear, planAndObjectives });
            toast.success('Yearly plan submitted successfully!');
            setFinancialYear(''); setPlanAndObjectives('');
            setShowPlanForm(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* ----- Edit Plan ----- */
    const startEditing = (plan) => {
        setEditingPlanId(plan._id);
        setEditPlanAndObjectives(plan.planAndObjectives);
    };

    const handleEditPlan = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.put(`/employee/yearly-plan/${editingPlanId}`, {
                planAndObjectives: editPlanAndObjectives
            });
            toast.success('Plan updated successfully!');
            setEditingPlanId(null);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Update failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* ----- Resubmit Rejected Yearly Plan ----- */
    const handleResubmitPlan = async (e) => {
        e.preventDefault();
        if (!resubmitContent.trim()) {
            toast.error('Plan content cannot be empty');
            return;
        }
        setSubmitting(true);
        try {
            await api.post(`/employee/yearly-plan/${resubmittingPlanId}/resubmit`, {
                planAndObjectives: resubmitContent
            });
            toast.success('Yearly plan resubmitted successfully!');
            setResubmittingPlanId(null);
            setResubmitContent('');
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Resubmission failed');
        } finally {
            setSubmitting(false);
        }
    };

    /* ----- Submit Report ----- */
    const handleSubmitReport = async (e) => {
        e.preventDefault();
        if (!reportYear || !workKRA) {
            toast.error('Please fill required fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/employee/yearly-appraisal-report', {
                yearlyPlanId: selectedPlanId || null,
                financialYear: reportYear,
                workKRA,
                additionalAssignments
            });
            toast.success('Yearly appraisal report submitted!');
            setReportYear(''); setWorkKRA(''); setAdditionalAssignments(''); setSelectedPlanId('');
            setShowReportForm(false);
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner" />
                <p>Loading yearly plans...</p>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="yp-header-banner">
                <h1>Yearly Plan & Appraisal</h1>
                <p>Submit your yearly objectives, track plan approval, and view appraisal report feedback</p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => { setShowPlanForm(!showPlanForm); setShowReportForm(false); }}>
                    <FiSend /> Submit Yearly Plan
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowReportForm(!showReportForm); setShowPlanForm(false); }}>
                    <FiFileText /> Submit Appraisal Report
                </button>
            </div>

            {/* ===== YEARLY PLAN FORM ===== */}
            {showPlanForm && (
                <div className="yp-section-card">
                    <div className="yp-section-title"><FiTarget /> Submit Yearly Plan</div>
                    <form className="yp-form" onSubmit={handleSubmitPlan}>
                        <div className="yp-form-group">
                            <label>Financial Year <span className="required">*</span></label>
                            <select value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} required>
                                <option value="">Select Financial Year</option>
                                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="yp-form-group">
                            <label>Plan & Objectives for the Upcoming Year <span className="required">*</span></label>
                            <textarea
                                placeholder="Describe your plan and objectives for the upcoming year — goals, key results, milestones, tasks, timeline..."
                                value={planAndObjectives}
                                onChange={(e) => setPlanAndObjectives(e.target.value)}
                                required
                                style={{ minHeight: '160px' }}
                            />
                        </div>
                        <div className="yp-form-actions">
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Submitting...' : 'Submit Plan'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowPlanForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ===== APPRAISAL REPORT FORM ===== */}
            {showReportForm && (
                <div className="yp-section-card">
                    <div className="yp-section-title"><FiFileText /> Submit Yearly Appraisal Report</div>
                    <form className="yp-form" onSubmit={handleSubmitReport}>
                        <div className="yp-form-row">
                            <div className="yp-form-group">
                                <label>Financial Year <span className="required">*</span></label>
                                <select value={reportYear} onChange={(e) => setReportYear(e.target.value)} required>
                                    <option value="">Select Year</option>
                                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="yp-form-group">
                                <label>Link to Yearly Plan (optional)</label>
                                <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                                    <option value="">None</option>
                                    {plans.map(p => (
                                        <option key={p._id} value={p._id}>{p.financialYear}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="yp-form-group">
                            <label>Work / KRA Self-Assessment <span className="required">*</span></label>
                            <textarea
                                placeholder="Describe the work you completed against your KRA (Key Result Areas)..."
                                value={workKRA}
                                onChange={(e) => setWorkKRA(e.target.value)}
                                required
                                style={{ minHeight: '120px' }}
                            />
                        </div>
                        <div className="yp-form-group">
                            <label>Additional Assignments (optional)</label>
                            <textarea
                                placeholder="Any additional assignments or tasks completed beyond your plan..."
                                value={additionalAssignments}
                                onChange={(e) => setAdditionalAssignments(e.target.value)}
                            />
                        </div>
                        <div className="yp-form-actions">
                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Submitting...' : 'Submit Report'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowReportForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ===== TABS ===== */}
            <div className="yp-tabs">
                <button className={`yp-tab ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <FiTarget /> Yearly Plans <span className="yp-tab-count">{plans.length}</span>
                </button>
                <button className={`yp-tab ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
                    <FiFileText /> Appraisal Reports <span className="yp-tab-count">{reports.length}</span>
                </button>
            </div>

            {/* ===== YEARLY PLANS LIST ===== */}
            {activeTab === 'plans' && (
                <div className="yp-plan-cards">
                    {plans.length === 0 ? (
                        <div className="yp-empty">
                            <div className="yp-empty-icon"><FiTarget /></div>
                            <p>No yearly plans submitted yet. Click "Submit Yearly Plan" to get started.</p>
                        </div>
                    ) : plans.map(plan => {
                        const st = getStatusInfo(plan.status);
                        const isEditing = editingPlanId === plan._id;

                        return (
                            <div key={plan._id} className="yp-plan-card">
                                <div className="yp-plan-header">
                                    <div className="yp-plan-year">
                                        <FiCalendar /> FY {plan.financialYear}
                                        <span className="yp-plan-version">v{plan.version}</span>
                                    </div>
                                    <span className={`yp-status ${st.cls}`}>{st.icon} {st.label}</span>
                                </div>

                                {isEditing ? (
                                    <form className="yp-form" onSubmit={handleEditPlan}>
                                        <div className="yp-form-group">
                                            <label>Plan & Objectives</label>
                                            <textarea value={editPlanAndObjectives} onChange={e => setEditPlanAndObjectives(e.target.value)} required style={{ minHeight: '160px' }} />
                                        </div>
                                        <div className="yp-form-actions">
                                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                                {submitting ? 'Saving...' : 'Save Changes'}
                                            </button>
                                            <button type="button" className="btn btn-secondary" onClick={() => setEditingPlanId(null)}>Cancel</button>
                                        </div>
                                    </form>
                                ) : (
                                    <>
                                        <div className="yp-plan-body">
                                            <div className="yp-plan-field">
                                                <div className="yp-plan-field-label">Plan & Objectives</div>
                                                <div className="yp-plan-field-value">{plan.planAndObjectives}</div>
                                            </div>
                                        </div>

                                        {/* MD Remarks */}
                                        {plan.mdRemarks && (
                                            <div className={`yp-md-remarks ${plan.status === 'APPROVED' ? 'approval' : ''}`}>
                                                <strong>MD Remarks:</strong> {plan.mdRemarks}
                                            </div>
                                        )}

                                        {/* Edit History */}
                                        {plan.editHistory && plan.editHistory.length > 0 && (
                                            <div className="yp-edit-history">
                                                <button
                                                    className="yp-edit-history-toggle"
                                                    onClick={() => setShowHistoryFor(showHistoryFor === plan._id ? null : plan._id)}
                                                >
                                                    {showHistoryFor === plan._id ? <FiChevronUp /> : <FiChevronDown />}
                                                    {' '}Edit History ({plan.editHistory.length})
                                                </button>
                                                {showHistoryFor === plan._id && (
                                                    <div className="yp-edit-log">
                                                        {plan.editHistory.map((edit, idx) => (
                                                            <div key={idx} className="yp-edit-log-item">
                                                                <FiEdit3 style={{ flexShrink: 0 }} />
                                                                <span>{edit.note} — {new Date(edit.editedAt).toLocaleString()}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* ---- Rejection Banner & Resubmit Form ---- */}
                                        {plan.status === 'REJECTED' && (
                                            <div className="yp-rejection-alert">
                                                <div className="yp-rejection-alert-header">
                                                    <FiAlertCircle className="yp-rejection-icon" />
                                                    <div>
                                                        <div className="yp-rejection-title">Plan Rejected by Managing Director</div>
                                                        {plan.mdRemarks && (
                                                            <div className="yp-rejection-remarks">
                                                                <strong>Reason:</strong> {plan.mdRemarks}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {resubmittingPlanId === plan._id ? (
                                                    <form className="yp-resubmit-form" onSubmit={handleResubmitPlan}>
                                                        <div className="yp-form-group">
                                                            <label>
                                                                Revised Plan &amp; Objectives
                                                                <span className="required"> *</span>
                                                            </label>
                                                            <textarea
                                                                value={resubmitContent}
                                                                onChange={(e) => setResubmitContent(e.target.value)}
                                                                placeholder="Update your plan based on the MD's feedback and resubmit for review..."
                                                                required
                                                                style={{ minHeight: '150px' }}
                                                            />
                                                        </div>
                                                        <div className="yp-form-actions">
                                                            <button type="submit" className="btn btn-primary" disabled={submitting}>
                                                                <FiRefreshCw />
                                                                {submitting ? 'Resubmitting...' : 'Resubmit for Review'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary"
                                                                onClick={() => { setResubmittingPlanId(null); setResubmitContent(''); }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <button
                                                        className="btn btn-resubmit"
                                                        onClick={() => {
                                                            setResubmittingPlanId(plan._id);
                                                            setResubmitContent(plan.planAndObjectives);
                                                        }}
                                                    >
                                                        <FiRefreshCw /> Resubmit Plan
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        <div className="yp-plan-footer">
                                            <div className="yp-plan-meta">
                                                Submitted: {new Date(plan.submittedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </div>
                                            <div className="yp-plan-actions">
                                                {plan.status !== 'REJECTED' && (
                                                    <button className="btn btn-secondary btn-sm" onClick={() => startEditing(plan)}>
                                                        <FiEdit3 /> Edit
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ===== APPRAISAL REPORTS LIST ===== */}
            {activeTab === 'reports' && (
                <div className="yp-report-cards">
                    {reports.length === 0 ? (
                        <div className="yp-empty">
                            <div className="yp-empty-icon"><FiFileText /></div>
                            <p>No appraisal reports submitted yet. Click "Submit Appraisal Report" to get started.</p>
                        </div>
                    ) : reports.map(report => (
                        <div key={report._id} className="yp-report-card">
                            <div className="yp-report-header">
                                <div className="yp-report-year">
                                    <FiFileText style={{ marginRight: '6px' }} />
                                    Annual Appraisal Report — FY {report.financialYear}
                                </div>
                                <span className={`yp-status ${report.status === 'COMPLETED' ? 'approved' : 'pending'}`}>
                                    {report.status === 'COMPLETED' ? <FiCheckCircle /> : <FiClock />}
                                    {' '}{report.status?.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <div className="yp-report-body">
                                <div className="yp-plan-field">
                                    <div className="yp-plan-field-label">Work / KRA Self-Assessment</div>
                                    <div className="yp-plan-field-value">{report.workKRA}</div>
                                </div>
                                {report.additionalAssignments && (
                                    <div className="yp-plan-field">
                                        <div className="yp-plan-field-label">Additional Assignments</div>
                                        <div className="yp-plan-field-value">{report.additionalAssignments}</div>
                                    </div>
                                )}
                            </div>

                            {/* Remarks from evaluators (employee only sees remarks, not scores) */}
                            {(report.raRemarks || report.hrdRemarks || report.mdRemarks) && (
                                <div className="yp-remarks-section">
                                    <div className="yp-remarks-title">Evaluator Remarks</div>
                                    {report.raRemarks && (
                                        <div className="yp-remark-item">
                                            <div className="yp-remark-label">Reporting Authority</div>
                                            <div className="yp-remark-text">"{report.raRemarks}"</div>
                                        </div>
                                    )}
                                    {report.hrdRemarks && (
                                        <div className="yp-remark-item">
                                            <div className="yp-remark-label">HRD</div>
                                            <div className="yp-remark-text">"{report.hrdRemarks}"</div>
                                        </div>
                                    )}
                                    {report.mdRemarks && (
                                        <div className="yp-remark-item">
                                            <div className="yp-remark-label">Managing Director</div>
                                            <div className="yp-remark-text">"{report.mdRemarks}"</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* PDF Footer */}
                            {report.status === 'COMPLETED' && (
                                <div style={{
                                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                                    padding: '16px 24px',
                                    background: 'rgba(249, 115, 22, 0.03)',
                                    borderTop: '1px dashed var(--border-default)'
                                }}>
                                    <button
                                        className="btn btn-primary"
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontWeight: 'bold' }}
                                        onClick={() => {
                                            const printWin = window.open('', '_blank');
                                            printWin.document.write(`
                                                <html><head><title>Appraisal Report FY ${report.financialYear}</title>
                                                <style>body{font-family:system-ui,sans-serif;padding:30px;color:#1e293b}
                                                h2{margin-bottom:8px} .label{font-weight:700;font-size:12px;color:#64748b;text-transform:uppercase;margin-top:14px}
                                                .value{margin:4px 0 10px;line-height:1.6} .remark{border-left:3px solid #f97316;padding:8px 12px;margin:6px 0;background:#fefce8}
                                                </style></head><body>
                                                <h2>Annual Appraisal Report — FY ${report.financialYear}</h2>
                                                <p class="label">Work / KRA Self-Assessment</p><p class="value">${report.workKRA || ''}</p>
                                                ${report.additionalAssignments ? `<p class="label">Additional Assignments</p><p class="value">${report.additionalAssignments}</p>` : ''}
                                                ${report.raRemarks ? `<p class="label">RA Remarks</p><div class="remark">${report.raRemarks}</div>` : ''}
                                                ${report.hrdRemarks ? `<p class="label">HRD Remarks</p><div class="remark">${report.hrdRemarks}</div>` : ''}
                                                ${report.mdRemarks ? `<p class="label">MD Remarks</p><div class="remark">${report.mdRemarks}</div>` : ''}
                                                </body></html>
                                            `);
                                            printWin.document.close();
                                            printWin.print();
                                        }}
                                    >
                                        <FiDownload /> Download PDF
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default YearlyPlanPage;
