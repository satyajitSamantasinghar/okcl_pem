import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
// import logo from "../assets/logo.png";

import toast from 'react-hot-toast';
import './LoginPage.css';

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSSOLoading, setIsSSOLoading] = useState(false);
    const { login, hrmsLogin, getRoleDashboardPath } = useAuth();
    const navigate = useNavigate();

    // ── HRMS SSO Auto-Login & Background Logout ──────────────────────────────
    // Two scenarios handled in this single effect:
    //
    // 1. HRMS SSO Login: HRMS redirects here with ?token=<BASE64>
    //    → exchange token for a local JWT, navigate to the dashboard.
    //
    // 2. KRA Logout: DashboardLayout navigates here with ?logged_out=true
    //    instead of navigating to HRMS logout URL directly (which caused a
    //    redirect loop: HRMS logout → back to KRA → ProtectedRoute SSO fallback
    //    → HRMS login page with kra_redirect in the URL).
    //    We fire HRMS logout silently via a hidden <iframe> — no browser
    //    navigation, no redirect loop. If HRMS has X-Frame-Options: SAMEORIGIN,
    //    the iframe fails silently and the HRMS session expires naturally.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        // ── Scenario 2: Background HRMS logout ───────────────────────────────
        const loggedOut = params.get('logged_out');
        if (loggedOut === 'true') {
            // Clean the URL bar immediately (remove ?logged_out=true)
            window.history.replaceState({}, document.title, '/login');
            // Fire HRMS logout silently via a hidden iframe (best-effort)
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = 'https://hrmserp.okcl.co.in/phpscript/logout.php';
            document.body.appendChild(iframe);
            // Remove the iframe after 4 seconds (enough for logout.php to run)
            setTimeout(() => iframe.remove(), 4000);
            return; // Show the normal login form — do not attempt SSO login
        }

        // ── Scenario 1: HRMS SSO Token Login ─────────────────────────────────
        const ssoToken = params.get('token');

        if (!ssoToken) return; // No SSO token → show normal login form

        setIsSSOLoading(true);

        // Remove token from URL bar immediately (security hygiene)
        window.history.replaceState({}, document.title, window.location.pathname);

        hrmsLogin(ssoToken)
            .then((userData) => {
                toast.success(`Welcome, ${userData.name}!`);
                // ── HRMS SSO Fallback: respect the original KRA page the user was trying ──
                // When HRMS sends the user back after re-login, it appends ?redirect=<kraPath>
                // so we land the user directly on e.g. /employee/monthly-plan
                const redirect = params.get('redirect');
                const destination = redirect || getRoleDashboardPath(userData.role);
                // navigate(getRoleDashboardPath(userData.role), { replace: true }); // old behaviour
                navigate(destination, { replace: true });
            })
            .catch((error) => {
                const msg = error.response?.data?.message || 'HRMS login failed. Please contact IT support.';
                toast.error(msg);
                setIsSSOLoading(false); // Fall back to showing the manual login form
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    // ── Full-screen SSO loading overlay ──────────────────────────────────────
    if (isSSOLoading) {
        return (
            <div className="login-page">
                <div className="login-circle login-circle--large" />
                <div className="login-circle login-circle--medium" />
                <div className="login-circle login-circle--corner" />
                <div className="login-card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
                    <div className="login-logo">
                        <img src="/logo.png" alt="Company Logo" className="login-logo-img" />
                    </div>
                    <h1 className="login-title">
                        Performance <span className="login-title-accent">Appraisal</span> Report System
                    </h1>
                    <span className="login-spinner" style={{ display: 'inline-block', margin: '2rem auto' }} />
                    <p style={{ color: '#888', marginTop: '1rem', fontSize: '0.95rem' }}>
                        Signing you in via HRMS&hellip;
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="login-page">
            {/* Decorative circles */}
            <div className="login-circle login-circle--large" />
            <div className="login-circle login-circle--medium" />
            <div className="login-circle login-circle--corner" />

            <div className="login-card">
                <div className="login-logo">
                    <img src="/logo.png" alt="Company Logo" className="login-logo-img" />
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
                    <a href="#" className="login-link">Login with HRMS</a>
                    <a href="#" className="login-link">Forgot password?</a>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
