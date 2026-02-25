"""
routers/fields.py – CRUD for institutional fields (ADMIN only).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Field, User
from schemas import FieldCreate, FieldOut
from auth import require_admin

router = APIRouter(prefix="/api/fields", tags=["fields"])


@router.get("/", response_model=list[FieldOut])
async def list_fields(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Field).order_by(Field.name))
    return result.scalars().all()


@router.post("/", response_model=FieldOut, status_code=status.HTTP_201_CREATED)
async def create_field(
    data: FieldCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = await db.execute(select(Field).where(Field.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail=f"Field '{data.name}' already exists"
        )
    field = Field(name=data.name)
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return field


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    field_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Field).where(Field.id == field_id))
    field = result.scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    # Cascade delete everything under this field in FK-safe order
    from models import (
        Classroom,
        Student,
        Lecture,
        PresenceTracking,
        FinalAttendance,
        UserRole,
    )
    from sqlalchemy import delete, update

    # Collect all classroom IDs in this field
    cr_ids_result = await db.execute(
        select(Classroom.id).where(Classroom.field_id == field_id)
    )
    cr_ids = [r[0] for r in cr_ids_result.fetchall()]

    if cr_ids:
        # Collect student + lecture IDs
        st_ids_result = await db.execute(
            select(Student.id).where(Student.classroom_id.in_(cr_ids))
        )
        st_ids = [r[0] for r in st_ids_result.fetchall()]

        lc_ids_result = await db.execute(
            select(Lecture.id).where(Lecture.classroom_id.in_(cr_ids))
        )
        lc_ids = [r[0] for r in lc_ids_result.fetchall()]

        # 1. Presence + Attendance records
        if lc_ids:
            await db.execute(
                delete(FinalAttendance).where(FinalAttendance.lecture_id.in_(lc_ids))
            )
            await db.execute(
                delete(PresenceTracking).where(PresenceTracking.lecture_id.in_(lc_ids))
            )
        # 2. Lectures
        if lc_ids:
            await db.execute(delete(Lecture).where(Lecture.classroom_id.in_(cr_ids)))
        # 3. Students
        if st_ids:
            await db.execute(delete(Student).where(Student.classroom_id.in_(cr_ids)))
        # 4. Classrooms
        await db.execute(delete(Classroom).where(Classroom.field_id == field_id))

    # Unlink faculty users from this field (field_id is nullable for non-faculty)
    await db.execute(
        update(User)
        .where(User.field_id == field_id, User.role == UserRole.FACULTY)
        .values(field_id=None)
    )

    # 5. Finally delete the field
    await db.delete(field)
    await db.commit()
