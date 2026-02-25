"""
schemas.py – Pydantic v2 request/response schemas for all API endpoints.
"""

from datetime import datetime, date as date_type
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator, model_validator, ConfigDict

from models import UserRole, LectureSource, PresenceStatus, AttendanceStatus


# ── Auth ──────────────────────────────────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    field_id: Optional[int] = None
    field_name: Optional[str] = None
    username: str


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ── Field ─────────────────────────────────────────────────────────────────────
class FieldCreate(BaseModel):
    name: str


class FieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    created_at: datetime


# ── Classroom ─────────────────────────────────────────────────────────────────
class ClassroomCreate(BaseModel):
    classroom_name: str
    field_id: int
    camera_source: str = "0"


class ClassroomUpdate(BaseModel):
    classroom_name: Optional[str] = None
    camera_source: Optional[str] = None
    is_active: Optional[bool] = None


class ClassroomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    field_id: int
    classroom_name: str
    camera_source: str
    is_active: bool
    created_at: datetime


# ── User ──────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.FACULTY
    field_id: Optional[int] = None


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[UserRole] = None
    field_id: Optional[int] = None
    is_active: Optional[bool] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str
    role: UserRole
    field_id: Optional[int]
    is_active: bool
    created_at: datetime


# ── Student ───────────────────────────────────────────────────────────────────
class StudentCreate(BaseModel):
    name: str
    enrollment_no: Optional[str] = None
    roll_no: Optional[str] = None
    classroom_id: int


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    enrollment_no: Optional[str]
    roll_no: Optional[str]
    classroom_id: int
    embedding_model: Optional[str]
    embedding_quality_score: Optional[float] = None
    embedding_frames_used: Optional[int] = None
    registered_at: datetime
    embedding_json: Optional[dict] = None
    has_embedding: bool = False

    @model_validator(mode="after")
    def compute_has_embedding(self):
        self.has_embedding = self.embedding_json is not None and bool(
            self.embedding_json
        )
        # Don't send the full embedding array to the frontend — it's huge
        self.embedding_json = {"status": "ready"} if self.has_embedding else None
        return self


# ── Google Sheet Config ───────────────────────────────────────────────────────
class SheetConfigCreate(BaseModel):
    sheet_name: str
    spreadsheet_id: str
    field_id: int


class SheetConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sheet_name: str
    spreadsheet_id: str
    field_id: int
    created_by: int
    created_at: datetime
    active: bool
    last_synced_at: Optional[datetime]


# ── Lecture ───────────────────────────────────────────────────────────────────
class LectureCreate(BaseModel):
    lecture_name: str
    lecture_date: date_type
    start_time: datetime
    end_time: datetime
    minimum_required_minutes: int = 30
    classroom_id: int


class LectureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    lecture_name: str
    lecture_date: date_type
    start_time: datetime
    end_time: datetime
    minimum_required_minutes: int
    classroom_id: int
    source: LectureSource
    finalized: bool


# ── Presence ──────────────────────────────────────────────────────────────────
class PresenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    student_name: str = ""
    lecture_id: int
    first_seen: Optional[datetime]
    last_seen: Optional[datetime]
    total_present_seconds: float
    status: PresenceStatus


# ── Final Attendance ──────────────────────────────────────────────────────────
class FinalAttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    student_name: str = ""
    lecture_id: int
    total_present_seconds: float
    status: AttendanceStatus


# ── Metrics ───────────────────────────────────────────────────────────────────
class SystemMetrics(BaseModel):
    engine_running: bool
    active_classroom_id: Optional[int]
    fps: float
    active_tracks: int
    frames_processed: int
    recognition_latency_ms: float
    ws_video_clients: int
    ws_presence_clients: int
    db_ok: bool


# ── Engine Control ────────────────────────────────────────────────────────────
class EngineStartRequest(BaseModel):
    classroom_id: int


# ── WebSocket Messages ────────────────────────────────────────────────────────
class PresenceUpdateMessage(BaseModel):
    type: str = "presence_update"
    lecture_id: Optional[int]
    lecture_name: Optional[str]
    students: list[dict]
    timestamp: datetime


class AuthExpiredMessage(BaseModel):
    type: str = "auth_expired"
