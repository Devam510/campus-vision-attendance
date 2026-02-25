"""
services/google_sheets_service.py – Google Sheets parser & background sync.

Sheet format (tab-per-classroom):
  Tab name = classroom_name (e.g. "BTECH-A")
  Row 1: merged date cells (YYYY-MM-DD) spanning N lecture columns
  Row 2: Start times (HH:MM) per lecture column
  Row 3: End times (HH:MM) per lecture column
  Row 4: "Enroll No." | "Student Name" | "Roll No." | subject_name | subject_name | ...
  Row 5+: student data rows
"""

import hashlib
import logging
import re
from datetime import datetime, date as date_type, time as time_type
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import GoogleSheetConfig, Classroom, Lecture, Student, LectureSource
from config import settings

log = logging.getLogger("sheets_service")


# ── Google Sheets Client ──────────────────────────────────────────────────────
def _get_sheets_client():
    """Build authenticated Google Sheets API client.

    Priority:
      1. Service account credentials (credentials.json) — works with private sheets
      2. API key (GOOGLE_API_KEY env var)            — works with public sheets only
    """
    try:
        from googleapiclient.discovery import build
    except ImportError:
        raise RuntimeError(
            "google-api-python-client not installed. Run: pip install google-api-python-client google-auth"
        )

    import os

    creds_path = settings.GOOGLE_CREDENTIALS_PATH

    # ── Option 1: service account credentials file ─────────────────────────
    if os.path.exists(creds_path):
        try:
            from google.oauth2 import service_account

            creds = service_account.Credentials.from_service_account_file(
                creds_path,
                scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
            )
            return build("sheets", "v4", credentials=creds, cache_discovery=False)
        except Exception as e:
            log.warning(
                "credentials.json exists but failed to load: %s — trying API key", e
            )

    # ── Option 2: API key (public sheets only) ─────────────────────────────
    api_key = settings.GOOGLE_API_KEY
    if api_key:
        log.info(
            "Using API key auth for Google Sheets (sheet must be publicly viewable)"
        )
        return build("sheets", "v4", developerKey=api_key, cache_discovery=False)

    raise RuntimeError(
        "No Google Sheets credentials found. Either:\n"
        "  1. Place credentials.json in the Backend folder, OR\n"
        "  2. Set GOOGLE_API_KEY in .env and make the sheet public (Anyone with link → Viewer)"
    )


def _fetch_tab_data(sheets_client, spreadsheet_id: str, tab_name: str) -> list[list]:
    """Fetch all values from a specific tab, up to 200 rows × 100 cols."""
    result = (
        sheets_client.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"'{tab_name}'!A1:ZZ200")
        .execute()
    )
    return result.get("values", [])


def _fetch_sheet_metadata(sheets_client, spreadsheet_id: str) -> list[str]:
    """Return list of sheet (tab) names in the spreadsheet."""
    meta = sheets_client.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    return [s["properties"]["title"] for s in meta.get("sheets", [])]


# ── Parser ────────────────────────────────────────────────────────────────────
def _parse_date(value) -> Optional[date_type]:
    """Parse a date value (string or datetime) to date object."""
    if not value:
        return None
    if isinstance(value, (datetime,)):
        return value.date()
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_time(value) -> Optional[time_type]:
    """Parse HH:MM or HH:MM:SS to time object."""
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


