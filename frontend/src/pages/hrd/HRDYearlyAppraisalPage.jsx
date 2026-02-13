import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { FiPlusCircle, FiStar } from 'react-icons/fi';

const HRDYearlyAppraisalPage = () => {
    // Generate form
    const [showGenerateForm, setShowGenerateForm] = useState(false);
    const [genEmployeeId, setGenEmployeeId] = useState('');
    const [genFinancialYear, setGenFinancialYear] = useState('');
    const [generating, setGenerating] = useState(false);

    // Review form
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [appraisalId, setAppraisalId] = useState('');
    const [hrdRemarks, setHrdRemarks] = useState('');
    const [hrdRating, setHrdRating] = useState('');
    const [reviewing, setReviewing] = useState(false);

    const yearOptions = ['2024-25', '2025-26', '2026-27'];

    const handleGenerate = async (e) => {
        e.preventDefault();
        if (!genEmployeeId || !genFinancialYear) {
            toast.error('Please fill all fields');
            return;
        }
        setGenerating(true);
        try {
            const res = await api.post('/hrd/generate-yearly', {
                employeeId: genEmployeeId,
                financialYear: genFinancialYear,
            });
            toast.success(res.data.message);
            setShowGenerateForm(false);
            setGenEmployeeId('');
            setGenFinancialYear('');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to generate');
        } finally {
            setGenerating(false);
        }
    };

    const handleReview = async (e) => {
        e.preventDefault();
        if (!appraisalId || !hrdRating) {
            toast.error('Please fill required fields');
            return;
        }
        setReviewing(true);
        try {
            await api.post('/hrd/review', {
                appraisalId,
                hrdRemarks,
                hrdRating: Number(hrdRating),
            });
            toast.success('HRD review submitted successfully!');
            setShowReviewForm(false);
            setAppraisalId('');
            setHrdRemarks('');
            setHrdRating('');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Review failed');
        } finally {
            setReviewing(false);
        }
    };

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Yearly Appraisal</h1>
                <p>Generate yearly appraisals and provide HRD review with marks and remarks</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => setShowGenerateForm(!showGenerateForm)}>
                    <FiPlusCircle /> Generate Yearly Appraisal
                </button>
                <button className="btn btn-secondary" onClick={() => setShowReviewForm(!showReviewForm)}>
                    <FiStar /> Submit HRD Review
                </button>
            </div>

            {showGenerateForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Generate Yearly Appraisal</h3>
                    <form onSubmit={handleGenerate}>
                        <div className="form-group">
                            <label>Employee ID</label>
                            <input
                                type="text"
                                value={genEmployeeId}
                                onChange={(e) => setGenEmployeeId(e.target.value)}
                                placeholder="Enter employee's MongoDB ID..."
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Financial Year</label>
                            <select value={genFinancialYear} onChange={(e) => setGenFinancialYear(e.target.value)} required>
                                <option value="">Select Year</option>
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" className="btn btn-primary" disabled={generating}>
                                {generating ? 'Generating...' : 'Generate'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowGenerateForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {showReviewForm && (
                <div className="card" style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Submit HRD Review</h3>
                    <form onSubmit={handleReview}>
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
                            <label>HRD Rating (0-10)</label>
                            <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.5"
                                value={hrdRating}
                                onChange={(e) => setHrdRating(e.target.value)}
                                required
                                placeholder="Enter rating..."
                            />
                        </div>
                        <div className="form-group">
                            <label>HRD Remarks</label>
                            <textarea
                                value={hrdRemarks}
                                onChange={(e) => setHrdRemarks(e.target.value)}
                                placeholder="Summarize the employee's annual performance..."
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" className="btn btn-primary" disabled={reviewing}>
                                {reviewing ? 'Submitting...' : 'Submit Review'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowReviewForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default HRDYearlyAppraisalPage;
