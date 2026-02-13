import { Link } from 'react-router-dom';
import { FiShieldOff } from 'react-icons/fi';

const UnauthorizedPage = () => {
    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-page)',
            padding: '20px',
        }}>
            <div style={{ textAlign: 'center' }}>
                <FiShieldOff style={{ fontSize: '4rem', color: 'var(--error)', marginBottom: '20px' }} />
                <h1 style={{ fontSize: '2rem', marginBottom: '12px' }}>Access Denied</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '1rem' }}>
                    You don't have permission to access this page.
                </p>
                <Link to="/login" className="btn btn-primary">
                    Back to Login
                </Link>
            </div>
        </div>
    );
};

export default UnauthorizedPage;
