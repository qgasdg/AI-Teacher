"""수업 일지 API — 과외 수업 녹음 → STT → 보고서 자동 생성."""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import Response
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import verify_secret
from database import get_db, AsyncSessionLocal
from models import Lesson
from services.audio import webm_to_wav_chunks
from services.lesson_reporter import generate_lesson_report

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/lessons",
    tags=["lessons"],
    dependencies=[Depends(verify_secret)],
)


# --- Response Model ---

class LessonResponse(BaseModel):
    id: int
    student_name: str
    subject: str
    transcript: Optional[str]
    homework: Optional[str]
    progress: Optional[str]
    lesson_content: Optional[str]
    status: str
    created_at: str
    duration_seconds: Optional[int]

    class Config:
        from_attributes = True


def _to_response(l: Lesson) -> LessonResponse:
    return LessonResponse(
        id=l.id,
        student_name=l.student_name,
        subject=l.subject,
        transcript=l.transcript,
        homework=l.homework,
        progress=l.progress,
        lesson_content=l.lesson_content,
        status=l.status,
        created_at=l.created_at.isoformat(),
        duration_seconds=l.duration_seconds,
    )


# --- Background Task ---

async def process_lesson(lesson_id: int, audio_bytes: bytes, subject: str, student_name: str) -> None:
    """백그라운드: STT(청크 분할) → 보고서 3개 항목 생성."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
        lesson = result.scalar_one_or_none()
        if not lesson:
            return

        try:
            lesson.status = "processing"
            await db.commit()

            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            # 1) webm → 16kHz mono WAV 청크 분할 (ffmpeg)
            wav_chunks = await webm_to_wav_chunks(audio_bytes)

            transcripts: list[str] = []
            for i, chunk_bytes in enumerate(wav_chunks):
                tail = (" 이전 내용: " + transcripts[-1][-200:]) if transcripts else ""
                buf = io.BytesIO(chunk_bytes)
                buf.name = f"chunk-{i:03d}.wav"
                resp = await client.audio.transcriptions.create(
                    model="gpt-4o-transcribe",
                    file=buf,
                    prompt=(
                        f"과외 수업 녹음입니다. 선생님과 학생의 대화. 과목: {subject}." + tail
                    ),
                )
                transcripts.append((resp.text or "").strip())

            lesson.transcript = "\n".join(t for t in transcripts if t)

            # 2) 보고서 3개 항목 생성
            report = await generate_lesson_report(
                transcript=lesson.transcript,
                student_name=student_name,
                subject=subject,
            )
            lesson.homework = report["homework"]
            lesson.progress = report["progress"]
            lesson.lesson_content = report["lesson_content"]
            lesson.status = "completed"

        except Exception as e:
            logger.error(f"수업 일지 처리 실패 (id={lesson_id}): {e}")
            lesson.status = "failed"
            lesson.transcript = f"처리 실패: {e}"

        await db.commit()


# --- Endpoints ---

@router.post("/", response_model=LessonResponse)
async def create_lesson(
    background_tasks: BackgroundTasks,
    student_name: str = Form(...),
    subject: str = Form(...),
    duration_seconds: Optional[int] = Form(None),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """수업 녹음 업로드 → 백그라운드 STT + 보고서 생성."""
    if not student_name.strip() or not subject.strip():
        raise HTTPException(status_code=400, detail="학생 이름과 과목을 입력해주세요.")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="오디오 파일이 비어있습니다.")

    lesson = Lesson(
        student_name=student_name.strip(),
        subject=subject.strip(),
        status="pending",
        duration_seconds=duration_seconds,
    )
    db.add(lesson)
    await db.commit()
    await db.refresh(lesson)

    background_tasks.add_task(process_lesson, lesson.id, audio_bytes, subject, student_name)
    return _to_response(lesson)


@router.get("/", response_model=List[LessonResponse])
async def list_lessons(db: AsyncSession = Depends(get_db)):
    """수업 일지 목록 조회 (최신순)."""
    result = await db.execute(select(Lesson).order_by(Lesson.created_at.desc()))
    return [_to_response(l) for l in result.scalars().all()]


@router.get("/{lesson_id}", response_model=LessonResponse)
async def get_lesson(lesson_id: int, db: AsyncSession = Depends(get_db)):
    """특정 수업 일지 조회."""
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="수업 일지를 찾을 수 없습니다.")
    return _to_response(lesson)


@router.delete("/{lesson_id}", status_code=204)
async def delete_lesson(lesson_id: int, db: AsyncSession = Depends(get_db)):
    """수업 일지 삭제."""
    result = await db.execute(select(Lesson).where(Lesson.id == lesson_id))
    lesson = result.scalar_one_or_none()
    if not lesson:
        raise HTTPException(status_code=404, detail="수업 일지를 찾을 수 없습니다.")
    await db.delete(lesson)
    await db.commit()
    return Response(status_code=204)
