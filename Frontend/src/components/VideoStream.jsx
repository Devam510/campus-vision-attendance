import { memo } from "react";
import { useVideoStream } from "../hooks/useWebSocket";
import { Wifi, WifiOff, AlertCircle } from "lucide-react";

const STATUS_CONFIG = {
    connected: { icon: Wifi, label: "Live", cls: "badge-success" },
    disconnected: { icon: WifiOff, label: "Reconnecting...", cls: "badge-warning" },
    error: { icon: AlertCircle, label: "Error", cls: "badge-danger" },
    engine_stopped: { icon: AlertCircle, label: "Engine Stopped", cls: "badge-danger" },
};

const VideoStream = memo(function VideoStream({ classroomId }) {
    const { canvasRef, status } = useVideoStream(classroomId);
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;
    const StatusIcon = cfg.icon;

    return (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header */}
            <div style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Live Feed</span>
                <span className={`badge ${cfg.cls}`}>
                    <StatusIcon size={11} />
                    {cfg.label}
                </span>
            </div>

            {/* Video canvas */}
            <div className="video-container" style={{ borderRadius: 0, border: "none" }}>
                <canvas
                    ref={canvasRef}
                    style={{ display: status === "connected" ? "block" : "none" }}
                />
                {status !== "connected" && (
                    <div className="video-overlay">
                        {status === "disconnected" ? (
                            <><span className="spinner" /><span>Connecting to camera...</span></>
                        ) : status === "engine_stopped" ? (
                            <><AlertCircle size={32} color="var(--danger)" /><span>Engine is not running</span></>
                        ) : (
                            <><WifiOff size={32} color="var(--danger)" /><span>Connection error</span></>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}, (prev, next) => prev.classroomId === next.classroomId);
// Only re-render if the classroom actually changes

export default VideoStream;
