/**
 * FaceScanModal.jsx
 *
 * Phone-style live face registration modal.
 * - Opens webcam stream
 * - Animated SVG progress ring around the face preview
 * - Auto-captures 5 frames at user-guided angles
 * - Batches all frames to:  POST /api/students/:id/register-face  (multipart)
 * - Handles liveness/quality errors with clear messages
 */

import { useEffect, useRef, useState, useCallback } from "react";
import api from "../api/client";
import { invalidate } from "../hooks/useData";

/* ── Scan steps ─────────────────────────────────────────────────────────────── */
const STEPS = [
    { pct: 0, text: "Position your face in the circle" },
    { pct: 20, text: "Hold still…" },
    { pct: 40, text: "Tilt slightly left" },
    { pct: 60, text: "Tilt slightly right" },
    { pct: 80, text: "Look up slightly" },
    { pct: 95, text: "Verifying…" },  // stays at 95% until server confirms
];

const TOTAL_FRAMES = 5;     // frames to collect
const CAPTURE_MS = 900;   // ms between auto-captures
const CIRCLE_RADIUS = 140;   // SVG ring radius (px)
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

/* ── Error message map ──────────────────────────────────────────────────────── */
function getFriendlyError(detail = "") {
    if (detail.includes("spoof") || detail.includes("Live face"))
        return { icon: "🚫", title: "Live Face Required", body: "A printed photo or screen was detected. Please use a real face in good lighting." };
    if (detail.includes("centered") || detail.includes("align your face"))
        return { icon: "🎯", title: "Face Not Centered", body: "Please keep your face fully inside the center circle." };
    if (detail.includes("blur") || detail.includes("valid face"))
        return { icon: "💡", title: "Improve Lighting", body: "No sharp face found. Move to better light and keep your face centred." };
    if (detail.includes("diversity") || detail.includes("pose"))
        return { icon: "↔️", title: "More Movement Needed", body: "Please move your head slightly between each capture step." };
    if (detail.includes("InsightFace") || detail.includes("not installed"))
        return { icon: "⚙️", title: "Server Error", body: "Face recognition module unavailable on the server." };
    return { icon: "⚠️", title: "Registration Failed", body: detail || "Unknown error. Please try again." };
}