def _parse_tab(rows: list[list], classroom_name: str) -> list[dict]:
    """
    Parse a single tab into a list of lecture-dicts.
    Returns [] if tab cannot be parsed.
    """
    if len(rows) < 4:
        log.warning("Tab '%s' has < 4 rows — skipping", classroom_name)
        return []

    row1 = rows[0]  # Date row
    row2 = rows[1]  # Start time row
    row3 = rows[2]  # End time row
    row4 = rows[3]  # Header row (Enroll No., Student Name, Roll No., subject...)

    # Validate structural anchor: Col A of row 4 must be "Enroll No." (case-insensitive)
    anchor = str(row4[0]).strip().lower() if row4 else ""
    if "enroll" not in anchor:
        log.warning(
            "Tab '%s': Row 4 Col A is '%s', expected 'Enroll No.' — skipping",
            classroom_name,
            row4[0] if row4 else "",
        )
        return []

    # First 3 columns are student data (Enroll No., Student Name, Roll No.)
    STUDENT_COLS = 3

    # Build column → date mapping from row 1
    # Scan left to right; when we see a date, it applies until the next date
    col_dates: dict[int, date_type] = {}
    current_date = None
    for col_idx, cell in enumerate(row1):
        if col_idx < STUDENT_COLS:
            continue
        d = _parse_date(cell)
        if d:
            current_date = d
        if current_date:
            col_dates[col_idx] = current_date

    lectures: list[dict] = []
    for col_idx, col_date in col_dates.items():
        # Parse start/end times for this column
        start_val = row2[col_idx] if col_idx < len(row2) else None
        end_val = row3[col_idx] if col_idx < len(row3) else None
        subject = row4[col_idx] if col_idx < len(row4) else None

        if not subject or not str(subject).strip():
            continue  # Empty subject → no lecture

        start_time = _parse_time(start_val)
        end_time = _parse_time(end_val)
        if not start_time or not end_time:
            log.warning(
                "Tab '%s' col %d: invalid times start=%s end=%s — skipping",
                classroom_name,
                col_idx,
                start_val,
                end_val,
            )
            continue

        start_dt = datetime.combine(col_date, start_time)
        end_dt = datetime.combine(col_date, end_time)
        if end_dt <= start_dt:
            log.warning(
                "Tab '%s' col %d: end_time <= start_time — skipping",
                classroom_name,
                col_idx,
            )
            continue

        lectures.append(
            {
                "lecture_name": str(subject).strip(),
                "lecture_date": col_date,
                "start_time": start_dt,
                "end_time": end_dt,
                "classroom_name": classroom_name,
            }
        )

    # Parse student rows (row 5+, index 4+)
    students: list[dict] = []
    for row in rows[4:]:
        if not row or not any(row):
            continue
        enroll = str(row[0]).strip() if len(row) > 0 and row[0] else None
        name = str(row[1]).strip() if len(row) > 1 and row[1] else None
        roll = str(row[2]).strip() if len(row) > 2 and row[2] else None

        if enroll and enroll.endswith(".0"):
            enroll = enroll[:-2]  # Strip .0 from float formatting in xlsx exports
        if roll and roll.endswith(".0"):
            roll = roll[:-2]

        if name:
            students.append({"enrollment_no": enroll, "name": name, "roll_no": roll})

    return lectures, students


