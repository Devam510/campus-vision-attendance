# AI Attendance System v4 — Time-Based Lecture Attendance

Fully offline, production-grade classroom attendance system using **YOLOv8 face detection**, **InsightFace ArcFace recognition**, **ByteTrack tracking**, and a **Flask dashboard** with time-based lecture management.

---

## Features

- **Time-based attendance** — presence accumulated per student per lecture; `PRESENT` only if minimum required time is met
- **Multi-lecture support** — 4–5 lectures/day, automatic per-lecture isolation
- **YOLO face detection** — YOLOv8n-face for real-time bounding boxes
- **ArcFace recognition** — InsightFace ONNX, no TensorFlow required
- **ByteTrack tracking** — stable multi-face tracking with state machine (ACTIVE → LOST → ENDED)
- **Face quality gate** — rejects small (<80px) and blurry faces
- **Liveness detection** — passive texture-based anti-spoofing
- **Multi-frame vote** — 5 consistent recognition hits before acceptance
- **Confidence-weighted presence** — time weighted by recognition confidence
- **60s absence gap** — accumulation pauses if student not seen for >60 seconds
- **Crash recovery** — engine heartbeat every 15s; resumes on restart
- **Camera reconnect** — exponential backoff (2s → 32s, 5 retries)
- **Per-track cooldown** — prevents duplicate recognition attempts
- **In-memory embedding cache** — no per-frame DB reads
- **Analytics logging** — detection rate, recognition rate, success rate per minute
- **Basic auth** — password-protected dashboard
- **CSV export** — per-lecture downloadable reports
- **Dark glassmorphism UI** — premium responsive dashboard with live timers

---

## Quick Start

### 1. Install Dependencies

```powershell
cd "d:\Devam\Microsoft VS Code\Codes\AI Attendence"
pip install -r requirements.txt
```

### 2. Verify Installation

```powershell
python -c "import cv2, ultralytics, insightface, flask, numpy, scipy; print('ALL OK')"
```

### 3. Register Students

Create folders in `dataset/` with student names and add 3–5 face photos per student:

```
dataset/
  John_Doe/
    photo1.jpg
    photo2.jpg
  Jane_Smith/
    photo1.jpg
    photo2.png
```

Then run:

```powershell
python register_faces.py
```

### 4. Start the System

```powershell
python app.py
```

Open **http://127.0.0.1:5000** in your browser.
- Login: `admin` / `admin123`

### 5. Usage Flow

1. **Create a lecture** — fill in name, date, start/end time, minimum minutes
2. **Start engine** — click ▶ Start; live camera feed appears
3. **Monitor** — watch per-student presence timers accumulate in real-time
4. **Lecture ends** — system automatically finalizes: `PRESENT` or `ABSENT`
5. **Export** — click 📥 CSV to download the report

---

## File Structure

```
AI Attendence/
├── config.py                 # All tuneable constants
├── logger_setup.py           # Rotating file + console logging
├── database.py               # SQLite: 5 tables, WAL mode, indexes
├── embedding_cache.py        # In-memory embedding singleton
├── face_quality.py           # Size + sharpness quality gate
├── liveness.py               # Texture-based anti-spoofing
├── tracker.py                # ByteTrack + state machine
├── analytics.py              # Detection/recognition rate collector
├── attendance_engine.py      # Core pipeline thread
├── register_faces.py         # CLI student registration
├── app.py                    # Flask server + REST APIs
├── templates/index.html      # Dashboard UI
├── static/css/style.css      # Dark glassmorphism theme
├── static/js/app.js          # Frontend logic
├── dataset/                  # Student face images
├── models/                   # Auto-downloaded ONNX models
├── logs/                     # Rotating log files
├── requirements.txt
├── .gitignore
└── README.md
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `students` | Name + ArcFace embedding |
| `lectures` | Scheduled time windows with minimum minutes |
| `presence_tracking` | Real-time accumulated seconds per student per lecture |
| `final_attendance` | `PRESENT` / `ABSENT` after lecture ends |
| `analytics_log` | Detection and recognition rates |

Run `python database.py` for a self-test.

---

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Dashboard |
| GET | `/video_feed` | MJPEG live stream |
| POST | `/api/lectures` | Create lecture |
| GET | `/api/lectures?date=` | Lectures by date |
| GET | `/api/lectures/active` | Active lecture |
| GET | `/api/students` | Registered students |
| GET | `/api/presence/<id>` | Live presence data |
| GET | `/api/attendance/<id>` | Final attendance |
| GET | `/api/export/<id>` | CSV download |
| GET | `/api/analytics/<id>` | Analytics data |
| POST | `/api/engine/start` | Start engine |
| POST | `/api/engine/stop` | Stop engine |
| GET | `/api/engine/status` | Engine status |

---

## Configuration

Edit `config.py` to customise:

| Setting | Default | Description |
|---------|---------|-------------|
| `CAMERA_SOURCE` | `0` | Webcam index or RTSP URL |
| `PROCESS_WIDTH` | `640` | Resize width for inference |
| `FRAME_SKIP` | `2` | Process every Nth frame |
| `MATCH_THRESHOLD` | `0.45` | Cosine distance (lower = stricter) |
| `CONFIRM_FRAMES` | `5` | Votes before identity accepted |
| `ABSENCE_GAP_SEC` | `60` | Pause accumulation after this gap |
| `MIN_FACE_PX` | `80` | Minimum face width in pixels |
| `ADMIN_USER/PASS` | `admin`/`admin123` | Dashboard login |

---

## License

This project is for educational and research purposes.
