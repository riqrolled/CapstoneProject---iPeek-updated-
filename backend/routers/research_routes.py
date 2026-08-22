from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import MAX_UPLOAD_SIZE
from database import get_db
from dependencies import require_role
from models import Feedback, Research, StatusEnum, User
from schemas import FeedbackOut, ResearchOut, UploadConfirmIn, UploadPreviewOut
from services.ingestor import ingestor
from fastapi.responses import FileResponse
from config import PUBLIC_DIR
router = APIRouter(prefix="/repository", tags=["Repository"])

@router.get("/{source_stem}/pdf")
async def get_pdf(
    source_stem: str,
    current_user: User = Depends(require_role("student", "librarian")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).where(Research.source_stem == source_stem))
    research = result.scalar_one_or_none()
    if not research or research.status != StatusEnum.approved:
        raise HTTPException(status_code=404, detail="Document not available for viewing.")

    path = PUBLIC_DIR / f"{source_stem}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Document not available for viewing.")
    return FileResponse(str(path), media_type="application/pdf")

@router.post("/upload/preview", response_model=UploadPreviewOut)
async def upload_preview(
    file: UploadFile = File(...),
    title: str = Form(""),
    department: str = Form(""),
    year: str = Form(""),
    members: str = Form(""),
    abstract: str = Form(""),
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await ingestor.preview_upload(
            file, {"title": title, "department": department, "year": year, "members": members, "abstract": abstract}, db,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/upload/confirm")
async def upload_confirm(
    payload: UploadConfirmIn,
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await ingestor.confirm_upload(payload.preview_id, payload.final_values, current_user.id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/browse", response_model=List[ResearchOut])
async def browse_repository(
    current_user: User = Depends(require_role("student", "librarian", "admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).where(Research.status == StatusEnum.approved))
    return result.scalars().all()


@router.get("/search", response_model=List[ResearchOut])
async def search_research(
    q: Optional[str] = None,
    current_user: User = Depends(require_role("student", "librarian")),
    db: AsyncSession = Depends(get_db),
):
    query = select(Research).where(Research.status == StatusEnum.approved)
    if q:
        query = query.where(or_(Research.title.ilike(f"%{q}%"), Research.authors.ilike(f"%{q}%")))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{source_stem}/detail", response_model=ResearchOut)
async def get_research_detail(
    source_stem: str,
    current_user: User = Depends(require_role("student", "librarian")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).where(Research.source_stem == source_stem))
    research = result.scalar_one_or_none()
    if not research:
        raise HTTPException(status_code=404, detail="Research not found")
    return research


@router.get("/my-uploads", response_model=List[ResearchOut])
async def my_uploads(
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Research).where(Research.student_id == current_user.id))
    return result.scalars().all()


@router.get("/{research_id}/feedback", response_model=List[FeedbackOut])
async def check_feedback(
    research_id: int,
    current_user: User = Depends(require_role("student")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Research).where(Research.id == research_id, Research.student_id == current_user.id)
    )
    research = result.scalar_one_or_none()
    if not research:
        raise HTTPException(status_code=404, detail="Research not found")

    fb_result = await db.execute(select(Feedback).where(Feedback.research_id == research_id))
    return fb_result.scalars().all()