from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AsyncSessionLocal
from models import RealtimeSession
from services.summarizer import summarize_conversation

router = APIRouter(prefix="/sessions", tags=["sessions"])


# --- Request / Response Models ---


class SessionCreate(BaseModel):
    student_name: str
    subject: str


class SessionEnd(BaseModel):
    transcript: str
    duration_seconds: Optional[int] = None


class SessionResponse(BaseModel):
    id: int
    student_name: str
    subject: str
    transcript: Optional[str]
    summary: Optional[str]
    status: str
    created_at: str
    ended_at: Optional[str]
    duration_seconds: Optional[int]

    class Config:
        from_attributes = True


# --- Background Task ---


async def generate_summary(session_id: int):
    """백그라운드에서 Claude를 사용하여 대화 요약을 생성합니다."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RealtimeSession).where(RealtimeSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            return

        try:
            summary = await summarize_conversation(
                transcript=session.transcript,
                student_name=session.student_name,
                subject=session.subject,
            )
            session.summary = summary
            session.status = "completed"
        except Exception as e:
            session.summary = f"요약 생성 실패: {str(e)}"
            session.status = "failed"

        await db.commit()


# --- Endpoints ---


def _to_response(s: RealtimeSession) -> SessionResponse:
    return SessionResponse(
        id=s.id,
        student_name=s.student_name,
        subject=s.subject,
        transcript=s.transcript,
        summary=s.summary,
        status=s.status,
        created_at=s.created_at.isoformat(),
        ended_at=s.ended_at.isoformat() if s.ended_at else None,
        duration_seconds=s.duration_seconds,
    )


@router.post("/", response_model=SessionResponse)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
):
    """새 실시간 대화 세션을 생성합니다."""
    session = RealtimeSession(
        student_name=body.student_name,
        subject=body.subject,
        status="active",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _to_response(session)


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: int,
    body: SessionEnd,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """세션을 종료하고 대화 요약을 생성합니다."""
    result = await db.execute(
        select(RealtimeSession).where(RealtimeSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.status != "active":
        raise HTTPException(status_code=400, detail="활성 상태의 세션이 아닙니다")

    session.transcript = body.transcript
    session.duration_seconds = body.duration_seconds
    session.ended_at = datetime.utcnow()
    session.status = "ending"
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(generate_summary, session_id)

    return _to_response(session)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """세션 상태 및 결과를 조회합니다."""
    result = await db.execute(
        select(RealtimeSession).where(RealtimeSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    return _to_response(session)


@router.get("/", response_model=List[SessionResponse])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    """모든 세션 목록을 조회합니다."""
    result = await db.execute(
        select(RealtimeSession).order_by(RealtimeSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [_to_response(s) for s in sessions]
