import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Session
from services.stt import transcribe_audio
from services.summarizer import summarize_transcript

router = APIRouter(prefix="/sessions", tags=["sessions"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav",
    "audio/ogg", "audio/m4a", "audio/x-m4a",
}


class SessionResponse(BaseModel):
    id: int
    student_name: str
    teacher_name: str
    subject: str
    status: str
    transcript: str | None
    summary: str | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


async def process_session(session_id: int, audio_path: str, student_name: str, subject: str):
    """백그라운드: STT → 요약 처리"""
    from database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Session).where(Session.id == session_id))
        session = result.scalar_one_or_none()
        if not session:
            return

        try:
            session.status = "processing"
            await db.commit()

            # 1. Whisper STT
            transcript = await transcribe_audio(audio_path)
            session.transcript = transcript

            # 2. Claude 요약
            summary = await summarize_transcript(transcript, student_name, subject)
            session.summary = summary

            session.status = "completed"
            session.completed_at = datetime.utcnow()

        except Exception as e:
            session.status = "failed"
            session.summary = f"처리 중 오류가 발생했습니다: {str(e)}"

        await db.commit()


@router.post("/", response_model=SessionResponse)
async def create_session(
    background_tasks: BackgroundTasks,
    student_name: str = Form(...),
    teacher_name: str = Form(...),
    subject: str = Form(...),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """오디오 업로드 → 세션 생성 → 백그라운드 처리"""
    if audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 오디오 형식입니다: {audio.content_type}",
        )

    # 오디오 파일 저장
    ext = Path(audio.filename or "audio.webm").suffix or ".webm"
    filename = f"{uuid.uuid4()}{ext}"
    audio_path = UPLOAD_DIR / filename

    content = await audio.read()
    with open(audio_path, "wb") as f:
        f.write(content)

    # DB 세션 생성
    session = Session(
        student_name=student_name,
        teacher_name=teacher_name,
        subject=subject,
        audio_path=str(audio_path),
        status="pending",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # 백그라운드 처리 시작
    background_tasks.add_task(
        process_session,
        session.id,
        str(audio_path),
        student_name,
        subject,
    )

    return session


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """세션 상태 및 결과 조회"""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return session


@router.get("/", response_model=list[SessionResponse])
async def list_sessions(
    teacher_name: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """모든 세션 목록 (선생님 이름으로 필터 가능)"""
    query = select(Session).order_by(Session.created_at.desc())
    if teacher_name:
        query = query.where(Session.teacher_name == teacher_name)
    result = await db.execute(query)
    return result.scalars().all()
