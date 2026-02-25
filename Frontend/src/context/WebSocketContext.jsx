/**
 * context/WebSocketContext.jsx – Single persistent WebSocket for presence data.
 *
 * Mounts once at the top of the app. Survives route changes.
 * Exposes presenceData and presenceStatus via context.
 * Components just call usePresenceContext() — no new WS per mount.
 */
import {
    createContext, useContext, useEffect, useRef,
    useState, useCallback, useMemo,
} from "react";
import { getAccessToken } from "../api/client";

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
    const wsRef = useRef(null);
    const [presenceData, setPresenceData] = useState(null);
    const [presenceStatus, setPresenceStatus] = useState("disconnected");
    const [classroomId, setClassroomId] = useState(() => {
        const saved = localStorage.getItem("selectedClassroomId");
        return saved ? parseInt(saved) : null;
    });
    const retryDelay = useRef(1000);
    const retryTimer = useRef(null);
    const lastDataRef = useRef(null); // debounce guard
    // ↓ Generation counter: each new connect() call gets a fresh generation.
    //   The onclose closure captures its own generation; if it doesn't match
    //   the current one, the connection was superseded and must NOT retry.
    const generation = useRef(0);

    const connect = useCallback(() => {
        if (!classroomId) return;
        const token = getAccessToken();
        if (!token) return;

        // Cancel any pending retry from a previous generation
        clearTimeout(retryTimer.current);

        // Close old WS without triggering a retry (onclose checks generation)
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        // Bump generation so stale onclose handlers know they're superseded
        const myGeneration = ++generation.current;

        const proto = location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${location.host}/ws/presence?token=${token}&classroom_id=${classroomId}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            if (generation.current !== myGeneration) { ws.close(); return; }
            setPresenceStatus("connected");
            retryDelay.current = 1000; // reset backoff on successful connect
        };

        ws.onclose = () => {
            // Only retry if this WS is still the current generation
            if (generation.current !== myGeneration) return;
            setPresenceStatus("disconnected");
            retryTimer.current = setTimeout(() => {
                if (generation.current !== myGeneration) return;
                retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
                connect();
            }, retryDelay.current);
        };

        ws.onerror = () => {
            if (generation.current !== myGeneration) return;
            setPresenceStatus("error");
        };

        ws.onmessage = (event) => {
            if (generation.current !== myGeneration) return;
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === "presence_update") {
                    // Client-side 100ms debounce as secondary guard
                    const now = Date.now();
                    if (lastDataRef.current && now - lastDataRef.current < 100) return;
                    lastDataRef.current = now;
                    setPresenceData(msg);
                } else if (msg.type === "no_active_lecture") {
                    setPresenceData(null);
                } else if (msg.type === "auth_expired") {
                    generation.current++; // invalidate this generation
                    ws.close();
                    window.location.href = "/login";
                }
            } catch { }
        };
    }, [classroomId]);

    // Update classroom and persist
    const selectClassroom = useCallback((id) => {
        if (id) localStorage.setItem("selectedClassroomId", String(id));
        setClassroomId(id);
        setPresenceData(null); // clear stale data immediately
    }, []);

    useEffect(() => {
        connect();
        return () => {
            // Invalidate current generation — stale onclose handlers won't retry
            generation.current++;
            clearTimeout(retryTimer.current);
            wsRef.current?.close();
            wsRef.current = null;
        };
    }, [connect]);

    const value = useMemo(() => ({
        presenceData,
        presenceStatus,
        classroomId,
        selectClassroom,
    }), [presenceData, presenceStatus, classroomId, selectClassroom]);

    return (
        <WebSocketContext.Provider value={value}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function usePresenceContext() {
    const ctx = useContext(WebSocketContext);
    if (!ctx) throw new Error("usePresenceContext must be used within WebSocketProvider");
    return ctx;
}
