/**
 * hooks/useWebSocket.js
 *
 * useVideoStream  – Per-component hook (needs canvas ref). Uses
 *                   createImageBitmap() for off-main-thread frame decode.
 * usePresenceStream – Reads from WebSocketContext (single persistent WS).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { getAccessToken } from "../api/client";
import { usePresenceContext } from "../context/WebSocketContext";

// ── Video Stream ──────────────────────────────────────────────────────────────
export const useVideoStream = (classroomId) => {
    const canvasRef = useRef(null);
    const wsRef = useRef(null);
    const retryDelay = useRef(1000);
    const retryTimer = useRef(null);
    // Track intentional closes so we don't schedule a reconnect on unmount/cleanup
    const intentionalClose = useRef(false);
    const [status, setStatus] = useState("disconnected");

    const connect = useCallback(() => {
        if (!classroomId) return;
        const token = getAccessToken();
        if (!token) return;

        // Mark NOT intentional before opening new WS
        intentionalClose.current = false;

        const proto = location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${location.host}/ws/video?token=${token}&classroom_id=${classroomId}`;
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
            retryDelay.current = 1000; // reset backoff on successful connect
            setStatus("connected");
        };

        ws.onclose = () => {
            setStatus("disconnected");
            // Only reconnect if this was NOT an intentional close (cleanup/unmount)
            if (!intentionalClose.current) {
                retryTimer.current = setTimeout(() => {
                    retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
                    connect();
                }, retryDelay.current);
            }
        };

        ws.onerror = () => setStatus("error");

        ws.onmessage = async (event) => {
            if (typeof event.data === "string") {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === "engine_stopped") setStatus("engine_stopped");
                } catch { }
                return;
            }

            // ── createImageBitmap path ────────────────────────────────────────
            // Decodes JPEG off the main thread — no layout thrashing
            const blob = new Blob([event.data], { type: "image/jpeg" });
            try {
                const bitmap = await createImageBitmap(blob);
                const canvas = canvasRef.current;
                if (!canvas) { bitmap.close(); return; }
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                canvas.getContext("2d").drawImage(bitmap, 0, 0);
                bitmap.close(); // free GPU memory immediately
                setStatus("connected");
            } catch {
                // Fallback for browsers without createImageBitmap
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const canvas = canvasRef.current;
                    if (!canvas) { URL.revokeObjectURL(url); return; }
                    canvas.width = img.width;
                    canvas.height = img.height;
                    canvas.getContext("2d").drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                    setStatus("connected");
                };
                img.src = url;
            }
        };
    }, [classroomId]);

    useEffect(() => {
        if (!classroomId) return;
        connect();
        return () => {
            // Mark intentional so onclose does NOT schedule a retry
            intentionalClose.current = true;
            clearTimeout(retryTimer.current);
            wsRef.current?.close();
        };
    }, [connect, classroomId]);

    return { canvasRef, status };
};

// ── Presence Stream ───────────────────────────────────────────────────────────
// Reads from the single persistent WebSocketContext — zero cost, no new WS.
export const usePresenceStream = (_classroomId) => {
    const { presenceData, presenceStatus } = usePresenceContext();
    return { data: presenceData, status: presenceStatus };
};
