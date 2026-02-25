import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api, { setAccessToken, clearAccessToken } from "../api/client";
import { prefetch } from "../hooks/useData";

const AuthContext = createContext(null);

// Prefetch key data after login so first dashboard render is instant
const prefetchDashboardData = () => {
    // Warm SWR cache + lazy chunk in parallel
    Promise.all([
        prefetch("/classrooms/"),
        prefetch("/fields/"),
        prefetch("/engine/status"),
        // Warm the code-split chunk as well
        import("../pages/AdminDashboard").catch(() => { }),
    ]);
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // On mount: try refresh to restore session
    useEffect(() => {
        api.post("/auth/refresh")
            .then(({ data }) => {
                setAccessToken(data.access_token);
                setUser({
                    username: data.username,
                    role: data.role,
                    field_id: data.field_id,
                    field_name: data.field_name,
                });
                // Already logged in — prefetch dashboard data now
                prefetchDashboardData();
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    const login = useCallback(async (username, password) => {
        const { data } = await api.post("/auth/login", { username, password });
        setAccessToken(data.access_token);
        setUser({
            username: data.username,
            role: data.role,
            field_id: data.field_id,
            field_name: data.field_name,
        });
        // Prefetch dashboard chunk + API data after successful login
        prefetchDashboardData();
        return data;
    }, []);

    const logout = useCallback(async () => {
        try { await api.post("/auth/logout"); } catch { }
        clearAccessToken();
        setUser(null);
        window.location.href = "/login";
    }, []);

    const isAdmin = useCallback(() => user?.role === "ADMIN", [user]);
    const isFaculty = useCallback(() => user?.role === "FACULTY", [user]);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isFaculty }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};
