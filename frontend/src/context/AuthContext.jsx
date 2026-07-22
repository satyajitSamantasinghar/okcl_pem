import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

// ── Which base roles are allowed to switch into which view? ──────────────────
//  EMPLOYEE → no switching (only one view available)
//  RA       → can switch to EMPLOYEE view (RA is also an employee)
//  HRD      → no switching
//  MD       → can switch to RA view (MD evaluates direct reportees as RA)
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_VIEWS = {
    EMPLOYEE: ['EMPLOYEE'],
    RA:       ['RA', 'EMPLOYEE'],
    HRD:      ['HRD'],
    MD:       ['MD', 'RA'],
};

export const AuthProvider = ({ children }) => {
    const [user, setUser]           = useState(null);
    const [loading, setLoading]     = useState(true);
    const [activeView, setActiveView] = useState(null);
    // mdIsRA: fetched once on MD login — controls whether "Switch to RA View" button shows
    const [mdIsRA, setMdIsRA]       = useState(false);

    useEffect(() => {
        // Restore session from localStorage
        const token      = localStorage.getItem('accessToken');
        const role       = localStorage.getItem('role');
        const name       = localStorage.getItem('name');
        const savedView  = localStorage.getItem('activeView');
        const savedMdIsRA = localStorage.getItem('mdIsRA') === 'true';

        if (token && role && name) {
            setUser({ name, role, accessToken: token });
            // Restore the saved view if valid for this role; otherwise default to role
            const views = ALLOWED_VIEWS[role] || [role];
            setActiveView(views.includes(savedView) ? savedView : role);
            if (role === 'MD') setMdIsRA(savedMdIsRA);
        }
        setLoading(false);
    }, []);

    // ── Check MD → RA eligibility (called after MD login) ────────────────────
    const fetchMdRAEligibility = useCallback(async () => {
        try {
            const { data } = await api.get('/md/ra-eligibility');
            setMdIsRA(data.isRA);
            localStorage.setItem('mdIsRA', String(data.isRA));
        } catch {
            // Silently ignore — button simply won't show if check fails
            setMdIsRA(false);
            localStorage.setItem('mdIsRA', 'false');
        }
    }, []);

    // ── Local login ───────────────────────────────────────────────────────────
    const login = async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('role', data.role);
        localStorage.setItem('name', data.name);
        localStorage.setItem('activeView', data.role);

        const userData = {
            name: data.name,
            role: data.role,
            accessToken: data.accessToken,
        };

        setUser(userData);
        setActiveView(data.role);

        if (data.role === 'MD') await fetchMdRAEligibility();

        return userData;
    };

    // ── HRMS SSO Login ────────────────────────────────────────────────────────
    const hrmsLogin = async (token) => {
        const { data } = await api.post('/auth/hrms-sso', { token });

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('role', data.role);
        localStorage.setItem('name', data.name);
        localStorage.setItem('activeView', data.role);

        const userData = {
            name: data.name,
            role: data.role,
            accessToken: data.accessToken,
        };

        setUser(userData);
        setActiveView(data.role);

        if (data.role === 'MD') await fetchMdRAEligibility();

        return userData;
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // Silently fail — we still clear local state
        }
        localStorage.clear();
        setUser(null);
        setActiveView(null);
        setMdIsRA(false);
    };

    // ── Switch View ───────────────────────────────────────────────────────────
    //  Changes the active UI context without re-issuing the JWT.
    //  Only allowed transitions (per ALLOWED_VIEWS) are accepted.
    //  Industry pattern: single identity token, multiple UI views.
    const switchView = useCallback((targetView) => {
        if (!user) return;
        const allowed = ALLOWED_VIEWS[user.role] || [user.role];
        if (!allowed.includes(targetView)) {
            console.warn(`[switchView] Role "${user.role}" cannot switch to view "${targetView}"`);
            return;
        }
        setActiveView(targetView);
        localStorage.setItem('activeView', targetView);
    }, [user]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getAllowedViews = (role) => ALLOWED_VIEWS[role] || [role];

    const isAuthenticated = !!user;

    const getRoleDashboardPath = (role) => {
        const paths = {
            EMPLOYEE: '/employee',
            RA: '/ra',
            HRD: '/hrd',
            MD: '/md',
        };
        return paths[role] || '/login';
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                isAuthenticated,
                activeView,
                mdIsRA,
                switchView,
                getAllowedViews,
                login,
                hrmsLogin,
                logout,
                getRoleDashboardPath,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
