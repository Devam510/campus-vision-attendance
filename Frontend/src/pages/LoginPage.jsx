import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({ username: "", password: "" });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.username || !form.password) {
            toast.error("Please enter username and password");
            return;
        }
        setLoading(true);
        try {
            const data = await login(form.username, form.password);
            toast.success(`Welcome, ${data.username}!`);
            if (data.role === "ADMIN") navigate("/admin");
            else navigate("/faculty");
        } catch (err) {
            const msg = err.response?.data?.detail || "Login failed";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-base)",
            padding: "20px",
        }}>
            {/* Background gradient orb */}
            <div style={{
                position: "fixed", top: "20%", left: "50%",
                transform: "translateX(-50%)",
                width: "600px", height: "300px",
                background: "radial-gradient(ellipse, rgba(99,102,241,0.12) 0%, transparent 70%)",
                pointerEvents: "none",
            }} />

            <div className="fade-in" style={{
                width: "100%",
                maxWidth: "400px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-xl)",
                padding: "36px",
                boxShadow: "var(--shadow-lg)",
            }}>
                {/* Logo */}
                <div style={{ textAlign: "center", marginBottom: "32px" }}>
                    <div style={{
                        width: "56px", height: "56px",
                        background: "linear-gradient(135deg, var(--primary), #8b5cf6)",
                        borderRadius: "16px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "24px",
                        margin: "0 auto 16px",
                        boxShadow: "var(--shadow-glow)",
                    }}>
                        👁️
                    </div>
                    <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "6px" }}>AI Attendance</h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Sign in to continue</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            className="input"
                            type="text"
                            placeholder="Enter your username"
                            value={form.username}
                            onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            className="input"
                            type="password"
                            placeholder="Enter your password"
                            value={form.password}
                            onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                            autoComplete="current-password"
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary w-full btn-lg"
                        disabled={loading}
                        style={{ marginTop: "8px" }}
                    >
                        {loading ? (
                            <><span className="spinner" style={{ width: 16, height: 16 }} /> Signing in...</>
                        ) : "Sign In"}
                    </button>
                </form>

                <p style={{
                    textAlign: "center",
                    marginTop: "24px",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                }}>
                    AI Attendance System v5.0 © {new Date().getFullYear()}
                </p>
            </div>
        </div>
    );
}
