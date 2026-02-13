import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiXCircle } from 'react-icons/fi';

const MDApprovalPage = () => {
    const [appraisalId, setAppraisalId] = useState('');
    const [mdRemarks, setMdRemarks] = useState('');
    const [mdFinalRating, setMdFinalRating] = useState('');
    const [decision, setDecision] = useState('APPROVE');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!appraisalId || !mdFinalRating) {
            toast.error('Please fill required fields');
            return;
        }
        setSubmitting(true);
        try {
            await api.post('/md/final-approval', {
                appraisalId,
                mdRemarks,
                mdFinalRating: Number(mdFinalRating),
                decision,
            });
            toast.success(`Appraisal ${decision === 'APPROVE' ? 'approved' : 'rejected'} successfully!`);
            setAppraisalId('');
            setMdRemarks('');
            setMdFinalRating('');
            setDecision('APPROVE');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Action failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Approvals & Final Rating</h1>
                <p>Review yearly appraisals, assign final marks, and approve or reject submissions</p>
            </div>

            <div className="card" style={{ maxWidth: '640px' }}>
                <h3 style={{ marginBottom: '24px' }}>Final Appraisal Decision</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Appraisal ID</label>
                        <input
                            type="text"
                            value={appraisalId}
                            onChange={(e) => setAppraisalId(e.target.value)}
                            placeholder="Enter appraisal MongoDB ID..."
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>MD Final Rating (0-10)</label>
                        <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.5"
                            value={mdFinalRating}
                            onChange={(e) => setMdFinalRating(e.target.value)}
                            required
                            placeholder="Enter final rating..."
                        />
                    </div>

                    <div className="form-group">
                        <label>MD Remarks</label>
                        <textarea
                            value={mdRemarks}
                            onChange={(e) => setMdRemarks(e.target.value)}
                            placeholder="Provide final remarks on employee performance..."
                        />
                    </div>

                    <div className="form-group">
                        <label>Decision</label>
                        <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: '500' }}>
                                <input
                                    type="radio"
                                    name="decision"
                                    value="APPROVE"
                                    checked={decision === 'APPROVE'}
                                    onChange={(e) => setDecision(e.target.value)}
                                    style={{ width: 'auto' }}
                                />
                                <FiCheckCircle style={{ color: 'var(--success)' }} /> Approve
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: '500' }}>
                                <input
                                    type="radio"
                                    name="decision"
                                    value="REJECT"
                                    checked={decision === 'REJECT'}
                                    onChange={(e) => setDecision(e.target.value)}
                                    style={{ width: 'auto' }}
                                />
                                <FiXCircle style={{ color: 'var(--error)' }} /> Reject
                            </label>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className={`btn btn-lg btn-block ${decision === 'APPROVE' ? 'btn-success' : 'btn-danger'}`}
                        disabled={submitting}
                    >
                        {submitting
                            ? 'Processing...'
                            : decision === 'APPROVE'
                                ? 'Approve Appraisal'
                                : 'Reject Appraisal'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default MDApprovalPage;
