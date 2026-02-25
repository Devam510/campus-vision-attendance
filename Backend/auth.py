"""
auth.py – JWT authentication, password hashing, login endpoint, and FastAPI dependencies.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import bcrypt as _bcrypt
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import get_db
from models import User, UserRole
from schemas import LoginRequest, TokenResponse, UserCreate, UserOut
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)

COOKIE_NAME = "refresh_token"


# ── Password Utils ────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt(12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


# ── JWT Utils ─────────────────────────────────────────────────────────────────
def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.value,
        "field_id": user.field_id,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.JWT_REFRESH_EXPIRY_DAYS
    )
    payload = {
        "sub": str(user.id),
        "exp": expire,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ── Current User Dependency ───────────────────────────────────────────────────
async def get_current_user(
    credentials: Annotated[
        Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)
    ],
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type"
        )

    user_id = int(payload["sub"])
    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user


async def get_current_user_from_query_token(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> User:
    """For WebSocket auth where token is passed as query param."""
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type"
        )
    user_id = int(payload["sub"])
    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user


# ── Role Dependency ───────────────────────────────────────────────────────────
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return current_user


def require_any_role(current_user: User = Depends(get_current_user)) -> User:
    return current_user


# ── Field Isolation Helper ────────────────────────────────────────────────────
def assert_field_access(user: User, field_id: int) -> None:
    """Faculty can only access their own field. Admins can access any."""
    if user.role == UserRole.ADMIN:
        return
    if user.field_id != field_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this field is not permitted",
        )


def assert_classroom_access(user: User, classroom_field_id: int) -> None:
    """Faculty can only access classrooms within their field."""
    if user.role == UserRole.ADMIN:
        return
    if user.field_id != classroom_field_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this classroom is not permitted",
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
async def login(
    request_data: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login and receive access token. Refresh token set as httpOnly cookie."""
    result = await db.execute(
        select(User)
        .where(User.username == request_data.username, User.is_active == True)
        .options(selectinload(User.field))
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(request_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)

    # Set refresh token as httpOnly + SameSite=Strict cookie
    response.set_cookie(
        key=COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        samesite="strict",
        secure=False,  # Set True in production with HTTPS
        max_age=settings.JWT_REFRESH_EXPIRY_DAYS * 86400,
        path="/api/auth/refresh",
    )

    # Load field name if applicable
    field_name = None
    if user.field_id and user.field:
        field_name = user.field.name

    return TokenResponse(
        access_token=access_token,
        role=user.role,
        field_id=user.field_id,
        field_name=field_name,
        username=user.username,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Issue new access token using httpOnly refresh token cookie."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token"
        )

    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type"
        )

    user_id = int(payload["sub"])
    result = await db.execute(
        select(User)
        .where(User.id == user_id, User.is_active == True)
        .options(selectinload(User.field))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    new_access = create_access_token(user)
    new_refresh = create_refresh_token(user)

    response.set_cookie(
        key=COOKIE_NAME,
        value=new_refresh,
        httponly=True,
        samesite="strict",
        secure=False,
        max_age=settings.JWT_REFRESH_EXPIRY_DAYS * 86400,
        path="/api/auth/refresh",
    )

    return TokenResponse(
        access_token=new_access,
        role=user.role,
        field_id=user.field_id,
        username=user.username,
    )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/api/auth/refresh")
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
