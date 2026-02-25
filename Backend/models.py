"""
models.py – SQLAlchemy ORM models for all 9 tables.

IMPORTANT: All relationships use lazy="raise" by default to prevent
MissingGreenlet errors in async context. Use selectinload() or
joinedload() explicitly in queries when you need related objects.
"""

from datetime import datetime, date as date_type
from sqlalchemy import (
    Integer,
    String,
    Float,
    Boolean,
    Text,
    DateTime,
    Date,
    ForeignKey,
    UniqueConstraint,
    Index,
    Enum as SAEnum,
)
from sqlalchemy.orm import mapped_column, Mapped, relationship
from sqlalchemy.dialects.postgresql import JSONB
import enum

from database import Base


# ── Enums ─────────────────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    FACULTY = "FACULTY"


class LectureSource(str, enum.Enum):
    MANUAL = "MANUAL"
    GOOGLE_SHEET = "GOOGLE_SHEET"
    SCHEDULE_REMOVED = "SCHEDULE_REMOVED"


class PresenceStatus(str, enum.Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"


# ── Models ────────────────────────────────────────────────────────────────────
class Field(Base):
    __tablename__ = "fields"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships — use lazy="raise" for collections to prevent accidental lazy loads
    classrooms: Mapped[list["Classroom"]] = relationship(
        "Classroom", back_populates="field", lazy="raise"
    )
    users: Mapped[list["User"]] = relationship(
        "User", back_populates="field", lazy="raise"
    )
    sheet_configs: Mapped[list["GoogleSheetConfig"]] = relationship(
        "GoogleSheetConfig", back_populates="field", lazy="raise"
    )


class Classroom(Base):
    __tablename__ = "classrooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    field_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("fields.id"), nullable=False
    )
    classroom_name: Mapped[str] = mapped_column(String(100), nullable=False)
    camera_source: Mapped[str] = mapped_column(String(500), default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    field: Mapped["Field"] = relationship(
        "Field", back_populates="classrooms", lazy="raise"
    )
    students: Mapped[list["Student"]] = relationship(
        "Student", back_populates="classroom", lazy="raise"
    )
    lectures: Mapped[list["Lecture"]] = relationship(
        "Lecture", back_populates="classroom", lazy="raise"
    )

    __table_args__ = (
        UniqueConstraint("field_id", "classroom_name", name="uq_classroom_field_name"),
        Index("idx_classrooms_field", "field_id"),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="userrole"), default=UserRole.FACULTY
    )
    field_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("fields.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    field: Mapped["Field | None"] = relationship(
        "Field", back_populates="users", lazy="raise"
    )
    created_lectures: Mapped[list["Lecture"]] = relationship(
        "Lecture", back_populates="creator", lazy="raise"
    )
    created_sheets: Mapped[list["GoogleSheetConfig"]] = relationship(
        "GoogleSheetConfig", back_populates="creator", lazy="raise"
    )


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    enrollment_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    roll_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    classroom_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classrooms.id"), nullable=False
    )
    embedding_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Registration quality metadata (set by live-scan multi-frame registration)
    embedding_quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    embedding_frames_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    classroom: Mapped["Classroom"] = relationship(
        "Classroom", back_populates="students", lazy="raise"
    )
    presence_records: Mapped[list["PresenceTracking"]] = relationship(
        "PresenceTracking", back_populates="student", lazy="raise"
    )
    attendance_records: Mapped[list["FinalAttendance"]] = relationship(
        "FinalAttendance", back_populates="student", lazy="raise"
    )

    __table_args__ = (
        UniqueConstraint(
            "enrollment_no", "classroom_id", name="uq_student_enrollment_classroom"
        ),
        Index("idx_students_classroom", "classroom_id"),
    )


class GoogleSheetConfig(Base):
    __tablename__ = "google_sheets_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sheet_name: Mapped[str] = mapped_column(String(255), nullable=False)
    spreadsheet_id: Mapped[str] = mapped_column(String(255), nullable=False)
    field_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("fields.id"), nullable=False
    )
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Relationships
    field: Mapped["Field"] = relationship(
        "Field", back_populates="sheet_configs", lazy="raise"
    )
    creator: Mapped["User"] = relationship(
        "User", back_populates="created_sheets", lazy="raise"
    )

    __table_args__ = (Index("idx_sheets_field", "field_id"),)


class Lecture(Base):
    __tablename__ = "lectures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lecture_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lecture_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    minimum_required_minutes: Mapped[int] = mapped_column(Integer, default=30)
    classroom_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classrooms.id"), nullable=False
    )
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    source: Mapped[LectureSource] = mapped_column(
        SAEnum(LectureSource, name="lecturesource"), default=LectureSource.MANUAL
    )
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    last_engine_heartbeat: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship(
        "Classroom", back_populates="lectures", lazy="raise"
    )
    creator: Mapped["User | None"] = relationship(
        "User", back_populates="created_lectures", lazy="raise"
    )
    presence_records: Mapped[list["PresenceTracking"]] = relationship(
        "PresenceTracking", back_populates="lecture", lazy="raise"
    )
    attendance_records: Mapped[list["FinalAttendance"]] = relationship(
        "FinalAttendance", back_populates="lecture", lazy="raise"
    )
    analytics: Mapped[list["AnalyticsLog"]] = relationship(
        "AnalyticsLog", back_populates="lecture", lazy="raise"
    )

    __table_args__ = (
        Index("idx_lectures_classroom", "classroom_id"),
        Index("idx_lectures_date", "lecture_date"),
    )


class PresenceTracking(Base):
    __tablename__ = "presence_tracking"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("students.id"), nullable=False
    )
    lecture_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("lectures.id"), nullable=False
    )
    camera_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_present_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[PresenceStatus] = mapped_column(
        SAEnum(PresenceStatus, name="presencestatus"),
        default=PresenceStatus.IN_PROGRESS,
    )

    # Relationships
    student: Mapped["Student"] = relationship(
        "Student", back_populates="presence_records", lazy="raise"
    )
    lecture: Mapped["Lecture"] = relationship(
        "Lecture", back_populates="presence_records", lazy="raise"
    )

    __table_args__ = (
        UniqueConstraint(
            "student_id", "lecture_id", name="uq_presence_student_lecture"
        ),
        Index("idx_presence_lecture", "lecture_id"),
        Index("idx_presence_student", "student_id"),
    )


class FinalAttendance(Base):
    __tablename__ = "final_attendance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("students.id"), nullable=False
    )
    lecture_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("lectures.id"), nullable=False
    )
    camera_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total_present_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[AttendanceStatus] = mapped_column(
        SAEnum(AttendanceStatus, name="attendancestatus"),
        default=AttendanceStatus.ABSENT,
    )

    # Relationships
    student: Mapped["Student"] = relationship(
        "Student", back_populates="attendance_records", lazy="raise"
    )
    lecture: Mapped["Lecture"] = relationship(
        "Lecture", back_populates="attendance_records", lazy="raise"
    )

    __table_args__ = (
        UniqueConstraint("student_id", "lecture_id", name="uq_final_student_lecture"),
        Index("idx_final_lecture_status", "lecture_id", "status"),
    )


class AnalyticsLog(Base):
    __tablename__ = "analytics_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lecture_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("lectures.id"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    detections_per_min: Mapped[float] = mapped_column(Float, default=0.0)
    recognitions_per_min: Mapped[float] = mapped_column(Float, default=0.0)
    recognition_success_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # Relationships
    lecture: Mapped["Lecture"] = relationship(
        "Lecture", back_populates="analytics", lazy="raise"
    )

    __table_args__ = (Index("idx_analytics_lecture", "lecture_id"),)
