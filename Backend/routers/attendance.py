"""
routers/attendance.py – Presence and final attendance queries + export.
"""

import csv
import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import get_db
from models import (
    PresenceTracking,
    FinalAttendance,
    Student,
    Lecture,
    Classroom,
    User,
    UserRole,
)
from schemas import PresenceOut, FinalAttendanceOut
from auth import get_current_user

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


@router.get("/presence/{lecture_id}", response_model=list[PresenceOut])
async def get_presence(
    lecture_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify lecture exists and user has access
    lect = await db.execute(
        select(Lecture)
        .options(selectinload(Lecture.classroom))
        .where(Lecture.id == lecture_id)
    )
    lecture = lect.scalar_one_or_none()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if (
        current_user.role == UserRole.FACULTY
        and lecture.classroom.field_id != current_user.field_id
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(PresenceTracking)
        .options(selectinload(PresenceTracking.student))
        .where(PresenceTracking.lecture_id == lecture_id)
    )
    records = result.scalars().all()
    out = []
    for r in records:
        data = PresenceOut.model_validate(r)
        data.student_name = r.student.name if r.student else ""
        out.append(data)
    return out


@router.get("/final/{lecture_id}", response_model=list[FinalAttendanceOut])
async def get_final_attendance(
    lecture_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lect = await db.execute(
        select(Lecture)
        .options(selectinload(Lecture.classroom))
        .where(Lecture.id == lecture_id)
    )
    lecture = lect.scalar_one_or_none()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if (
        current_user.role == UserRole.FACULTY
        and lecture.classroom.field_id != current_user.field_id
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(FinalAttendance)
        .options(selectinload(FinalAttendance.student))
        .where(FinalAttendance.lecture_id == lecture_id)
    )
    records = result.scalars().all()
    out = []
    for r in records:
        data = FinalAttendanceOut.model_validate(r)
        data.student_name = r.student.name if r.student else ""
        out.append(data)
    return out


@router.get("/export/{lecture_id}")
async def export_attendance_csv(
    lecture_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export final attendance for a lecture as CSV."""
    lect = await db.execute(
        select(Lecture)
        .options(selectinload(Lecture.classroom))
        .where(Lecture.id == lecture_id)
    )
    lecture = lect.scalar_one_or_none()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    if (
        current_user.role == UserRole.FACULTY
        and lecture.classroom.field_id != current_user.field_id
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(FinalAttendance)
        .options(selectinload(FinalAttendance.student))
        .where(FinalAttendance.lecture_id == lecture_id)
        .order_by(FinalAttendance.student_id)
    )
    records = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["Enrollment No.", "Student Name", "Roll No.", "Total Present (min)", "Status"]
    )
    for r in records:
        student = r.student
        writer.writerow(
            [
                student.enrollment_no or "",
                student.name,
                student.roll_no or "",
                round(r.total_present_seconds / 60, 1),
                r.status.value,
            ]
        )

    output.seek(0)
    fname = f"attendance_{lecture.classroom.classroom_name}_{lecture.lecture_date}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
