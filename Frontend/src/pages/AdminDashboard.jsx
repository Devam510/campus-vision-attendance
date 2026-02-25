import { useState, useEffect, useCallback, memo } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import VideoStream from "../components/VideoStream";
import PresenceTable from "../components/PresenceTable";
import FaceScanModal from "../components/FaceScanModal";
import { SkeletonTable, SkeletonCard } from "../components/Skeleton";
import { useData, invalidate } from "../hooks/useData";
import { usePresenceContext } from "../context/WebSocketContext";
import api from "../api/client";
import {
    Users, Settings, Activity, Shield,
    Play, StopCircle, RefreshCw,
    CheckCircle, XCircle, Plus, Trash2, Camera, ExternalLink, BookOpen, Clock
} from "lucide-react";
import toast from "react-hot-toast";

// ── Shared stat card ──────────────────────────────────────────────────────────
const StatCard = memo(function StatCard({ icon: Icon, label, value, color }) {
    return (
        <div className="stat-card">
            <div className="stat-icon" style={{ background: `${color}18` }}>
                <Icon size={20} color={color} />
            </div>
            <div className="stat-value" style={{ color, fontSize: typeof value === "string" ? 18 : 28 }}>{value}</div>
            <div className="stat-label">{label}</div>
        </div>
    );
});

// ── Active Lecture Banner ─────────────────────────────────────────────────────
function ActiveLectureBanner({ classroomId }) {
    const key = classroomId ? `/lectures/active?classroom_id=${classroomId}` : null;
    const { data: lecture, loading } = useData(key, { refreshInterval: 30000 });

    if (!classroomId) return null;

    const fmtTime = (dt) => {
        if (!dt) return "—";
        const t = new Date(dt);
        // dt comes as naive IST string — display as-is using time components
        const h = t.getHours().toString().padStart(2, "0");
        const m = t.getMinutes().toString().padStart(2, "0");
        return `${h}:${m}`;
    };

    if (loading) return null;

    if (!lecture) {
        return (
            <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
                borderRadius: 10, padding: "12px 18px",
                marginBottom: 20, fontSize: 13,
                color: "var(--text-muted)",
            }}>
                <Clock size={15} />
                <span>No active lecture right now</span>
            </div>
        );
    }

    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 10, padding: "14px 20px",
            marginBottom: 20,
        }}>
            <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: "50%",
                background: "rgba(34,197,94,0.15)", flexShrink: 0,
            }}>
                <BookOpen size={17} color="var(--success)" />
            </span>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--success)" }}>
                    🟢 {lecture.lecture_name}
                    <span style={{
                        marginLeft: 10, fontSize: 11, fontWeight: 400,
                        background: "rgba(34,197,94,0.15)", color: "var(--success)",
                        padding: "2px 8px", borderRadius: 999,
                    }}>LIVE</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                    {fmtTime(lecture.start_time)} – {fmtTime(lecture.end_time)}
                    &nbsp;·&nbsp;
                    {new Date(lecture.lecture_date).toLocaleDateString()}
                </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", flexShrink: 0 }}>
                id #{lecture.id}
            </div>
        </div>
    );
}

