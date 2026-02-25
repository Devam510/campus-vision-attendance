/* ═══════════════════════════════════════════════════════════════════════════
   app.js - Dashboard logic: polling, lecture CRUD, live timers, export
   ═══════════════════════════════════════════════════════════════════════════ */

const POLL_MS = 3000;
let activeLectureId = null;
let pollTimer = null;
let feedActive = false;

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH HELPER
// ══════════════════════════════════════════════════════════════════════════════

function authHeaders() {
    // Credentials are handled by the browser's Basic Auth prompt
    return { "Content-Type": "application/json" };
}

async function apiFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...opts.headers } });
    if (res.status === 401) {
        toast("Authentication required", "error");
        return null;
    }
    return res;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ENGINE CONTROLS
// ══════════════════════════════════════════════════════════════════════════════

async function startEngine() {
    const res = await apiFetch("/api/engine/start", { method: "POST" });
    if (!res) return;
    const data = await res.json();
    if (data.status === "started") {
        toast("Engine started", "success");
        updateEngineUI(true);
        // Refresh the video feed
        document.getElementById("video-feed").src = "/video_feed?" + Date.now();
    } else {
        toast("Engine already running", "info");
    }
}

async function stopEngine() {
    const res = await apiFetch("/api/engine/stop", { method: "POST" });
    if (!res) return;
    toast("Engine stopping...", "info");
    updateEngineUI(false);
}

function updateEngineUI(running) {
    const status = document.getElementById("engine-status");
    const btnStart = document.getElementById("btn-start");
    const btnStop = document.getElementById("btn-stop");
    const overlay = document.getElementById("feed-overlay");
    const feed = document.getElementById("video-feed");

    if (running) {
        status.textContent = "🟢 Running";
        status.classList.add("running");
        btnStart.disabled = true;
        btnStop.disabled = false;
        overlay.classList.add("hidden");
        if (!feedActive) {
            feed.src = "/video_feed?" + Date.now();
            feedActive = true;
        }
    } else {
        status.textContent = "⏹ Stopped";
        status.classList.remove("running");
        btnStart.disabled = false;
        btnStop.disabled = true;
        overlay.classList.remove("hidden");
        feed.src = "";
        feedActive = false;
    }
}