/* ── SVG Progress Ring ──────────────────────────────────────────────────────── */
function ProgressRing({ pct, scanning }) {
    const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
    const color = pct === 100 ? "#22c55e" : pct > 50 ? "#3b82f6" : "#6366f1";

    return (
        <svg
            width={CIRCLE_RADIUS * 2 + 24}
            height={CIRCLE_RADIUS * 2 + 24}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        >
            {/* Track */}
            <circle
                cx={CIRCLE_RADIUS + 12} cy={CIRCLE_RADIUS + 12}
                r={CIRCLE_RADIUS}
                fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={6}
            />
            {/* Progress arc */}
            <circle
                cx={CIRCLE_RADIUS + 12} cy={CIRCLE_RADIUS + 12}
                r={CIRCLE_RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${CIRCLE_RADIUS + 12} ${CIRCLE_RADIUS + 12})`}
                style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.4s" }}
            />
            {/* Scan-line flash dots */}
            {scanning && [0.25, 0.5, 0.75].map((f) => (
                <circle
                    key={f}
                    cx={CIRCLE_RADIUS + 12 + CIRCLE_RADIUS * Math.cos(2 * Math.PI * f - Math.PI / 2)}
                    cy={CIRCLE_RADIUS + 12 + CIRCLE_RADIUS * Math.sin(2 * Math.PI * f - Math.PI / 2)}
                    r={3}
                    fill={color}
                    style={{ opacity: 0.7 }}
                />
            ))}
        </svg>
    );
}

/* ── Main Component ─────────────────────────────────────────────────────────── */
export default function FaceScanModal({ student, classroomKey, onClose, onSuccess }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const intervalRef = useRef(null);
    const framesRef = useRef([]);   // accumulated Blob frames

    const [step, setStep] = useState(0);    // 0-5
    const [pct, setPct] = useState(0);
    const [cameraReady, setCameraReady] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);  // { icon, title, body }
    const [done, setDone] = useState(false);

    /* Start webcam */
    useEffect(() => {
        let active = true;
        navigator.mediaDevices
            .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })
            .then((stream) => {
                if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                }
                setCameraReady(true);
            })
            .catch(() => {
                if (active)
                    setError({ icon: "📷", title: "Camera Blocked", body: "Allow camera access in your browser to register a face." });
            });
        return () => {
            active = false;
            stopCamera();
        };
    }, []);

    /* Start auto-capture when camera is ready */
    useEffect(() => {
        if (!cameraReady || done || error) return;
        startCapturing();
        return () => clearInterval(intervalRef.current);
    }, [cameraReady, done, error]);

    const stopCamera = useCallback(() => {
        clearInterval(intervalRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
    }, []);

    const captureFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return null;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext("2d").drawImage(video, 0, 0);
        return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    }, []);

    const startCapturing = useCallback(() => {
        intervalRef.current = setInterval(async () => {
            if (framesRef.current.length >= TOTAL_FRAMES) {
                clearInterval(intervalRef.current);
                return;
            }
            const blob = await captureFrame();
            if (!blob) return;

            framesRef.current = [...framesRef.current, blob];
            const newStep = framesRef.current.length;   // 1-5
            setStep(newStep);
            // Cap at index 4 (95%) — 100% only set after server confirms
            setPct(STEPS[Math.min(newStep, STEPS.length - 1)].pct);

            if (framesRef.current.length === TOTAL_FRAMES) {
                clearInterval(intervalRef.current);
                await submitFrames(framesRef.current);
            }
        }, CAPTURE_MS);
    }, [captureFrame]);

    const submitFrames = async (blobs) => {
        setSubmitting(true);
        try {
            const fd = new FormData();
            blobs.forEach((b, i) => fd.append("images", b, `frame_${i}.jpg`));
            await api.post(`/students/${student.id}/register-face`, fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            // Only reach 100% after server confirms success
            setPct(100);
            setDone(true);
            stopCamera();
            invalidate(classroomKey);
            setTimeout(() => { onSuccess?.(); onClose(); }, 1800);
        } catch (e) {
            const detail = e.response?.data?.detail || "";
            setError(getFriendlyError(detail));
            stopCamera();
        } finally {
            setSubmitting(false);
        }
    };

    const handleRetry = () => {
        framesRef.current = [];
        setStep(0);
        setPct(0);
        setError(null);
        setDone(false);
        setSubmitting(false);

        navigator.mediaDevices
            .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })
            .then((stream) => {
                streamRef.current = stream;
                if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
                setCameraReady(true);
                startCapturing();
            })
            .catch(() =>
                setError({ icon: "📷", title: "Camera Blocked", body: "Please allow camera access and try again." })
            );
    };

    /* ── Render ── */
    const currentStep = STEPS[Math.min(step, STEPS.length - 1)];
    const ringSize = CIRCLE_RADIUS * 2 + 24;

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(0,0,0,0.85)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(6px)",
        }}>
            {/* Header */}
            <div style={{ color: "#fff", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                Face Scan — {student.name}
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 28 }}>
                Keep your face in the circle and follow the instructions
            </div>

            {/* Progress ring + video */}
            <div style={{ position: "relative", width: ringSize, height: ringSize, marginBottom: 28 }}>
                {/* Circular video mask */}
                <div style={{
                    position: "absolute", top: 12, left: 12,
                    width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2,
                    borderRadius: "50%", overflow: "hidden",
                    border: "2px solid rgba(255,255,255,0.15)",
                    background: "#111",
                }}>
                    <video
                        ref={videoRef}
                        autoPlay playsInline muted
                        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                    />
                    {/* Done overlay */}
                    {done && (
                        <div style={{
                            position: "absolute", inset: 0,
                            background: "rgba(34,197,94,0.25)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 52,
                        }}>✅</div>
                    )}
                </div>

                {/* SVG ring */}
                <ProgressRing pct={pct} scanning={cameraReady && !done && !error} />

                {/* Scan line animation */}
                {cameraReady && !done && !error && (
                    <div style={{
                        position: "absolute", top: "50%", left: 12,
                        width: CIRCLE_RADIUS * 2, height: 2,
                        background: "linear-gradient(90deg, transparent 0%, #3b82f6 50%, transparent 100%)",
                        opacity: 0.6,
                        animation: "scanLine 1.8s ease-in-out infinite",
                        transform: "translateY(-50%)",
                        borderRadius: 1,
                    }} />
                )}
            </div>

            {/* Percentage */}
            <div style={{
                fontSize: 42, fontWeight: 800, color: "#fff",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-1px", marginBottom: 10,
                transition: "color 0.3s",
                ...(done ? { color: "#22c55e" } : {}),
            }}>
                {pct}%
            </div>

            {/* Step guidance */}
            {!error && (
                <div style={{
                    fontSize: 15, color: "rgba(255,255,255,0.85)",
                    textAlign: "center", marginBottom: 24,
                    minHeight: 24,
                    transition: "opacity 0.3s",
                }}>
                    {submitting ? "Uploading and verifying…" : currentStep.text}
                </div>
            )}

            {/* Frame counter dots */}
            {!error && !done && (
                <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
                    {Array.from({ length: TOTAL_FRAMES }, (_, i) => (
                        <div key={i} style={{
                            width: 10, height: 10, borderRadius: "50%",
                            background: i < step ? "#3b82f6" : "rgba(255,255,255,0.2)",
                            transition: "background 0.3s",
                        }} />
                    ))}
                </div>
            )}

            {/* Error state */}
            {error && (
                <div style={{
                    background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
                    borderRadius: 12, padding: "16px 24px", maxWidth: 380, textAlign: "center",
                    marginBottom: 24,
                }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>{error.icon}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>
                        {error.title}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
                        {error.body}
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 12 }}>
                {error && (
                    <button
                        onClick={handleRetry}
                        style={{
                            padding: "10px 24px", borderRadius: 8, border: "none",
                            background: "#3b82f6", color: "#fff", fontWeight: 600,
                            cursor: "pointer", fontSize: 14,
                        }}
                    >
                        🔄 Try Again
                    </button>
                )}
                <button
                    onClick={() => { stopCamera(); onClose(); }}
                    style={{
                        padding: "10px 24px", borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.2)",
                        background: "transparent", color: "rgba(255,255,255,0.7)",
                        cursor: "pointer", fontSize: 14,
                    }}
                >
                    Cancel
                </button>
            </div>

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} style={{ display: "none" }} />

            {/* Scan-line keyframes */}
            <style>{`
        @keyframes scanLine {
          0%   { top: 30%;  opacity: 0; }
          10%  { opacity: 0.6; }
          50%  { top: 70%;  opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { top: 30%;  opacity: 0; }
        }
      `}</style>
        </div>
    );
}
