from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import PENDING_DIR, PUBLIC_DIR
from database import get_db
from dependencies import require_role
from models import DeletionLog, Feedback, Research, RoleEnum, StatusEnum, User
from schemas import DashboardStats, ResearchOut, UserOut, ValidateResearch
from services.vectorstore import vectorstore_service

router = APIRouter(prefix="/admin", tags=["Admin (Librarian only)"])


@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard(
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    total = await db.scalar(select(func.count()).select_from(Research))
    approved = await db.scalar(select(func.count()).where(Research.status == StatusEnum.approved))
    pending = await db.scalar(select(func.count()).where(Research.status == StatusEnum.pending))
    returned = await db.scalar(select(func.count()).where(Research.status == StatusEnum.returned))

    return DashboardStats(
        total_research=total or 0,
        approved_research=approved or 0,
        ongoing_research=pending or 0,
        rejected_research=returned or 0,
    )


@router.get("/repository/pending", response_model=List[ResearchOut])
async def list_pending_research(
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).where(Research.status == StatusEnum.pending))
    return result.scalars().all()


@router.get("/repository", response_model=List[ResearchOut])
async def manage_repository(
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).order_by(Research.created_at.desc()))
    return result.scalars().all()


@router.post("/repository/{research_id}/validate", response_model=ResearchOut)
async def validate_research(
    research_id: int,
    payload: ValidateResearch,
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    """
    Librarian-only (NOT admin) — matches the deliberate access decision
    from the original Flask system: approve/return is librarian-specific,
    distinct from admin's broader account/repository management.
    """
    result = await db.execute(select(Research).where(Research.id == research_id))
    research = result.scalar_one_or_none()
    if not research:
        raise HTTPException(status_code=404, detail="Research not found")

    research.status = StatusEnum.approved if payload.approve else StatusEnum.returned
    research.reviewed_by = current_user.id

    if payload.feedback_message:
        research.feedback_note = payload.feedback_message
        db.add(Feedback(
            research_id=research.id,
            librarian_id=current_user.id,
            message=payload.feedback_message,
        ))

    if payload.approve:
        src = PENDING_DIR / f"{research.source_stem}.pdf"
        dest = PUBLIC_DIR / f"{research.source_stem}.pdf"
        if src.exists():
            import shutil
            shutil.copy(str(src), str(dest))

    await db.commit()
    await db.refresh(research)
    return research


@router.delete("/repository/{research_id}")
async def remove_research(
    research_id: int,
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    """Librarian-only, matching the original system's delete restriction."""
    result = await db.execute(select(Research).where(Research.id == research_id))
    research = result.scalar_one_or_none()
    if not research:
        raise HTTPException(status_code=404, detail="Research not found")

    db.add(DeletionLog(
        source_stem=research.source_stem,
        title=research.title,
        deleted_by=current_user.id,
    ))
    from services.rag import rag_service
    await rag_service.clear_cache_for(research.id, db)   # or research_id inside the bulk loop
    await vectorstore_service.delete_by_source(research.source_stem)

    for folder in (PENDING_DIR, PUBLIC_DIR):
        path = folder / f"{research.source_stem}.pdf"
        path.unlink(missing_ok=True)

    await db.delete(research)
    await db.commit()
    return {"detail": "Research removed"}


@router.post("/repository/bulk-delete")
async def bulk_delete_research(
    research_ids: List[int],
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    """Bulk delete — same guarantees as single delete, applied to each id."""
    deleted, failed = [], []
    for rid in research_ids:
        result = await db.execute(select(Research).where(Research.id == rid))
        research = result.scalar_one_or_none()
        if not research:
            failed.append(rid)
            continue

        db.add(DeletionLog(
            source_stem=research.source_stem,
            title=research.title,
            deleted_by=current_user.id,
        ))
        from services.rag import rag_service
        await rag_service.clear_cache_for(research.id, db)   # or research_id inside the bulk loop
        await vectorstore_service.delete_by_source(research.source_stem)
        for folder in (PENDING_DIR, PUBLIC_DIR):
            (folder / f"{research.source_stem}.pdf").unlink(missing_ok=True)
        await db.delete(research)
        deleted.append(rid)

    await db.commit()
    return {"deleted": deleted, "failed": failed}


@router.get("/users", response_model=List[UserOut])
async def manage_users(
    current_user: User = Depends(require_role("librarian")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.role == RoleEnum.student))
    return result.scalars().all()