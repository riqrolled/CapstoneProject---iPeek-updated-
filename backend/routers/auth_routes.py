import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import create_access_token, generate_password, hash_password, verify_password
from config import LOGIN_RATE_LIMIT
from database import get_db
from dependencies import get_current_user
from models import User
from schemas import OTPRequest, OTPVerify, PasswordUpdate, Token, UserCreate, UserOut, UserUpdate
from services.otp_service import determine_role_from_email, otp_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/register/request-otp")
@limiter.limit(LOGIN_RATE_LIMIT)
async def request_otp(
    payload: OTPRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Step 1 of registration: validate the institutional email and send
    a 6-digit OTP. No account is created here and no password is chosen
    anywhere — role and password are both decided server-side later."""
    try:
        await otp_service.request_otp(payload.email, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Verification code sent."}


@router.post("/register/verify-otp")
@limiter.limit(LOGIN_RATE_LIMIT)
async def verify_otp(
    payload: OTPVerify,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Step 2 of registration: check the OTP code. Marks the email as
    verified — the account itself is created by POST /register, which
    generates and emails the password in the same request."""
    try:
        await otp_service.verify_otp(payload.email, payload.code, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Email verified."}


@router.post("/register", response_model=UserOut)
async def register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    """Step 3 of registration: creates the account for a VERIFIED email.
    There is no client-supplied password (any sent "password" field is
    ignored by the schema) and no client-supplied role — the password is
    generated server-side at this moment, hashed with bcrypt, and the
    plaintext is emailed to the verified address exactly once. The
    plaintext is never returned in the response and never stored."""
    try:
        role = determine_role_from_email(user_in.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not await otp_service.is_email_verified(user_in.email, db):
        raise HTTPException(
            status_code=400,
            detail="Email not verified. Please enter the code we sent you.",
        )

    result = await db.execute(
        select(User).where(
            (User.username == user_in.email) | (User.email == user_in.email)
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    # Generated HERE, after verification — never at step 1, never stored
    # in plaintext. Only the bcrypt hash is persisted on the user row.
    password = generate_password()
    user = User(
        username=user_in.email,
        email=user_in.email,
        password_hash=hash_password(password),
        fullname=user_in.fullname,
        role=role,
        department=user_in.department,
    )
    db.add(user)

    # Email BEFORE commit: if delivery fails, roll the account back and
    # unconsume the OTP so the same code can be retried — a user must
    # never end up with a password nobody knows.
    try:
        await otp_service.send_generated_password_email(user_in.email, password)
    except ValueError as e:
        await db.rollback()
        await otp_service.unconsume(user_in.email, db)
        raise HTTPException(status_code=500, detail=str(e))

    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=Token)
@limiter.limit(LOGIN_RATE_LIMIT)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Contact the librarian.",
        )

    # "sid" = per-login session id. Every login (device/browser) gets a
    # fresh UUID, so the kiosk lock can be scoped to ONE session and can
    # never leak into another session of the same user/role.
    access_token = create_access_token(
        data={"sub": str(user.id), "role": user.role.value, "sid": uuid4().hex}
    )
    return Token(access_token=access_token, role=user.role, fullname=user.fullname)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Decodes the caller's JWT and returns their profile. Frontend calls
    this on every page load — the equivalent of the old system's
    GET /api/auth/me — to confirm who's logged in and drive the navbar.
    """
    return current_user


@router.put("/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.fullname = payload.fullname
    current_user.email = payload.email
    current_user.contact = payload.contact
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.put("/password")
async def update_password(
    payload: PasswordUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
    # Server-side strength (the frontend meter is display-only): must mix
    # letters and numbers — rejects weak passwords regardless of client.
    if not re.search(r"[A-Za-z]", payload.new_password) or not re.search(
        r"\d", payload.new_password
    ):
        raise HTTPException(
            status_code=400,
            detail="New password must mix letters and numbers.",
        )

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"success": True}