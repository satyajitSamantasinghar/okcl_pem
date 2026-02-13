import { FiAward } from 'react-icons/fi';

const RAYearlyAppraisalPage = () => {
    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Yearly Appraisal</h1>
                <p>Assign final marks and provide year-end remarks for employees under your supervision</p>
            </div>

            <div className="empty-state">
                <div className="empty-icon"><FiAward /></div>
                <h3>Yearly Appraisal</h3>
                <p>
                    The yearly appraisal process is managed through HRD and MD.
                    Your quarterly evaluations feed into the yearly appraisal automatically.
                </p>
            </div>
        </div>
    );
};

export default RAYearlyAppraisalPage;
