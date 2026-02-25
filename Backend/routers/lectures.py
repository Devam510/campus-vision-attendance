"""
routers/lectures.py – Lecture CRUD with field-scoped access.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import get_db
from models import Lecture, Classroom, User, UserRole, LectureSource
from schemas import LectureCreate, LectureOut
from auth import get_current_user, require_admin, assert_classroom_access

router = APIRouter(prefix="/api/lectures", tags=["lectures"])


@router.get("/", response_model=list[LectureOut])
async def list_lectures(
    classroom_id: int | None = None,
    date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Lecture).join(Classroom)
    if current_user.role == UserRole.FACULTY:
        query = query.where(Classroom.field_id == current_user.field_id)
    if classroom_id:
        query = query.where(Lecture.classroom_id == classroom_id)
    if date:
        query = query.where(Lecture.lecture_date == date)
    query = query.order_by(Lecture.start_time.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/active", response_model=LectureOut | None)
async def get_active_lecture(
    classroom_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the currently running lecture for a classroom, if any.
    If multiple lectures overlap, returns the one that started most recently.
    """
    import datetime as dt
    from sqlalchemy import cast
    from sqlalchemy.dialects.postgresql import TIME

    # All datetimes in DB are stored as IST naive datetimes (from sheet sync).
    # datetime.now() is also IST naive. Simple full-datetime comparison works
    # because sync now stores today's IST date as lecture_date + combined start/end.
    now = dt.datetime.now()

    result = await db.execute(
        select(Lecture)
        .where(
            Lecture.classroom_id == classroom_id,
            Lecture.lecture_date == now.date(),
            Lecture.start_time <= now,
            Lecture.end_time >= now,
            Lecture.finalized == False,
        )
        .order_by(Lecture.start_time.asc())  # earliest-starting lecture wins
        .limit(1)
    )
    return result.scalars().first()


@router.post("/", response_model=LectureOut, status_code=status.HTTP_201_CREATED)
async def create_lecture(
    data: LectureCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cr = await db.execute(select(Classroom).where(Classroom.id == data.classroom_id))
    classroom = cr.scalar_one_or_none()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")
    assert_classroom_access(current_user, classroom.field_id)

    lecture = Lecture(
        **data.model_dump(),
        created_by=current_user.id,
        source=LectureSource.MANUAL,
    )
    db.add(lecture)
    await db.commit()
    await db.refresh(lecture)
    return lecture


@router.patch("/{lecture_id}/finalize", response_model=LectureOut)
async def finalize_lecture(
    lecture_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Lecture).where(Lecture.id == lecture_id))
    lecture = result.scalar_one_or_none()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    lecture.finalized = True
    await db.commit()
    await db.refresh(lecture)
    return lecture


@router.delete("/{lecture_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lecture(
    lecture_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Lecture).where(Lecture.id == lecture_id))
    lecture = result.scalar_one_or_none()
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")
    await db.delete(lecture)
    await db.commit()
