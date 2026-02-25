import { lazy, Suspense, Component } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { PageSkeleton } from "./components/Skeleton";

// ── Code-split lazy pages ─────────────────────────────────────────────────────
// LoginPage is eager (tiny, needed on first paint)
import LoginPage from "./pages/LoginPage";
// Dashboard chunks are loaded on demand / prefetched after login
const FacultyDashboard = lazy(() => import("./pages/FacultyDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));

// ── Error Boundary ─────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(err) { return { error: err }; }
    render() {
        if (this.state.error) {
            return (
                <div style={{
                    minHeight: "100vh", display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    background: "#0f0f14", color: "#f1f5f9", padding: 24, fontFamily: "monospace"
                }}>
                    <h2 style={{ color: "#ef4444", marginBottom: 12 }}>⚠ App Crashed</h2>
                    <pre style={{ background: "#18181f", padding: 16, borderRadius: 8, maxWidth: 700, overflowX: "auto", fontSize: 13 }}>
                        {this.state.error?.message}{"\n\n"}{this.state.error?.stack}
                    </pre>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── Protected Route Wrappers ───────────────────────────────────────────────────
function ProtectedRoute({ children, adminOnly = false }) {
    const { user, loading } = useAuth();
    if (loading) return <PageSkeleton />;
    if (!user) return <Navigate to="/login" replace />;
    if (adminOnly && user.role !== "ADMIN") return <Navigate to="/faculty" replace />;
    return children;
}

function RootRedirect() {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (!user) return <Navigate to="/login" replace />;
    if (user.role === "ADMIN") return <Navigate to="/admin" replace />;
    return <Navigate to="/faculty" replace />;
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />

                    {/* Faculty — lazy loaded, skeleton while bundle loads */}
                    <Route
                        path="/faculty/*"
                        element={
                            <ProtectedRoute>
                                <Suspense fallback={<PageSkeleton />}>
                                    <FacultyDashboard />
                                </Suspense>
                            </ProtectedRoute>
                        }
                    />

                    {/* Admin — lazy loaded, skeleton while bundle loads */}
                    {/* WebSocketProvider is INSIDE ProtectedRoute so it only
                        mounts after auth completes and getAccessToken() is set */}
                    <Route
                        path="/admin/*"
                        element={
                            <ProtectedRoute adminOnly>
                                <WebSocketProvider>
                                    <Suspense fallback={<PageSkeleton />}>
                                        <AdminDashboard />
                                    </Suspense>
                                </WebSocketProvider>
                            </ProtectedRoute>
                        }
                    />

                    <Route path="/" element={<RootRedirect />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AuthProvider>
        </ErrorBoundary>
    );
}
