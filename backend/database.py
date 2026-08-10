"""
Database configuration.

Uses SQLite through the async 'aiosqlite' driver so the whole system stays
lightweight (single file on disk, no separate DB server to install/run).
Because it's SQLAlchemy's async engine, switching to Postgres/MySQL later
only means changing DATABASE_URL - no query code has to change.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

DATABASE_URL = "sqlite+aiosqlite:///./ipeek.db"

engine = create_async_engine(DATABASE_URL, echo=False, future=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db():
    """FastAPI dependency: yields a request-scoped async DB session."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """Create tables on startup if they don't exist yet."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
