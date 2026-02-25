import { memo, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Users, Camera } from "lucide-react";

function SecondsToMin({ seconds }) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return <>{m}m {s}s</>;
}

const PresenceTable = memo(function PresenceTable({ data }) {
    if (!data) {
        return (
            <div className="card" style={{ textAlign: "center", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: "rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    <Camera size={22} color="var(--text-muted)" />
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 600, margin: 0 }}>Live Attendance</p>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>
                    Start the engine to begin detecting<br />student attendance in real time.
                </p>
            </div>
        );
    }

    const { lecture_name, start_time, end_time, students } = data;

    // Memoised derived stats to avoid recalc on every render
    const present = useMemo(
        () => students.filter(s => s.status === "IN_PROGRESS" || s.total_seconds > 0),
        [students]
    );

    return (
        <div className="card" style={{ padding: 0 }}>
            {/* Header */}
            <div style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
                <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{lecture_name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        {new Date(start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {new Date(end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                </div>
                <span className="badge badge-primary">
                    <Users size={11} />
                    {present.length}/{students.length} present
                </span>
            </div>

            {/* Table */}
            <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                {students.length === 0 ? (
                    <div style={{ padding: "32px", textAlign: "center", color: "var(--text-secondary)", fontSize: 14 }}>
                        No students detected yet
                    </div>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Student</th>
                                <th>Enrollment</th>
                                <th>Present Duration</th>
                                <th>Last Seen</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map(s => (
                                <tr key={s.student_id}>
                                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                                    <td style={{ color: "var(--text-secondary)" }}>{s.enrollment_no || "—"}</td>
                                    <td><SecondsToMin seconds={s.total_seconds} /></td>
                                    <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                                        {s.last_seen
                                            ? formatDistanceToNow(new Date(s.last_seen), { addSuffix: true })
                                            : "—"}
                                    </td>
                                    <td>
                                        <span className={s.total_seconds > 0 ? "badge badge-success" : "badge badge-neutral"}>
                                            <span className={`dot ${s.total_seconds > 0 ? "dot-green dot-pulse" : "dot-red"}`} />
                                            {s.total_seconds > 0 ? "Present" : "Not seen"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // Only re-render if student data actually changed
    if (!prev.data && !next.data) return true;
    if (!prev.data || !next.data) return false;
    return JSON.stringify(prev.data.students) === JSON.stringify(next.data.students)
        && prev.data.lecture_id === next.data.lecture_id;
});

export default PresenceTable;
