import axios from 'axios';

// In production, the frontend is served by the same Express server,
// so we use a relative path '/api'. In development (Vite dev server),
// we fall back to the full localhost URL via the env variable.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

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
          // window.location.href = '/login'; // old behaviour — kept for reference
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
        // window.location.href = '/login'; // old behaviour — kept for reference
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