// ── Dashboard Home ────────────────────────────────────────────────────────────
function DashboardHome() {
    const { data: classrooms } = useData("/classrooms/");
    const { data: fields } = useData("/fields/");
    const { data: sheets } = useData("/sheets/");
    const { data: engineStatus, reload: reloadEngine } = useData("/engine/status", { refreshInterval: 5000 });
    const { data: metrics } = useData("/engine/metrics", { refreshInterval: 5000 });
    const { presenceData, classroomId, selectClassroom } = usePresenceContext();
    const [engineLoading, setEngineLoading] = useState(false);

    const selectedClassroom = classrooms?.find(c => c.id === classroomId) || classrooms?.[0] || null;

    useEffect(() => {
        if (classrooms?.length && !classroomId) selectClassroom(classrooms[0].id);
    }, [classrooms]);

    const startEngine = async () => {
        if (!selectedClassroom) return;
        setEngineLoading(true);
        try {
            await api.post("/engine/start", { classroom_id: selectedClassroom.id });
            toast.success(`Engine started for ${selectedClassroom.classroom_name}`);
            reloadEngine();
        } catch (e) { toast.error(e.response?.data?.detail || "Failed to start engine"); }
        finally { setEngineLoading(false); }
    };

    const stopEngine = async () => {
        setEngineLoading(true);
        try {
            await api.post("/engine/stop");
            toast.success("Engine stopped");
            reloadEngine();
        } catch { toast.error("Failed to stop engine"); }
        finally { setEngineLoading(false); }
    };

    const isRunning = engineStatus?.running ?? false;

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Admin Dashboard</h1>
                <p className="page-subtitle">System management & engine control</p>
            </div>

            <div className="grid-4" style={{ marginBottom: 20 }}>
                <StatCard icon={Shield} label="Fields" value={fields?.length ?? "…"} color="var(--primary)" />
                <StatCard icon={Settings} label="Classrooms" value={classrooms?.length ?? "…"} color="#8b5cf6" />
                <StatCard icon={Activity} label="Engine" value={isRunning ? "RUNNING" : "STOPPED"} color={isRunning ? "var(--success)" : "var(--danger)"} />
                <StatCard icon={RefreshCw} label="Active Sheets" value={sheets?.filter(s => s.active).length ?? "…"} color="var(--warning)" />
            </div>

            {/* Active Lecture Banner — always visible, no engine needed */}
            <ActiveLectureBanner classroomId={selectedClassroom?.id} />

            {/* Engine Control */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>Engine Control</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <select className="select" style={{ maxWidth: 240 }}
                        value={selectedClassroom?.id || ""}
                        onChange={e => selectClassroom(parseInt(e.target.value))}>
                        {classrooms?.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                    </select>
                    <button className="btn btn-success" onClick={startEngine} disabled={engineLoading || isRunning}>
                        {engineLoading ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Starting...</> : <><Play size={14} /> Start Engine</>}
                    </button>
                    <button className="btn btn-danger" onClick={stopEngine} disabled={engineLoading || !isRunning}>
                        <StopCircle size={14} /> Stop Engine
                    </button>
                    {isRunning && (
                        <span style={{ fontSize: 13, color: "var(--success)", display: "flex", alignItems: "center", gap: 6 }}>
                            <span className="dot dot-green dot-pulse" />
                            Running in {classrooms?.find(c => c.id === engineStatus.classroom_id)?.classroom_name || "classroom"}
                        </span>
                    )}
                </div>
                {metrics && (
                    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                        {[
                            { label: "FPS", value: metrics.fps?.toFixed(1) },
                            { label: "Active Tracks", value: metrics.active_tracks },
                            { label: "Frames", value: metrics.frames_processed?.toLocaleString() },
                            { label: "Recog Latency", value: `${metrics.recognition_latency_ms?.toFixed(0)}ms` },
                            { label: "Video WS", value: metrics.ws_video_clients },
                            { label: "Presence WS", value: metrics.ws_presence_clients },
                        ].map(({ label, value }) => (
                            <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value ?? "—"}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <VideoStream classroomId={selectedClassroom?.id} />
                <PresenceTable data={presenceData} />
            </div>
        </>
    );
}

// ── Fields View ───────────────────────────────────────────────────────────────
function FieldsView() {
    const { data: fields, loading } = useData("/fields/");
    const [name, setName] = useState("");

    const create = async () => {
        if (!name.trim()) return;
        try { await api.post("/fields/", { name }); toast.success("Field created"); setName(""); invalidate("/fields/"); }
        catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    const del = async (id) => {
        if (!confirm("Delete this field?")) return;
        try { await api.delete(`/fields/${id}`); toast.success("Deleted"); invalidate("/fields/"); }
        catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    return (
        <>
            <div className="page-header"><h1 className="page-title">Fields</h1><p className="page-subtitle">Manage academic fields / departments</p></div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>Add Field</div>
                <div style={{ display: "flex", gap: 10 }}>
                    <input className="input" placeholder="Field name (e.g. Computer Science)" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} style={{ flex: 1 }} />
                    <button className="btn btn-primary" onClick={create}><Plus size={14} /> Add</button>
                </div>
            </div>
            {loading ? <SkeletonTable rows={4} cols={4} /> : (
                <div className="card" style={{ padding: 0 }}>
                    <table className="table">
                        <thead><tr><th>ID</th><th>Name</th><th>Created</th><th>Actions</th></tr></thead>
                        <tbody>
                            {fields?.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>No fields yet</td></tr>}
                            {fields?.map(f => (
                                <tr key={f.id}>
                                    <td style={{ color: "var(--text-muted)" }}>{f.id}</td>
                                    <td style={{ fontWeight: 500 }}>{f.name}</td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(f.created_at).toLocaleDateString()}</td>
                                    <td><button className="btn btn-danger btn-sm" onClick={() => del(f.id)}><Trash2 size={12} /> Delete</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

// ── Classrooms View ───────────────────────────────────────────────────────────
function ClassroomsView() {
    const { data: classrooms, loading } = useData("/classrooms/");
    const { data: fields } = useData("/fields/");
    const [form, setForm] = useState({ classroom_name: "", field_id: "", camera_source: "0" });

    const create = async () => {
        if (!form.classroom_name || !form.field_id) return toast.error("Name and field required");
        try {
            await api.post("/classrooms/", { ...form, field_id: parseInt(form.field_id) });
            toast.success("Classroom created"); setForm({ classroom_name: "", field_id: "", camera_source: "0" });
            invalidate("/classrooms/");
        } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    const del = async (id) => {
        if (!confirm("Delete this classroom?")) return;
        try { await api.delete(`/classrooms/${id}`); toast.success("Deleted"); invalidate("/classrooms/"); }
        catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    return (
        <>
            <div className="page-header"><h1 className="page-title">Classrooms</h1><p className="page-subtitle">Manage classrooms and camera sources</p></div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>Add Classroom</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10 }}>
                    <input className="input" placeholder="Classroom name" value={form.classroom_name} onChange={e => setForm(f => ({ ...f, classroom_name: e.target.value }))} />
                    <select className="select" value={form.field_id} onChange={e => setForm(f => ({ ...f, field_id: e.target.value }))}>
                        <option value="">Select field</option>
                        {fields?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <input className="input" placeholder="Camera (0 or RTSP URL)" value={form.camera_source} onChange={e => setForm(f => ({ ...f, camera_source: e.target.value }))} />
                    <button className="btn btn-primary" onClick={create}><Plus size={14} /> Add</button>
                </div>
            </div>
            {loading ? <SkeletonTable rows={3} cols={5} /> : (
                <div className="card" style={{ padding: 0 }}>
                    <table className="table">
                        <thead><tr><th>ID</th><th>Name</th><th>Field</th><th>Camera</th><th>Active</th><th>Actions</th></tr></thead>
                        <tbody>
                            {classrooms?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No classrooms yet</td></tr>}
                            {classrooms?.map(c => (
                                <tr key={c.id}>
                                    <td style={{ color: "var(--text-muted)" }}>{c.id}</td>
                                    <td style={{ fontWeight: 500 }}>{c.classroom_name}</td>
                                    <td>{fields?.find(f => f.id === c.field_id)?.name || c.field_id}</td>
                                    <td style={{ fontSize: 12, fontFamily: "monospace" }}>{c.camera_source}</td>
                                    <td><span className={`badge ${c.is_active ? "badge-success" : "badge-neutral"}`}>{c.is_active ? "Active" : "Inactive"}</span></td>
                                    <td><button className="btn btn-danger btn-sm" onClick={() => del(c.id)}><Trash2 size={12} /> Delete</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

// ── Students View ─────────────────────────────────────────────────────────────
function StudentsView() {
    const { data: classrooms } = useData("/classrooms/");
    const { classroomId, selectClassroom } = usePresenceContext();
    const crId = classroomId || classrooms?.[0]?.id;
    const studentsKey = crId ? `/students/?classroom_id=${crId}` : null;
    const { data: students, loading } = useData(studentsKey);
    const [scanStudent, setScanStudent] = useState(null); // student object to scan

    const del = async (id) => {
        if (!confirm("Delete this student?")) return;
        try {
            await api.delete(`/students/${id}`);
            toast.success("Student deleted");
            invalidate(studentsKey);
        } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    const missing = students?.filter(s => !s.embedding_json).length ?? 0;

    return (
        <>
            <div className="page-header">
                <h1 className="page-title">Students</h1>
                <p className="page-subtitle">Registered students and face embeddings</p>
            </div>

            {/* Workflow hint */}
            {missing > 0 && (
                <div style={{
                    background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)",
                    borderRadius: 10, padding: "10px 16px", marginBottom: 16,
                    fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 10,
                }}>
                    <span style={{ fontSize: 18 }}>💡</span>
                    <span>
                        <strong>{missing} student{missing > 1 ? "s" : ""}</strong> with missing face embeddings.
                        Click <strong>📷 Register Face</strong> on each row to do a live scan — no need to add them again.
                    </span>
                </div>
            )}

            <div style={{ marginBottom: 16 }}>
                <select className="select" style={{ maxWidth: 260 }}
                    value={crId || ""}
                    onChange={e => selectClassroom(parseInt(e.target.value))}>
                    <option value="">Select classroom</option>
                    {classrooms?.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                </select>
            </div>

            {loading ? <SkeletonTable rows={5} cols={6} /> : (
                <div className="card" style={{ padding: 0 }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>ID</th><th>Name</th><th>Enrollment</th>
                                <th>Roll</th><th>Embedding</th><th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!crId && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>Select a classroom</td></tr>}
                            {students?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No students</td></tr>}
                            {students?.map(s => (
                                <tr key={s.id}>
                                    <td style={{ color: "var(--text-muted)" }}>{s.id}</td>
                                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                                    <td>{s.enrollment_no || "—"}</td>
                                    <td>{s.roll_no || "—"}</td>
                                    <td>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span className={`badge ${s.embedding_json ? "badge-success" : "badge-neutral"}`}>
                                                {s.embedding_json
                                                    ? <><CheckCircle size={11} /> Ready</>
                                                    : <><XCircle size={11} /> Missing</>}
                                            </span>
                                            {/* Quality score badge */}
                                            {s.embedding_json && s.embedding_quality_score != null && (
                                                <span title={`Based on ${s.embedding_frames_used ?? "?"} frames`} style={{
                                                    fontSize: 11, padding: "2px 7px", borderRadius: 6,
                                                    background: s.embedding_quality_score >= 0.90
                                                        ? "rgba(34,197,94,0.15)"
                                                        : s.embedding_quality_score >= 0.75
                                                            ? "rgba(234,179,8,0.15)"
                                                            : "rgba(239,68,68,0.15)",
                                                    color: s.embedding_quality_score >= 0.90
                                                        ? "#22c55e"
                                                        : s.embedding_quality_score >= 0.75
                                                            ? "#eab308"
                                                            : "#ef4444",
                                                    fontWeight: 600,
                                                    border: "1px solid currentColor",
                                                }}>
                                                    Q: {(s.embedding_quality_score * 100).toFixed(0)}%
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <button
                                                className={`btn btn-sm ${s.embedding_json ? "btn-ghost" : "btn-primary"}`}
                                                onClick={() => setScanStudent(s)}
                                                title={s.embedding_json ? "Re-register face (live scan)" : "Register face (live scan)"}
                                            >
                                                <Camera size={13} />
                                                {s.embedding_json ? " Re-register" : " Register Face"}
                                            </button>
                                            <button className="btn btn-danger btn-sm" onClick={() => del(s.id)}>
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Live scan modal */}
            {scanStudent && (
                <FaceScanModal
                    student={scanStudent}
                    classroomKey={studentsKey}
                    onClose={() => setScanStudent(null)}
                    onSuccess={() => {
                        toast.success(`Face registered for ${scanStudent.name} ✓`);
                        setScanStudent(null);
                    }}
                />
            )}
        </>
    );
}


// ── Users View ────────────────────────────────────────────────────────────────
function UsersView() {
    const { data: users, loading } = useData("/users/");
    const { data: fields } = useData("/fields/");
    const [form, setForm] = useState({ username: "", email: "", password: "", role: "FACULTY", field_id: "" });

    const create = async () => {
        if (!form.username || !form.email || !form.password) return toast.error("Username, email and password required");
        try {
            await api.post("/users/", { ...form, field_id: form.field_id ? parseInt(form.field_id) : null });
            toast.success("User created"); setForm({ username: "", email: "", password: "", role: "FACULTY", field_id: "" });
            invalidate("/users/");
        } catch (e) {
            const det = e.response?.data?.detail;
            const msg = Array.isArray(det)
                ? det.map(d => d.msg || JSON.stringify(d)).join("; ")
                : (det || "Failed to create user");
            toast.error(msg);
        }
    };

    const del = async (id) => {
        if (!confirm("Delete this user?")) return;
        try { await api.delete(`/users/${id}`); toast.success("Deleted"); invalidate("/users/"); }
        catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    };

    return (
        <>
            <div className="page-header"><h1 className="page-title">Users</h1><p className="page-subtitle">Manage system users and roles</p></div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>Add User</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto", gap: 10 }}>
                    <input className="input" placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                    <input className="input" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    <input className="input" type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                    <select className="select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="FACULTY">Faculty</option>
                        <option value="ADMIN">Admin</option>
                    </select>
                    <select className="select" value={form.field_id} onChange={e => setForm(f => ({ ...f, field_id: e.target.value }))}>
                        <option value="">No field</option>
                        {fields?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={create}><Plus size={14} /> Add</button>
                </div>
            </div>
            {loading ? <SkeletonTable rows={3} cols={6} /> : (
                <div className="card" style={{ padding: 0 }}>
                    <table className="table">
                        <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Field</th><th>Active</th><th>Actions</th></tr></thead>
                        <tbody>
                            {users?.map(u => (
                                <tr key={u.id}>
                                    <td style={{ fontWeight: 500 }}>{u.username}</td>
                                    <td style={{ color: "var(--text-secondary)" }}>{u.email || "—"}</td>
                                    <td><span className={`badge ${u.role === "ADMIN" ? "badge-warning" : "badge-neutral"}`}>{u.role}</span></td>
                                    <td>{fields?.find(f => f.id === u.field_id)?.name || "—"}</td>
                                    <td><span className={`badge ${u.is_active ? "badge-success" : "badge-neutral"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                                    <td><button className="btn btn-danger btn-sm" onClick={() => del(u.id)}><Trash2 size={12} /> Delete</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

// ── Sheets View ───────────────────────────────────────────────────────────────
/** Extract spreadsheet ID from a full Google Sheets URL or pass through raw ID */
function extractSheetId(input) {
    if (!input) return "";
    const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : input.trim();
}

function SheetsView() {
    const { data: sheets, loading, reload: reloadSheets } = useData("/sheets/");
    const { data: fields } = useData("/fields/");

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ sheet_name: "", url_or_id: "", field_id: "" });
    const [saving, setSaving] = useState(false);

    const openModal = () => { setForm({ sheet_name: "", url_or_id: "", field_id: "" }); setShowModal(true); };
    const closeModal = () => setShowModal(false);

    const handleAdd = async () => {
        const spreadsheet_id = extractSheetId(form.url_or_id);
        if (!form.sheet_name.trim()) return toast.error("Sheet name is required");
        if (!spreadsheet_id) return toast.error("Paste the Google Sheet URL or Spreadsheet ID");
        if (!form.field_id) return toast.error("Select a field");

        setSaving(true);
        try {
            // 1 — Create the sheet config
            const created = await api.post("/sheets/", {
                sheet_name: form.sheet_name.trim(),
                spreadsheet_id,
                field_id: parseInt(form.field_id),
            });
            toast.success("Sheet added — activating & syncing…");

            // 2 — Activate immediately (validates format + triggers sync)
            try {
                await api.post(`/sheets/${created.data.id}/activate`);
                toast.success("Sheet activated and syncing in background ✓");
            } catch (e) {
                toast.error("Added but activation failed: " + (e.response?.data?.detail || e.message));
            }

            invalidate("/sheets/");
            closeModal();
        } catch (e) {
            const det = e.response?.data?.detail;
            const msg = Array.isArray(det) ? det.map(d => d.msg).join("; ") : (det || "Failed to add sheet");
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const del = async (id) => {
        if (!confirm("Delete this sheet config?")) return;
        try {
            await api.delete(`/sheets/${id}`);
            toast.success("Deleted");
            invalidate("/sheets/");
        } catch (e) { toast.error(e.response?.data?.detail || "Failed to delete"); }
    };

    const sync = async (id) => {
        try {
            await api.post(`/sheets/${id}/sync`);
            toast.success("Synced! Last sync time updated.");
            invalidate("/sheets/");   // refresh table so last_synced_at updates
        }
        catch (e) { toast.error(e.response?.data?.detail || "Sync failed — is sheet active?"); }
    };

    const activate = async (id) => {
        try { await api.post(`/sheets/${id}/activate`); toast.success("Activated & syncing"); invalidate("/sheets/"); }
        catch (e) { toast.error(e.response?.data?.detail || "Activation failed"); }
    };

    return (
        <>
            <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                    <h1 className="page-title">Google Sheets</h1>
                    <p className="page-subtitle">Sync lecture schedules from Google Sheets</p>
                </div>
                <button className="btn btn-primary" onClick={openModal} style={{ marginTop: 4 }}>
                    <Plus size={14} /> Add Sheet
                </button>
            </div>

            {/* ── Modal ── */}
            {showModal && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000,
                    background: "rgba(0,0,0,0.6)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                }}>
                    <div className="card" style={{ width: 480, padding: 28, position: "relative" }}>
                        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>
                            📊 Add Google Sheet
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            {/* Sheet nickname */}
                            <div>
                                <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                                    Sheet Nickname
                                </label>
                                <input
                                    className="input" autoFocus
                                    placeholder="e.g. BTECH 2024-25 Semester 2"
                                    value={form.sheet_name}
                                    onChange={e => setForm(f => ({ ...f, sheet_name: e.target.value }))}
                                />
                            </div>

                            {/* URL or ID */}
                            <div>
                                <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                                    Google Sheet URL <span style={{ color: "var(--text-muted)" }}>(paste the full link)</span>
                                </label>
                                <input
                                    className="input"
                                    placeholder="https://docs.google.com/spreadsheets/d/…"
                                    value={form.url_or_id}
                                    onChange={e => setForm(f => ({ ...f, url_or_id: e.target.value }))}
                                />
                                {form.url_or_id && (
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                                        ID detected: <code style={{ color: "var(--primary)" }}>{extractSheetId(form.url_or_id) || "—"}</code>
                                    </div>
                                )}
                            </div>

                            {/* Field */}
                            <div>
                                <label style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
                                    Field (Department)
                                </label>
                                <select
                                    className="select"
                                    value={form.field_id}
                                    onChange={e => setForm(f => ({ ...f, field_id: e.target.value }))}
                                >
                                    <option value="">Select a field…</option>
                                    {fields?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            </div>

                            {/* Hint */}
                            <div style={{
                                background: "var(--bg-elevated)", borderRadius: 8, padding: "10px 14px",
                                fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6,
                            }}>
                                💡 Make sure the sheet is shared with the service account email (Viewer access).
                                Tab names must match your classroom names exactly.
                            </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end" }}>
                            <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
                                {saving ? "Adding…" : "✓ Add & Sync"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Table ── */}
            {loading ? <SkeletonTable rows={3} cols={5} /> : (
                <div className="card" style={{ padding: 0 }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Field</th>
                                <th>Last Synced</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sheets?.length === 0 && (
                                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                                    No sheets configured — click <strong>Add Sheet</strong> above
                                </td></tr>
                            )}
                            {sheets?.map(s => (
                                <tr key={s.id}>
                                    <td style={{ fontWeight: 500 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            {s.sheet_name}
                                            <a
                                                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="Open in Google Sheets"
                                                style={{ color: "var(--text-muted)", lineHeight: 0 }}
                                            >
                                                <ExternalLink size={12} />
                                            </a>
                                        </div>
                                    </td>
                                    <td>{fields?.find(f => f.id === s.field_id)?.name || `Field ${s.field_id}`}</td>
                                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                        {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : "Never"}
                                    </td>
                                    <td>
                                        <span className={`badge ${s.active ? "badge-success" : "badge-neutral"}`}>
                                            {s.active ? <><CheckCircle size={11} /> Active</> : <><XCircle size={11} /> Inactive</>}
                                        </span>
                                    </td>
                                    <td>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            {!s.active && (
                                                <button className="btn btn-primary btn-sm" onClick={() => activate(s.id)}>
                                                    Activate
                                                </button>
                                            )}
                                            {s.active && (
                                                <button className="btn btn-ghost btn-sm" onClick={() => sync(s.id)}>
                                                    <RefreshCw size={12} /> Sync
                                                </button>
                                            )}
                                            <button className="btn btn-danger btn-sm" onClick={() => del(s.id)}>
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
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
    const { data: classrooms } = useData("/classrooms/");
    const { presenceData, classroomId, selectClassroom } = usePresenceContext();
    const crId = classroomId || classrooms?.[0]?.id;

    return (
        <>
            <div className="page-header"><h1 className="page-title">Live Stream</h1><p className="page-subtitle">Real-time video feed and presence tracking</p></div>
            <div style={{ marginBottom: 16 }}>
                <select className="select" style={{ maxWidth: 260 }}
                    value={crId || ""}
                    onChange={e => selectClassroom(parseInt(e.target.value))}>
                    {classrooms?.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <VideoStream classroomId={crId} />
                <PresenceTable data={presenceData} />
            </div>
        </>
    );
}

// ── Engine View ───────────────────────────────────────────────────────────────
function EngineView() {
    const { data: classrooms } = useData("/classrooms/");
    const { data: engineStatus, reload: reloadEngine } = useData("/engine/status", { refreshInterval: 3000 });
    const { data: metrics } = useData("/engine/metrics", { refreshInterval: 3000 });
    const { classroomId, selectClassroom } = usePresenceContext();
    const [loading, setLoading] = useState(false);
    const crId = classroomId || classrooms?.[0]?.id;
    const isRunning = engineStatus?.running ?? false;

    const start = async () => {
        if (!crId) return;
        setLoading(true);
        try { await api.post("/engine/start", { classroom_id: crId }); toast.success("Engine started"); reloadEngine(); }
        catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
        finally { setLoading(false); }
    };

    const stop = async () => {
        setLoading(true);
        try { await api.post("/engine/stop"); toast.success("Engine stopped"); reloadEngine(); }
        catch { toast.error("Failed"); }
        finally { setLoading(false); }
    };

    return (
        <>
            <div className="page-header"><h1 className="page-title">Engine Control</h1><p className="page-subtitle">Attendance engine management and metrics</p></div>
            <div className="card" style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 16 }}>Controls</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <select className="select" style={{ maxWidth: 240 }}
                        value={crId || ""}
                        onChange={e => selectClassroom(parseInt(e.target.value))}>
                        {classrooms?.map(c => <option key={c.id} value={c.id}>{c.classroom_name}</option>)}
                    </select>
                    <button className="btn btn-success" onClick={start} disabled={loading || isRunning}><Play size={14} /> Start</button>
                    <button className="btn btn-danger" onClick={stop} disabled={loading || !isRunning}><StopCircle size={14} /> Stop</button>
                    <span className={`badge ${isRunning ? "badge-success" : "badge-neutral"}`} style={{ fontSize: 13, padding: "6px 14px" }}>
                        {isRunning ? "● RUNNING" : "○ STOPPED"}
                    </span>
                </div>
            </div>
            {metrics && (
                <div className="card">
                    <div style={{ fontWeight: 600, marginBottom: 16 }}>Live Metrics</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                        {[
                            { label: "FPS", value: metrics.fps?.toFixed(1) },
                            { label: "Active Tracks", value: metrics.active_tracks },
                            { label: "Frames", value: metrics.frames_processed?.toLocaleString() },
                            { label: "Recog Latency", value: `${metrics.recognition_latency_ms?.toFixed(0)} ms` },
                            { label: "Video WS Clients", value: metrics.ws_video_clients },
                            { label: "Presence WS Clients", value: metrics.ws_presence_clients },
                        ].map(({ label, value }) => (
                            <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{label}</div>
                                <div style={{ fontSize: 24, fontWeight: 700 }}>{value ?? "—"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
    return (
        <div className="layout">
            <Sidebar />
            <main className="main-content">
                <Routes>
                    <Route index element={<DashboardHome />} />
                    <Route path="stream" element={<StreamView />} />
                    <Route path="fields" element={<FieldsView />} />
                    <Route path="classrooms" element={<ClassroomsView />} />
                    <Route path="users" element={<UsersView />} />
                    <Route path="students" element={<StudentsView />} />
                    <Route path="sheets" element={<SheetsView />} />
                    <Route path="engine" element={<EngineView />} />
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
            </main>
        </div>
    );
}
