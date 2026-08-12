import axios from 'axios';

// In production, the frontend is served by the same Express server,
// so we use a relative path '/api'. In development (Vite dev server),
// we fall back to the full localhost URL via the env variable.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// ── HRMS redirect suppression flag ───────────────────────────────────────────
// When true, the 401 interceptor falls back to /login instead of firing the
// HRMS SSO redirect. This is set by AuthContext.logout() BEFORE calling
// api.post('/auth/logout') so that if the logout request itself returns 401
// (e.g. expired token), the interceptor doesn't hijack the browser to HRMS.
//
// This is a module-level variable (not React state) so it's available
// synchronously inside the Axios interceptor — no React render cycle needed.
let _suppressHrmsRedirect = false;

/**
 * Call with `true` before initiating a logout API call.
 * Call with `false` after login succeeds (AuthContext handles this).
 */
export function suppressHrmsRedirect(value) {
  _suppressHrmsRedirect = value;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          localStorage.clear();
          // ── Check suppression flag before deciding where to redirect ─────
          if (_suppressHrmsRedirect) {
            // Intentional logout — go to KRA's own login page (no loop)
            // window.location.href = '/login'; // old behaviour — kept for reference
            return Promise.reject(error);
          }
          // ── HRMS SSO Fallback: no refresh token — send user to HRMS to re-authenticate
          const kraReturnUrl = encodeURIComponent(window.location.href);
          window.location.replace(
            `https://hrmserp.okcl.co.in/index.php?kra_redirect=${kraReturnUrl}`
          );
          return Promise.reject(error);
        }

        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh-token`, {
          refreshToken,
        });

        localStorage.setItem('accessToken', data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;

        return api(originalRequest);
      } catch (refreshError) {
        localStorage.clear();
        // ── Check suppression flag before deciding where to redirect ─────
        if (_suppressHrmsRedirect) {
          // Intentional logout — go to KRA's own login page (no loop)
          // window.location.href = '/login'; // old behaviour — kept for reference
          return Promise.reject(refreshError);
        }
        // ── HRMS SSO Fallback: refresh token invalid/expired — send user to HRMS
        const kraReturnUrl = encodeURIComponent(window.location.href);
        window.location.replace(
          `https://hrmserp.okcl.co.in/index.php?kra_redirect=${kraReturnUrl}`
        );
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
