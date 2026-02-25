import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
    LayoutDashboard, Video, Users, BookOpen,
    Settings, LogOut, ChevronRight, Shield
} from "lucide-react";
import clsx from "clsx";

const FACULTY_NAV = [
    { to: "/faculty", icon: LayoutDashboard, label: "Dashboard", chunk: () => import("../pages/FacultyDashboard") },
    { to: "/faculty/stream", icon: Video, label: "Live Stream", chunk: null },
    { to: "/faculty/students", icon: Users, label: "Students", chunk: null },
    { to: "/faculty/lectures", icon: BookOpen, label: "Lectures", chunk: null },
];

const ADMIN_NAV = [
    { to: "/admin", icon: LayoutDashboard, label: "Dashboard", chunk: () => import("../pages/AdminDashboard") },
    { to: "/admin/stream", icon: Video, label: "Live Stream", chunk: null },
    { to: "/admin/fields", icon: Shield, label: "Fields", chunk: null },
    { to: "/admin/classrooms", icon: Settings, label: "Classrooms", chunk: null },
    { to: "/admin/users", icon: Users, label: "Users", chunk: null },
    { to: "/admin/students", icon: BookOpen, label: "Students", chunk: null },
    { to: "/admin/sheets", icon: BookOpen, label: "Google Sheets", chunk: null },
    { to: "/admin/engine", icon: Settings, label: "Engine", chunk: null },
];

// Hover prefetch: pre-warm the JS chunk for the target page
const handlePrefetch = (chunk) => {
    if (chunk) chunk().catch(() => { });
};

const Sidebar = memo(function Sidebar() {
    const { user, logout, isAdmin } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const navItems = isAdmin() ? ADMIN_NAV : FACULTY_NAV;

    const isActive = (path) =>
        location.pathname === path || location.pathname.startsWith(path + "/");

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div className="sidebar-logo">
                <div className="sidebar-logo-icon">👁️</div>
                <div>
                    <div style={{ fontSize: 14 }}>AI Attendance</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 400 }}>
                        {isAdmin() ? "Admin" : "Faculty"}
                    </div>
                </div>
            </div>

            {/* Nav */}
            <nav className="sidebar-nav">
                {navItems.map(({ to, icon: Icon, label, chunk }) => (
                    <button
                        key={to}
                        className={clsx("sidebar-item", isActive(to) && "active")}
                        onClick={() => navigate(to)}
                        onMouseEnter={() => handlePrefetch(chunk)}
                    >
                        <Icon size={16} />
                        <span>{label}</span>
                        {isActive(to) && <ChevronRight size={14} style={{ marginLeft: "auto" }} />}
                    </button>
                ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
                {user && (
                    <div style={{ marginBottom: 12, padding: "8px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{user.username}</div>
                        {user.field_name && (
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                                {user.field_name}
                            </div>
                        )}
                    </div>
                )}
                <button className="sidebar-item" onClick={logout} style={{ color: "var(--danger)" }}>
                    <LogOut size={16} />
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
});

export default Sidebar;