async function checkEngineStatus() {
    try {
        const res = await apiFetch("/api/engine/status");
        if (!res) return;
        const data = await res.json();
        updateEngineUI(data.running);
    } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  LECTURES
// ══════════════════════════════════════════════════════════════════════════════

async function createLecture(event) {
    event.preventDefault();
    const dateStr = document.getElementById("lec-date").value;
    const startTime = document.getElementById("lec-start").value;
    const endTime = document.getElementById("lec-end").value;

    const body = {
        lecture_name: document.getElementById("lec-name").value,
        lecture_date: dateStr,
        start_time: `${dateStr} ${startTime}:00`,
        end_time: `${dateStr} ${endTime}:00`,
        minimum_required_minutes: parseInt(document.getElementById("lec-min").value),
    };

    const res = await apiFetch("/api/lectures", {
        method: "POST",
        body: JSON.stringify(body),
    });
    if (!res) return;

    if (res.status === 201) {
        toast("Lecture created!", "success");
        document.getElementById("lecture-form").reset();
        // Set date to today by default
        document.getElementById("lec-date").value = new Date().toISOString().split("T")[0];
        fetchLectures();
    } else {
        const err = await res.json();
        toast(err.error || "Failed to create lecture", "error");
    }
}

async function fetchLectures() {
    try {
        const today = new Date().toISOString().split("T")[0];
        const res = await apiFetch(`/api/lectures?date=${today}`);
        if (!res) return;
        const lectures = await res.json();
        renderLectureList(lectures);
    } catch (e) { /* ignore */ }
}

function renderLectureList(lectures) {
    const container = document.getElementById("lecture-list");
    if (lectures.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">No lectures today</div>';
        return;
    }

    container.innerHTML = lectures.map(lec => {
        const badge = lec.finalized
            ? '<span class="badge badge-done">Done</span>'
            : isActive(lec)
                ? '<span class="badge badge-active">Active</span>'
                : '<span class="badge badge-pending">Pending</span>';

        const startShort = lec.start_time.split(" ")[1]?.substring(0, 5) || "";
        const endShort = lec.end_time.split(" ")[1]?.substring(0, 5) || "";

        return `
            <div class="lecture-item" onclick="viewLecture(${lec.id}, ${lec.finalized})">
                <span class="name">${escapeHtml(lec.lecture_name)}</span>
                <span class="time">${startShort} - ${endShort}</span>
                ${badge}
            </div>`;
    }).join("");
}

function isActive(lec) {
    const now = new Date();
    const start = new Date(lec.start_time.replace(" ", "T"));
    const end = new Date(lec.end_time.replace(" ", "T"));
    return now >= start && now <= end && !lec.finalized;
}

async function viewLecture(lectureId, finalized) {
    if (finalized) {
        // Show final attendance
        const res = await apiFetch(`/api/attendance/${lectureId}`);
        if (!res) return;
        const rows = await res.json();
        renderFinalAttendance(rows);
        document.getElementById("btn-export").disabled = false;
        document.getElementById("btn-export").onclick = () => exportCSV(lectureId);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACTIVE LECTURE
// ══════════════════════════════════════════════════════════════════════════════

async function fetchActiveLecture() {
    try {
        const res = await apiFetch("/api/lectures/active");
        if (!res) return;
        const lec = await res.json();

        const panel = document.getElementById("active-lecture-panel");
        if (lec && lec.id) {
            activeLectureId = lec.id;
            panel.style.display = "block";
            document.getElementById("active-name").textContent = lec.lecture_name;
            document.getElementById("progress-bar").style.width = `${lec.progress_pct}%`;

            const mins = Math.floor(lec.remaining_seconds / 60);
            const secs = Math.floor(lec.remaining_seconds % 60);
            document.getElementById("time-remaining").textContent =
                `${mins}m ${secs}s remaining`;

            document.getElementById("btn-export").disabled = false;
            document.getElementById("btn-export").onclick = () => exportCSV(lec.id);

            fetchPresence(lec.id);
        } else {
            activeLectureId = null;
            panel.style.display = "none";
        }
    } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRESENCE
// ══════════════════════════════════════════════════════════════════════════════

async function fetchPresence(lectureId) {
    try {
        const res = await apiFetch(`/api/presence/${lectureId}`);
        if (!res) return;
        const rows = await res.json();
        renderPresence(rows);
        updateStats(rows);
    } catch (e) { /* ignore */ }
}

function renderPresence(rows) {
    const body = document.getElementById("presence-body");
    if (rows.length === 0) {
        body.innerHTML = '<tr class="empty-row"><td colspan="4">No students detected yet</td></tr>';
        return;
    }

    body.innerHTML = rows.map(r => {
        const totalSec = Math.round(r.total_present_seconds);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

        const statusClass = r.status === "COMPLETED" ? "status-present" : "status-tracking";
        const statusText = r.status === "COMPLETED" ? "Done" : "Tracking";

        return `<tr>
            <td><strong>${escapeHtml(r.student_name)}</strong></td>
            <td>${r.first_seen?.split(" ")[1] || "-"}</td>
            <td class="timer">${timeStr}</td>
            <td class="${statusClass}">${statusText}</td>
        </tr>`;
    }).join("");
}

function renderFinalAttendance(rows) {
    const panel = document.getElementById("final-panel");
    const body = document.getElementById("final-body");
    panel.style.display = "block";

    if (rows.length === 0) {
        body.innerHTML = '<tr class="empty-row"><td colspan="3">No records</td></tr>';
        return;
    }

    body.innerHTML = rows.map(r => {
        const totalSec = Math.round(r.total_present_seconds);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        const cls = r.status === "PRESENT" ? "status-present" : "status-absent";

        return `<tr>
            <td><strong>${escapeHtml(r.student_name)}</strong></td>
            <td class="timer">${timeStr}</td>
            <td class="${cls}">${r.status}</td>
        </tr>`;
    }).join("");
}

// ══════════════════════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════════════════════

async function fetchStudents() {
    try {
        const res = await apiFetch("/api/students");
        if (!res) return;
        const students = await res.json();
        document.getElementById("stat-registered").textContent = students.length;
    } catch (e) { /* ignore */ }
}

function updateStats(presenceRows) {
    document.getElementById("stat-detected").textContent = presenceRows.length;
    // Present / absent are only available after finalization; during tracking show 0
    // We'll update these when final data is available
}

async function fetchFinalStats(lectureId) {
    try {
        const res = await apiFetch(`/api/attendance/${lectureId}`);
        if (!res) return;
        const rows = await res.json();
        const present = rows.filter(r => r.status === "PRESENT").length;
        const absent = rows.filter(r => r.status === "ABSENT").length;
        document.getElementById("stat-present").textContent = present;
        document.getElementById("stat-absent").textContent = absent;
    } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════════════════════

function exportCSV(lectureId) {
    if (!lectureId && activeLectureId) lectureId = activeLectureId;
    if (!lectureId) {
        toast("No lecture selected", "error");
        return;
    }
    window.open(`/api/export/${lectureId}`, "_blank");
}

// ══════════════════════════════════════════════════════════════════════════════
//  POLLING
// ══════════════════════════════════════════════════════════════════════════════

function startPolling() {
    pollTimer = setInterval(() => {
        checkEngineStatus();
        fetchActiveLecture();
        fetchLectures();
        fetchStudents();

        // If there's a finalized lecture selected, refresh final stats
        if (activeLectureId) {
            fetchFinalStats(activeLectureId);
        }
    }, POLL_MS);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════════════════════

function toast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════════════════════

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
    // Set date input to today
    const dateInput = document.getElementById("lec-date");
    if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

    checkEngineStatus();
    fetchStudents();
    fetchLectures();
    fetchActiveLecture();
    startPolling();
});
