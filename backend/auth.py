"""
Password hashing + JWT creation/verification.

The JWT payload carries the user's role ("sub" = user id, "role" = student
or librarian). dependencies.py reads that role back out on every request
to decide whether the endpoint is allowed to run.
"""
import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import jwt

# In production, load this from an environment variable / .env file -
# never commit a real secret to source control.
SECRET_KEY = os.environ.get("IPEEK_SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours

# NOTE: uses bcrypt directly, NOT passlib. passlib==1.7.4's internal
# self-test is incompatible with bcrypt>=4.x's stricter 72-byte handling
# and crashes on every hash attempt. Confirmed via live testing - do not
# reintroduce passlib. See README.md section 2 & 8.


def hash_password(password: str) -> str:
    pw_bytes = password.encode("utf-8")[:72]  # bcrypt's hard input limit
    hashed = bcrypt.hashpw(pw_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    pw_bytes = plain_password.encode("utf-8")[:72]
    return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
