"""
services/otp_service.py
-------------------------
Handles OTP generation, storage/verification, and emailing — for the
Gmail-based registration flow.

Uses only Python's standard library (secrets, hashlib, smtplib, email) —
no new pip dependencies needed.

smtplib is synchronous/blocking, so the actual send is wrapped in
asyncio.to_thread(), matching the async-first pattern used everywhere
else in this codebase (ingestor.py, vectorstore.py, reranker.py).
"""
import asyncio
import hashlib
import logging
import secrets
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import (
    SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD,
    OTP_EXPIRE_MINUTES, OTP_MAX_ATTEMPTS,
    STUDENT_EMAIL_DOMAIN, STAFF_EMAIL_DOMAIN, LIBRARIAN_EMAILS,
)
from models import OTPVerification, RoleEnum

logger = logging.getLogger(__name__)


def determine_role_from_email(email: str) -> RoleEnum:
    """
    Derives the account role from the institutional email — this is the
    actual access-control decision, not a client-supplied field.

    @students.isatu.edu.ph -> student
    @isatu.edu.ph          -> librarian, IF the address is on the
                               LIBRARIAN_EMAILS allowlist (config.py /
                               .env) — otherwise -> faculty.

    The allowlist step exists because the domain alone can't distinguish
    an actual librarian from a teacher/adviser; both share
    @isatu.edu.ph. Faculty accounts currently have the same route
    access as students (see research_routes.py / ai_routes.py) — no
    admin/review capability, by design.

    Raises ValueError for any other domain. Called both before sending
    an OTP (so we never email a non-institutional address) and again at
    registration (so the role can never be spoofed by the client).
    """
    email_lower = email.strip().lower()
    if email_lower.endswith(STUDENT_EMAIL_DOMAIN):
        return RoleEnum.student
    if email_lower.endswith(STAFF_EMAIL_DOMAIN):
        return RoleEnum.librarian if email_lower in LIBRARIAN_EMAILS else RoleEnum.faculty
    raise ValueError(
        f"Only ISAT-U institutional emails are accepted "
        f"({STUDENT_EMAIL_DOMAIN} for students, {STAFF_EMAIL_DOMAIN} for faculty/librarians)."
    )


def _hash_code(code: str) -> str:
    """SHA-256 is sufficient here (not bcrypt) — OTPs are short-lived
    (10 min) and rate-limited, unlike passwords which must resist
    offline cracking indefinitely."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    """6-digit numeric code, cryptographically random (not random.randint,
    which is predictable and unsuitable for anything security-relevant)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _send_email_sync(to_email: str, code: str) -> None:
    """Blocking SMTP send — always call via asyncio.to_thread(), never
    directly from an async route."""
    msg = MIMEText(
        f"Your iPeek verification code is: {code}\n\n"
        f"This code expires in {OTP_EXPIRE_MINUTES} minutes. "
        f"If you didn't request this, you can ignore this email."
    )
    msg["Subject"] = "iPeek — Your verification code"
    msg["From"] = SMTP_USERNAME
    msg["To"] = to_email

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(msg)


class OTPService:

    async def request_otp(self, email: str, db: AsyncSession) -> None:
        # Normalized here too (not just at the schema layer) so this
        # method is safe to call from anywhere, not only via the route.
        email = email.strip().lower()

        # Validated FIRST — never send an OTP to a non-institutional
        # address, and fail fast with a clear message instead of
        # silently "succeeding" for an address that could never register.
        determine_role_from_email(email)

        code = _generate_code()

        # Invalidate any previous unverified OTPs for this email so only
        # the newest code is valid.
        result = await db.execute(
            select(OTPVerification).where(
                OTPVerification.email == email,
                OTPVerification.verified == False,  # noqa: E712
            )
        )
        for old in result.scalars().all():
            await db.delete(old)

        record = OTPVerification(
            email=email,
            code_hash=_hash_code(code),
            expires_at=datetime.utcnow() + timedelta(minutes=OTP_EXPIRE_MINUTES),
        )
        db.add(record)
        await db.commit()

        try:
            await asyncio.to_thread(_send_email_sync, email, code)
        except Exception as e:
            logger.error(f"Failed to send OTP email to {email}: {e}")
            raise ValueError("Could not send verification email. Please try again.")

    async def verify_otp(self, email: str, code: str, db: AsyncSession) -> bool:
        email = email.strip().lower()

        result = await db.execute(
            select(OTPVerification)
            .where(OTPVerification.email == email, OTPVerification.verified == False)  # noqa: E712
            .order_by(OTPVerification.created_at.desc())
        )
        record = result.scalars().first()

        if not record:
            raise ValueError("No pending verification for this email. Please request a new code.")

        if datetime.utcnow() > record.expires_at:
            raise ValueError("This code has expired. Please request a new one.")

        if record.attempts >= OTP_MAX_ATTEMPTS:
            raise ValueError("Too many incorrect attempts. Please request a new code.")

        if _hash_code(code) != record.code_hash:
            record.attempts += 1
            await db.commit()
            raise ValueError("Incorrect code.")

        record.verified = True
        await db.commit()
        return True

    async def is_email_verified(self, email: str, db: AsyncSession) -> bool:
        """Called by /auth/register to confirm this email completed OTP
        verification before an account is created."""
        email = email.strip().lower()

        result = await db.execute(
            select(OTPVerification)
            .where(OTPVerification.email == email, OTPVerification.verified == True)  # noqa: E712
            .order_by(OTPVerification.created_at.desc())
        )
        record = result.scalars().first()
        # Verified OTPs are only valid to redeem for a short window after
        # verification — reuse the same expiry so a verified-but-old
        # record can't be used to register weeks later.
        if not record:
            return False
        return datetime.utcnow() <= record.expires_at + timedelta(minutes=OTP_EXPIRE_MINUTES)


otp_service = OTPService()