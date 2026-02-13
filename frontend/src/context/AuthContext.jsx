import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Restore session from localStorage
        const token = localStorage.getItem('accessToken');
        const role = localStorage.getItem('role');
        const name = localStorage.getItem('name');

        if (token && role && name) {
            setUser({ name, role, accessToken: token });
        }
        setLoading(false);
    }, []);

    const login = async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('role', data.role);
        localStorage.setItem('name', data.name);

        const userData = {
            name: data.name,
            role: data.role,
            accessToken: data.accessToken,
        };

        setUser(userData);
        return userData;
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // Silently fail — we still clear local state
        }
        localStorage.clear();
        setUser(null);
    };

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
                login,
                logout,
                getRoleDashboardPath,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
