from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import create_access_token, hash_password, verify_password
from config import LOGIN_RATE_LIMIT
from database import get_db
from dependencies import get_current_user
from models import User
from schemas import OTPRequest, OTPVerify, PasswordUpdate, Token, UserCreate, UserOut, UserUpdate
from services.otp_service import otp_service, determine_role_from_email

router = APIRouter(prefix="/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/register/request-otp")
@limiter.limit("3/minute")  # prevents someone spamming a stranger's inbox
async def request_otp(request: Request, payload: OTPRequest, db: AsyncSession = Depends(get_db)):
    try:
        await otp_service.request_otp(payload.email, db)
        return {"success": True, "message": "Verification code sent."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/register/verify-otp")
async def verify_otp(payload: OTPVerify, db: AsyncSession = Depends(get_db)):
    try:
        await otp_service.verify_otp(payload.email, payload.code, db)
        return {"success": True, "message": "Email verified."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/register", response_model=UserOut)
async def register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Institutional email doubles as the username (set below) — students
    and staff get an ISAT-U email issued by the school, so it's already
    guaranteed unique, and it's what they'll actually remember to log
    in with. Role is never trusted from the client; it's derived from
    the email domain (determine_role_from_email), and account creation
    is gated on having completed OTP verification for that email first.
    """
    if not await otp_service.is_email_verified(user_in.email, db):
        raise HTTPException(status_code=400, detail="Please verify your email before registering.")

    try:
        role = determine_role_from_email(user_in.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This email is already registered")

    user = User(
        username=user_in.email,  # institutional email doubles as the username
        email=user_in.email,
        password_hash=hash_password(user_in.password),
        fullname=user_in.fullname,
        role=role,
        department=user_in.department,
    )
    db.add(user)
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
    # form_data.username holds whatever the client sent — in practice,
    # the institutional email, since that's now the account's username.
    # Normalized here because OAuth2PasswordRequestForm is a plain form
    # field, not run through the EmailStr/_EmailNormalizedBase validator
    # that schemas.py applies everywhere else.
    normalized_username = form_data.username.strip().lower()
    result = await db.execute(select(User).where(User.username == normalized_username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role.value})
    return Token(access_token=access_token, role=user.role, fullname=user.fullname)


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Decodes the caller's JWT and returns their profile. Frontend calls
    this on every page load to confirm who's logged in and drive the navbar.
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

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"success": True}