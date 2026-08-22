"""
seed_test_users.py
-------------------
Creates test accounts DIRECTLY in the database — completely bypasses
the OTP/registration HTTP endpoints. For local testing only, when you
don't yet have access to a real @isatu.edu.ph inbox to receive an OTP
and test the librarian/faculty registration path end-to-end.

SAFE BY DESIGN: this is a standalone script, not an API route. It's
never reachable over the network, so it can't be exploited the way a
"skip OTP" flag baked into the app itself could be if accidentally
left enabled in production. Just don't commit real production data
into it, and don't run it against a live/deployed database.

Run once from the backend folder (venv activated):
    python seed_test_users.py

Safe to re-run — skips any username that already exists.
"""
import asyncio

from sqlalchemy import select

from auth import hash_password
from database import AsyncSessionLocal, init_db
from models import RoleEnum, User

TEST_USERS = [
    {
        "username": "test_librarian",
        "email": "test_librarian@isatu.edu.ph",  # fake — never emailed, DB only
        "password": "testpass123",
        "fullname": "Test Librarian",
        "role": RoleEnum.librarian,
        "department": None,
    },
    {
        "username": "test_faculty",
        "email": "test_faculty@isatu.edu.ph",
        "password": "testpass123",
        "fullname": "Test Faculty",
        "role": RoleEnum.faculty,
        "department": None,
    },
    {
        "username": "test_student",
        "email": "test_student@students.isatu.edu.ph",
        "password": "testpass123",
        "fullname": "Test Student",
        "role": RoleEnum.student,
        "department": "College of Computing and Informatics",
    },
]


async def seed():
    await init_db()
    async with AsyncSessionLocal() as db:
        for u in TEST_USERS:
            result = await db.execute(select(User).where(User.username == u["username"]))
            if result.scalar_one_or_none():
                print(f"Skipping {u['username']} — already exists.")
                continue

            user = User(
                username=u["username"],
                email=u["email"],
                password_hash=hash_password(u["password"]),
                fullname=u["fullname"],
                role=u["role"],
                department=u["department"],
            )
            db.add(user)
            print(f"Created {u['role'].value}: {u['username']} / {u['password']}")

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
    print("\nDone. Log in via /auth/login with any of the accounts above.")