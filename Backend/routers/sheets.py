"""
routers/sheets.py – Google Sheets config CRUD + activate/deactivate + manual sync.
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from database import get_db
from models import GoogleSheetConfig, User
from schemas import SheetConfigCreate, SheetConfigOut
from auth import require_admin, get_current_user
from services.google_sheets_service import sync_sheet_for_field

router = APIRouter(prefix="/api/sheets", tags=["sheets"])


@router.get("/", response_model=list[SheetConfigOut])
async def list_sheet_configs(
    field_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = select(GoogleSheetConfig)
    if field_id:
        query = query.where(GoogleSheetConfig.field_id == field_id)
    result = await db.execute(query.order_by(GoogleSheetConfig.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=SheetConfigOut, status_code=status.HTTP_201_CREATED)
async def create_sheet_config(
    data: SheetConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    config = GoogleSheetConfig(
        sheet_name=data.sheet_name,
        spreadsheet_id=data.spreadsheet_id,
        field_id=data.field_id,
        created_by=current_user.id,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


@router.post("/{config_id}/activate", response_model=SheetConfigOut)
async def activate_sheet(
    config_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Activate a sheet config. Deactivates any other active config for same field first.
    Then triggers an immediate sync."""
    result = await db.execute(
        select(GoogleSheetConfig).where(GoogleSheetConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")

    # Deactivate others in same field
    await db.execute(
        update(GoogleSheetConfig)
        .where(
            GoogleSheetConfig.field_id == config.field_id,
            GoogleSheetConfig.id != config_id,
            GoogleSheetConfig.active == True,
        )
        .values(active=False)
    )

    # Try to parse the sheet first to validate it's usable
    try:
        validation_ok = await sync_sheet_for_field(config, db, validate_only=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Sheet validation failed: {str(exc)}. Check format and permissions.",
        ) from exc

    if not validation_ok:
        raise HTTPException(
            status_code=400,
            detail="Sheet has no parseable tabs matching your classrooms. "
            "Ensure tab names match classroom names in this field.",
        )

    config.active = True
    await db.commit()
    await db.refresh(config)

    # Trigger async sync after activation
    background_tasks.add_task(sync_sheet_for_field, config, db)
    return config


@router.post("/{config_id}/deactivate", response_model=SheetConfigOut)
async def deactivate_sheet(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(GoogleSheetConfig).where(GoogleSheetConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")
    config.active = False
    await db.commit()
    await db.refresh(config)
    return config


@router.post("/{config_id}/sync", response_model=SheetConfigOut)
async def manual_sync(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Synchronous manual sync — runs inline so last_synced_at is committed
    before the response returns. Frontend can refresh immediately."""
    result = await db.execute(
        select(GoogleSheetConfig).where(GoogleSheetConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")
    if not config.active:
        raise HTTPException(status_code=400, detail="Sheet config is not active")
    try:
        await sync_sheet_for_field(config, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(exc)}") from exc
    await db.refresh(config)
    return config


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sheet_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(
        select(GoogleSheetConfig).where(GoogleSheetConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Sheet config not found")
    await db.delete(config)
    await db.commit()
