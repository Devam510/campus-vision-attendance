import axios from "axios";

const api = axios.create({
    baseURL: "/api",
    withCredentials: true,  // include httpOnly cookies for refresh
});

// ── Token storage (in-memory for access token) ────────────────────────────────
let _accessToken = null;

export const setAccessToken = (token) => { _accessToken = token; };
export const getAccessToken = () => _accessToken;
export const clearAccessToken = () => { _accessToken = null; };

// ── Request interceptor: attach access token ──────────────────────────────────
api.interceptors.request.use((config) => {
    if (_accessToken) {
        config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
});

// ── Response interceptor: auto-refresh on 401 ─────────────────────────────────
let _refreshing = false;
let _queue = [];

api.interceptors.response.use(
    (res) => res,
    async (error) => {
        const original = error.config;
        const url = original?.url || "";

        // Don't intercept auth endpoints — they handle their own 401s
        const isAuthEndpoint = url.includes("/auth/refresh") || url.includes("/auth/login");

        if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
            if (_refreshing) {
                // Queue the request until refresh completes
                return new Promise((resolve, reject) => {
                    _queue.push({ resolve, reject });
                }).then(() => api(original));
            }
            original._retry = true;
            _refreshing = true;
            try {
                const { data } = await api.post("/auth/refresh");
                setAccessToken(data.access_token);
                _queue.forEach((p) => p.resolve());
                _queue = [];
                original.headers.Authorization = `Bearer ${data.access_token}`;
                return api(original);
            } catch (refreshErr) {
                _queue.forEach((p) => p.reject(refreshErr));
                _queue = [];
                clearAccessToken();
                window.location.href = "/login";
                return Promise.reject(refreshErr);
            } finally {
                _refreshing = false;
            }
        }
        return Promise.reject(error);
    }
);

export default api;
