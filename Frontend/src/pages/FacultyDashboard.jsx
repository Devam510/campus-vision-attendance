import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";
import Sidebar from "../components/Sidebar";
import VideoStream from "../components/VideoStream";
import PresenceTable from "../components/PresenceTable";
import { usePresenceStream } from "../hooks/useWebSocket";
import { Users, BookOpen, Activity, Download, Video } from "lucide-react";
import toast from "react-hot-toast";


// ── Dashboard Home ────────────────────────────────────────────────────────────
function FacultyHome() {
    const { user } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [lectures, setLectures] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [loading, setLoading] = useState(true);

    const { data: presenceData, status: wsStatus } = usePresenceStream(selectedClassroom?.id);

    useEffect(() => {
        (async () => {
            try {
                const crRes = await api.get("/classrooms/");
                setClassrooms(crRes.data);
                if (crRes.data.length > 0) setSelectedClassroom(crRes.data[0]);
            } catch {
                toast.error("Failed to load classrooms");
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        if (!selectedClassroom) return;
        api.get(`/lectures/?classroom_id=${selectedClassroom.id}`)
            .then(r => setLectures(r.data.slice(0, 5)))
            .catch(() => { });
    }, [selectedClassroom]);

    const handleExport = async (lectureId) => {
        try {
            const res = await api.get(`/attendance/export/${lectureId}`, { responseType: "blob" });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url; a.download = `attendance_${lectureId}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Exported successfully");
        } catch {
            toast.error("Export failed");
        }
    };

    if (loading) return <div style={{ textAlign: "center", padding: 48 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>;

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Faculty Dashboard</h1>
                <p className="page-subtitle">
                    {user?.field_name ? `Field: ${user.field_name}` : "Real-time attendance tracking"}
                </p>
            </div>

            {/* Classroom Selector */}
            {classrooms.length > 0 && (
                <div className="card" style={{ padding: "16px 20px", marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label style={{ marginBottom: 0, whiteSpace: "nowrap" }}>Classroom:</label>
                        <select
                            id="classroom-select"
                            className="select"
                            style={{ maxWidth: 280 }}
                            value={selectedClassroom?.id || ""}
                            onChange={e => {
                                const cr = classrooms.find(c => c.id === parseInt(e.target.value));
                                setSelectedClassroom(cr || null);
                            }}
                        >
                            {classrooms.map(c => (
                                <option key={c.id} value={c.id}>{c.classroom_name}</option>
                            ))}
                        </select>
                        <span style={{
                            fontSize: 12, color: wsStatus === "connected" ? "var(--success)" : "var(--warning)",
                            display: "flex", alignItems: "center", gap: 4,
                        }}>
                            <span className={`dot ${wsStatus === "connected" ? "dot-green dot-pulse" : "dot-yellow"}`} />
                            {wsStatus === "connected" ? "Live" : "Connecting..."}
                        </span>
                    </div>
                </div>
            )}

            {/* Stats */}
            <div className="grid-4" style={{ marginBottom: 24 }}>
                {[
                    {
                        icon: Users, label: "Students Present",
                        value: presenceData ? presenceData.students.filter(s => s.total_seconds > 0).length : 0,
                        color: "var(--success)"
                    },
                    {
                        icon: BookOpen, label: "Active Lecture",
                        value: presenceData ? 1 : 0,
                        color: "var(--primary)"
                    },
                    {
                        icon: Activity, label: "Total Enrolled",
                        value: presenceData?.students.length || 0,
                        color: "var(--text-secondary)"
                    },
                    {
                        icon: Download, label: "Recent Lectures",
                        value: lectures.length,
                        color: "var(--text-secondary)"
                    },
                ].map(({ icon: Icon, label, value, color }) => (
                    <div key={label} className="stat-card">
                        <div className="stat-icon" style={{ background: `${color}18` }}>
                            <Icon size={20} color={color} />
                        </div>
                        <div className="stat-value" style={{ color }}>{value}</div>
                        <div className="stat-label">{label}</div>
                    </div>
                ))}
            </div>

            {/* Main content: Video + Presence */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                <VideoStream classroomId={selectedClassroom?.id} />
                <PresenceTable data={presenceData} />
            </div>

            {/* Recent Lectures */}
            {lectures.length > 0 && (
                <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>
                        Recent Lectures
                    </div>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Lecture</th>
                                <th>Date</th>
                                <th>Time</th>
                                <th>Status</th>
                                <th>Export</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lectures.map(l => (
                                <tr key={l.id}>
                                    <td style={{ fontWeight: 500 }}>{l.lecture_name}</td>
                                    <td>{l.lecture_date}</td>
                                    <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                        {new Date(l.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                                        {new Date(l.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                    <td>
                                        <span className={`badge ${l.finalized ? "badge-success" : "badge-warning"}`}>
                                            {l.finalized ? "Finalized" : "Ongoing"}
                                        </span>
                                    </td>
                                    <td>
                                        {l.finalized && (
                                            <button
                                                id={`export-${l.id}`}
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => handleExport(l.id)}
                                            >
                                                <Download size={12} /> CSV
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}


// ── Live Stream View ──────────────────────────────────────────────────────────
function StreamView() {
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const { data: presenceData, status: wsStatus } = usePresenceStream(selectedClassroom?.id);

    useEffect(() => {
        api.get("/classrooms/").then(r => {
            setClassrooms(r.data);
            if (r.data.length > 0) setSelectedClassroom(r.data[0]);
        }).catch(() => toast.error("Failed to load classrooms"));
    }, []);

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Live Stream</h1>
                <p className="page-subtitle">Real-time camera feed and presence tracking</p>
            </div>

            {classrooms.length > 0 && (
                <div className="card" style={{ padding: "16px 20px", marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label style={{ marginBottom: 0 }}>Classroom:</label>
                        <select
                            className="select" style={{ maxWidth: 280 }}
                            value={selectedClassroom?.id || ""}
                            onChange={e => setSelectedClassroom(classrooms.find(c => c.id === parseInt(e.target.value)) || null)}
                        >
                            {classrooms.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                        </select>
                        <span style={{ fontSize: 12, color: wsStatus === "connected" ? "var(--success)" : "var(--warning)", display: "flex", alignItems: "center", gap: 4 }}>
                            <span className={`dot ${wsStatus === "connected" ? "dot-green dot-pulse" : "dot-yellow"}`} />
                            {wsStatus === "connected" ? "Live" : "Connecting..."}
                        </span>
                    </div>
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <VideoStream classroomId={selectedClassroom?.id} />
                <PresenceTable data={presenceData} />
            </div>
        </>
    );
}


// ── Students View ─────────────────────────────────────────────────────────────
function StudentsView() {
    const [classrooms, setClassrooms] = useState([]);
    const [students, setStudents] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get("/classrooms/").then(r => {
            setClassrooms(r.data);
            if (r.data.length > 0) setSelectedClassroom(r.data[0]);
        }).catch(() => toast.error("Failed to load classrooms")).finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!selectedClassroom) return;
        api.get(`/students/?classroom_id=${selectedClassroom.id}`)
            .then(r => setStudents(r.data))
            .catch(() => toast.error("Failed to load students"));
    }, [selectedClassroom]);

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Students</h1>
                <p className="page-subtitle">View students enrolled in your classrooms</p>
            </div>

            {classrooms.length > 0 && (
                <div className="card" style={{ padding: "16px 20px", marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label style={{ marginBottom: 0 }}>Classroom:</label>
                        <select
                            className="select" style={{ maxWidth: 280 }}
                            value={selectedClassroom?.id || ""}
                            onChange={e => setSelectedClassroom(classrooms.find(c => c.id === parseInt(e.target.value)) || null)}
                        >
                            {classrooms.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: "center", padding: 48 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>
                        {students.length} Students enrolled
                    </div>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Enrollment No</th>
                                <th>Roll No</th>
                                <th>Embedding</th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 32 }}>No students found</td></tr>
                            ) : students.map((s, i) => (
                                <tr key={s.id}>
                                    <td style={{ color: "var(--text-secondary)" }}>{i + 1}</td>
                                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                                    <td>{s.enrollment_no || "—"}</td>
                                    <td>{s.roll_no || "—"}</td>
                                    <td>
                                        <span className={`badge ${s.has_embedding ? "badge-success" : "badge-danger"}`}>
                                            {s.has_embedding ? "Ready" : "Missing"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}


// ── Lectures View ─────────────────────────────────────────────────────────────
function LecturesView() {
    const [classrooms, setClassrooms] = useState([]);
    const [lectures, setLectures] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.get("/classrooms/").then(r => {
            setClassrooms(r.data);
            if (r.data.length > 0) setSelectedClassroom(r.data[0]);
        }).catch(() => toast.error("Failed to load classrooms"));
    }, []);

    useEffect(() => {
        if (!selectedClassroom) return;
        setLoading(true);
        api.get(`/lectures/?classroom_id=${selectedClassroom.id}`)
            .then(r => setLectures(r.data))
            .catch(() => toast.error("Failed to load lectures"))
            .finally(() => setLoading(false));
    }, [selectedClassroom]);

    const handleExport = async (lectureId) => {
        try {
            const res = await api.get(`/attendance/export/${lectureId}`, { responseType: "blob" });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement("a");
            a.href = url; a.download = `attendance_${lectureId}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Exported successfully");
        } catch {
            toast.error("Export failed");
        }
    };

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Lectures</h1>
                <p className="page-subtitle">View and export lecture attendance records</p>
            </div>

            {classrooms.length > 0 && (
                <div className="card" style={{ padding: "16px 20px", marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label style={{ marginBottom: 0 }}>Classroom:</label>
                        <select
                            className="select" style={{ maxWidth: 280 }}
                            value={selectedClassroom?.id || ""}
                            onChange={e => setSelectedClassroom(classrooms.find(c => c.id === parseInt(e.target.value)) || null)}
                        >
                            {classrooms.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: "center", padding: 48 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>
                        {lectures.length} Lectures
                    </div>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Lecture</th>
                                <th>Date</th>
                                <th>Time</th>
                                <th>Status</th>
                                <th>Export</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lectures.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-secondary)", padding: 32 }}>No lectures found</td></tr>
                            ) : lectures.map(l => (
                                <tr key={l.id}>
                                    <td style={{ fontWeight: 500 }}>{l.lecture_name}</td>
                                    <td>{l.lecture_date}</td>
                                    <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                        {new Date(l.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                                        {new Date(l.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                    <td>
                                        <span className={`badge ${l.finalized ? "badge-success" : "badge-warning"}`}>
                                            {l.finalized ? "Finalized" : "Ongoing"}
                                        </span>
                                    </td>
                                    <td>
                                        {l.finalized && (
                                            <button
                                                id={`export-${l.id}`}
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => handleExport(l.id)}
                                            >
                                                <Download size={12} /> CSV
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}


// ── Shell ─────────────────────────────────────────────────────────────────────
export default function FacultyDashboard() {
    return (
        <div className="layout">
            <Sidebar />
            <main className="main-content">
                <Routes>
                    <Route index element={<FacultyHome />} />
                    <Route path="stream" element={<StreamView />} />
                    <Route path="students" element={<StudentsView />} />
                    <Route path="lectures" element={<LecturesView />} />
                    <Route path="*" element={<Navigate to="/faculty" replace />} />
                </Routes>
            </main>
        </div>
    );
}
