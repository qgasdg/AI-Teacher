from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Form
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import verify_secret
from database import get_db, AsyncSessionLocal
from models import RealtimeSession
from services.summarizer import summarize_conversation
from services.supabase_client import find_student
from services.kakao import send_kakao

router = APIRouter(prefix="/sessions", tags=["sessions"])

# 모든 sessions 엔드포인트에 적용할 인증 의존성.
# (abandon은 sendBeacon 호환을 위해 의도적으로 제외 — 별도 데코레이터에서 미적용)
PROTECTED = [Depends(verify_secret)]

# 학생이 종료 버튼 안 누르고 떠난 세션 자동 정리 임계치
ABANDON_AFTER_HOURS = 2


async def _mark_abandoned_sessions(db: AsyncSession) -> None:
    """`active`로 ABANDON_AFTER_HOURS 시간 넘긴 세션을 `abandoned`로 일괄 변경."""
    cutoff = datetime.utcnow() - timedelta(hours=ABANDON_AFTER_HOURS)
    await db.execute(
        update(RealtimeSession)
        .where(RealtimeSession.status == "active")
        .where(RealtimeSession.created_at < cutoff)
        .values(status="abandoned", ended_at=datetime.utcnow())
    )
    await db.commit()


# --- Request / Response Models ---


class SessionCreate(BaseModel):
    student_name: str
    subject: str


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


# --- Kakao Helper ---

import logging
logger = logging.getLogger(__name__)

async def _send_session_kakao(session: RealtimeSession) -> None:
    """실시간 대화 요약 완료 후 학생에게 카카오 발송."""
    # 이름에서 순수 이름만 추출 (예: "홍길동 (고2)" → "홍길동", grade → "고2")
    raw = session.student_name or ""
    if " (" in raw and raw.endswith(")"):
        name, grade = raw[:-1].split(" (", 1)
    else:
        name, grade = raw, None

    # '기타' 선택 시 grade 필터 없이 이름만으로 조회
    if grade == "기타":
        grade = None

    student = await find_student(name, grade)
    if not student:
        return

    phone = student.get("phone") or ""
    if not phone:
        logger.warning(f"카카오 스킵: '{name}' 전화번호 없음")
        return

    message = (
        f"[AI 튜터] 복습 완료\n"
        f"학생: {name}\n"
        f"과목: {session.subject}\n\n"
        f"{session.summary}"
    )
    await send_kakao(phone, message)


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

        # 카카오 발송 (요약 완료 후)
        if session.status == "completed":
            await _send_session_kakao(session)


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


@router.post("/", response_model=SessionResponse, dependencies=PROTECTED)
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


@router.post("/{session_id}/end", response_model=SessionResponse, dependencies=PROTECTED)
async def end_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    transcript: str = Form(...),
    duration_seconds: Optional[int] = Form(None),
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

    session.transcript = transcript
    session.duration_seconds = duration_seconds
    session.ended_at = datetime.utcnow()
    session.status = "ending"
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(generate_summary, session_id)

    return _to_response(session)


@router.get("/{session_id}", response_model=SessionResponse, dependencies=PROTECTED)
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


@router.get("/", response_model=List[SessionResponse], dependencies=PROTECTED)
async def list_sessions(db: AsyncSession = Depends(get_db)):
    """모든 세션 목록을 조회합니다. (호출 시점에 stale active 세션을 abandoned로 정리)"""
    await _mark_abandoned_sessions(db)
    result = await db.execute(
        select(RealtimeSession).order_by(RealtimeSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [_to_response(s) for s in sessions]


@router.post("/{session_id}/abandon", status_code=204, dependencies=PROTECTED)
async def abandon_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """학생이 탭 닫고 떠날 때 best-effort로 호출 (sendBeacon, 프록시 경유로 인증).

    오디오/transcript는 브라우저에 있다 사라지므로 복구 불가 — status만 abandoned로 마킹.
    """
    result = await db.execute(
        select(RealtimeSession).where(RealtimeSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        return Response(status_code=204)
    if session.status == "active":
        session.status = "abandoned"
        session.ended_at = datetime.utcnow()
        await db.commit()
    return Response(status_code=204)


@router.delete("/{session_id}", status_code=204, dependencies=PROTECTED)
async def delete_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """세션 삭제"""
    result = await db.execute(
        select(RealtimeSession).where(RealtimeSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    await db.delete(session)
    await db.commit()
    return Response(status_code=204)
