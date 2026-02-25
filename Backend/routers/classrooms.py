"""
routers/classrooms.py – CRUD for classrooms (admin) + list for faculty (field-scoped).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Classroom, User, UserRole
from schemas import ClassroomCreate, ClassroomOut, ClassroomUpdate
from auth import get_current_user, require_admin, assert_field_access

router = APIRouter(prefix="/api/classrooms", tags=["classrooms"])


@router.get("/", response_model=list[ClassroomOut])
async def list_classrooms(
    field_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admins see all; faculty see only classrooms for their field."""
    query = select(Classroom)
    if current_user.role == UserRole.FACULTY:
        query = query.where(Classroom.field_id == current_user.field_id)
    elif field_id:
        query = query.where(Classroom.field_id == field_id)
    query = query.order_by(Classroom.classroom_name)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=ClassroomOut, status_code=status.HTTP_201_CREATED)
async def create_classroom(
    data: ClassroomCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = await db.execute(
        select(Classroom).where(
            Classroom.field_id == data.field_id,
            Classroom.classroom_name == data.classroom_name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail="Classroom name already exists in this field"
        )

    classroom = Classroom(**data.model_dump())
    db.add(classroom)
    await db.commit()
    await db.refresh(classroom)
    return classroom


@router.patch("/{classroom_id}", response_model=ClassroomOut)
async def update_classroom(
    classroom_id: int,
    data: ClassroomUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Classroom).where(Classroom.id == classroom_id))
    classroom = result.scalar_one_or_none()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(classroom, field, value)
    await db.commit()
    await db.refresh(classroom)
    return classroom


@router.delete("/{classroom_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_classroom(
    classroom_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Classroom).where(Classroom.id == classroom_id))
    classroom = result.scalar_one_or_none()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Delete dependents in FK-safe order to avoid NOT NULL cascade errors.
    from models import Student, Lecture, PresenceTracking, FinalAttendance
    from sqlalchemy import delete

    # 1. Attendance/Presence records reference students + lectures
    student_ids_result = await db.execute(
        select(Student.id).where(Student.classroom_id == classroom_id)
    )
    student_ids = [r[0] for r in student_ids_result.fetchall()]

    lecture_ids_result = await db.execute(
        select(Lecture.id).where(Lecture.classroom_id == classroom_id)
    )
    lecture_ids = [r[0] for r in lecture_ids_result.fetchall()]

    if student_ids and lecture_ids:
        await db.execute(
            delete(FinalAttendance).where(
                FinalAttendance.student_id.in_(student_ids),
                FinalAttendance.lecture_id.in_(lecture_ids),
            )
        )
        await db.execute(
            delete(PresenceTracking).where(
                PresenceTracking.student_id.in_(student_ids),
                PresenceTracking.lecture_id.in_(lecture_ids),
            )
        )
    elif lecture_ids:
        await db.execute(
            delete(FinalAttendance).where(FinalAttendance.lecture_id.in_(lecture_ids))
        )
        await db.execute(
            delete(PresenceTracking).where(PresenceTracking.lecture_id.in_(lecture_ids))
        )

    # 2. Lectures
    if lecture_ids:
        await db.execute(delete(Lecture).where(Lecture.classroom_id == classroom_id))

    # 3. Students
    if student_ids:
        await db.execute(delete(Student).where(Student.classroom_id == classroom_id))

    # 4. Sheet configs (if any reference this classroom indirectly via field — skip, they use field_id)

    # 5. Finally the classroom itself
    await db.delete(classroom)
    await db.commit()