# ── Main Sync Function ────────────────────────────────────────────────────────
async def sync_sheet_for_field(
    config: GoogleSheetConfig,
    db: AsyncSession,
    validate_only: bool = False,
) -> bool:
    """
    Fetch and parse the Google Sheet, create/update lectures in DB.
    If validate_only=True, just checks if sheet is parseable without writing.
    Returns True if at least one tab was successfully parsed.
    """
    try:
        client = _get_sheets_client()
    except RuntimeError as e:
        log.error("Cannot build Sheets client: %s", e)
        return False

    # Fetch all tab names
    try:
        tab_names = _fetch_sheet_metadata(client, config.spreadsheet_id)
    except Exception as e:
        log.error("Failed to fetch sheet metadata for '%s': %s", config.sheet_name, e)
        raise

    # Load classrooms for this field
    cr_result = await db.execute(
        select(Classroom).where(
            Classroom.field_id == config.field_id, Classroom.is_active == True
        )
    )
    classrooms = {c.classroom_name: c for c in cr_result.scalars().all()}

    if not classrooms:
        log.warning("No active classrooms for field %d", config.field_id)
        return False

    # Log diagnostic info for debugging tab name mismatches
    log.info("Sheet tabs found: %s", tab_names)
    log.info(
        "Classroom names in field %d: %s", config.field_id, list(classrooms.keys())
    )

    matched_tabs = [t for t in tab_names if t in classrooms]
    if not matched_tabs:
        msg = (
            f"No tab names match any classroom. "
            f"Sheet tabs: {tab_names} | "
            f"Classrooms in field: {list(classrooms.keys())}"
        )
        log.warning(msg)
        raise ValueError(msg)

    # Build full sheet content hash for change detection
    all_content = ""
    parsed_any = False

    for tab_name in tab_names:
        if tab_name not in classrooms:
            log.debug("Tab '%s' has no matching classroom — skipping", tab_name)
            continue

        try:
            rows = _fetch_tab_data(client, config.spreadsheet_id, tab_name)
        except Exception as e:
            log.warning("Failed to fetch tab '%s': %s", tab_name, e)
            continue

        parsed = _parse_tab(rows, tab_name)
        if not parsed:
            continue

        lectures_data, students_data = parsed
        if not lectures_data:
            continue

        parsed_any = True
        all_content += f"{tab_name}:{str(rows)}"

        if validate_only:
            continue

        classroom = classrooms[tab_name]

        # Auto-enroll students from roster
        for s_data in students_data:
            if not s_data["enrollment_no"]:
                continue
            existing = await db.execute(
                select(Student).where(
                    Student.enrollment_no == s_data["enrollment_no"],
                    Student.classroom_id == classroom.id,
                )
            )
            if not existing.scalar_one_or_none():
                student = Student(
                    name=s_data["name"],
                    enrollment_no=s_data["enrollment_no"],
                    roll_no=s_data["roll_no"],
                    classroom_id=classroom.id,
                )
                db.add(student)

        # Upsert lectures — match by (classroom, date, subject) so that
        # changing the time in the sheet UPDATES the existing lecture,
        # not creates a stale duplicate alongside the old time.
        for lect_data in lectures_data:
            existing_lect = await db.execute(
                select(Lecture).where(
                    Lecture.classroom_id == classroom.id,
                    Lecture.lecture_date == lect_data["lecture_date"],
                    Lecture.lecture_name == lect_data["lecture_name"],
                )
            )
            lecture = existing_lect.scalar_one_or_none()
            if lecture:
                lecture.start_time = lect_data["start_time"]  # update time if changed
                lecture.end_time = lect_data["end_time"]
                lecture.source = LectureSource.GOOGLE_SHEET
            else:
                lecture = Lecture(
                    lecture_name=lect_data["lecture_name"],
                    lecture_date=lect_data["lecture_date"],
                    start_time=lect_data["start_time"],
                    end_time=lect_data["end_time"],
                    classroom_id=classroom.id,
                    source=LectureSource.GOOGLE_SHEET,
                )
                db.add(lecture)

    if not validate_only:
        # Update last_synced_at and last_hash
        content_hash = hashlib.sha256(all_content.encode()).hexdigest()
        config.last_synced_at = (
            datetime.now()
        )  # store in local IST so frontend displays correctly
        config.last_hash = content_hash
        await db.commit()
        log.info(
            "Sheet sync complete for field %d — %d tabs processed",
            config.field_id,
            len(tab_names),
        )

    return parsed_any


# ── Background Periodic Sync ──────────────────────────────────────────────────
async def run_sheet_sync_loop(db_session_factory):
    """Background coroutine: syncs all active sheets every N minutes."""
    import asyncio

    interval = settings.SHEETS_REFRESH_INTERVAL_MINUTES * 60
    log.info(
        "Sheet sync loop started (interval: %d min)",
        settings.SHEETS_REFRESH_INTERVAL_MINUTES,
    )

    while True:
        await asyncio.sleep(interval)
        try:
            async with db_session_factory() as db:
                result = await db.execute(
                    select(GoogleSheetConfig).where(GoogleSheetConfig.active == True)
                )
                active_configs = result.scalars().all()
                for config in active_configs:
                    try:
                        await sync_sheet_for_field(config, db)
                    except Exception as e:
                        log.error(
                            "Sync failed for sheet '%s': %s", config.sheet_name, e
                        )
        except Exception as e:
            log.error("Sheet sync loop error: %s", e, exc_info=True)
