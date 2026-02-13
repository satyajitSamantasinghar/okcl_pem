import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import './LoginPage.css';

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login, getRoleDashboardPath } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!email || !password) {
            toast.error('Please fill in all fields');
            return;
        }

        setIsLoading(true);
        try {
            const userData = await login(email, password);
            toast.success(`Welcome, ${userData.name}!`);
            navigate(getRoleDashboardPath(userData.role), { replace: true });
        } catch (error) {
            const msg = error.response?.data?.message || 'Login failed. Please try again.';
            toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-page">
            {/* Decorative circles */}
            <div className="login-circle login-circle--large" />
            <div className="login-circle login-circle--medium" />
            <div className="login-circle login-circle--corner" />

            <div className="login-card">
                <div className="login-logo">
                    <img src="../assets/logo.png" alt="Company Logo" className="login-logo-img" />
                </div>

                <h1 className="login-title">
                    Performance <span className="login-title-accent">Appraisal</span> Report System
                </h1>

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="login-field">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            placeholder="emp@test.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            autoFocus
                        />
                    </div>

                    <div className="login-field">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            placeholder="password123"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </div>

                    <button
                        type="submit"
                        className="login-submit"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="login-spinner" />
                        ) : (
                            'Sign in'
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    <a href="#" className="login-link">Don't have an account?</a>
                    <a href="#" className="login-link">Forgot password?</a>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
