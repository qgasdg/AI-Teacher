from __future__ import annotations

from datetime import datetime
from typing import Optional, List

import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import verify_secret
from database import get_db, AsyncSessionLocal
from models import Recording
from services.audio import webm_to_wav_chunks
from services.recording_analyzer import analyze_recording
from services.supabase_client import find_student
from services.kakao import send_kakao

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"], dependencies=[Depends(verify_secret)])

ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav",
    "audio/ogg", "audio/m4a", "audio/x-m4a",
}


# --- Response Model ---

class RecordingResponse(BaseModel):
    id: int
    student_name: str
    question_number: str
    transcript: Optional[str]
    feedback: Optional[str]
    status: str
    created_at: str
    completed_at: Optional[str]

    class Config:
        from_attributes = True


def _to_response(r: Recording) -> RecordingResponse:
    return RecordingResponse(
        id=r.id,
        student_name=r.student_name,
        question_number=r.question_number,
        transcript=r.transcript,
        feedback=r.feedback,
        status=r.status,
        created_at=r.created_at.isoformat(),
        completed_at=r.completed_at.isoformat() if r.completed_at else None,
    )


# --- Background Task: Whisper STT ---

async def transcribe_recording(recording_id: int, audio_bytes: bytes):
    """백그라운드에서 STT 실행. audio_bytes는 호출자에서 직접 전달(DB 저장 안 함).

    파이프라인:
      1) ffmpeg로 16kHz mono wav 변환 + 25MB 미만 청크 분할
      2) 각 청크를 gpt-4o-transcribe로 순차 전사
      3) 결과 텍스트 합치고 GPT 피드백 생성
    """
    import io
    import os
    from openai import AsyncOpenAI

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Recording).where(Recording.id == recording_id))
        recording = result.scalar_one_or_none()
        if not recording:
            return

        try:
            recording.status = "processing"
            await db.commit()

            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            wav_chunks = await webm_to_wav_chunks(audio_bytes)

            # 3초 미만 녹음은 환각 방지를 위해 STT 스킵 (16kHz mono: 1초=32000B)
            MIN_DURATION_BYTES = 32_000 * 3
            total_bytes = sum(len(c) for c in wav_chunks)
            if total_bytes < MIN_DURATION_BYTES:
                logger.warning(f"녹음 너무 짧음 ({total_bytes}B < {MIN_DURATION_BYTES}B) — STT 스킵")
                recording.transcript = ""
                recording.feedback = "녹음 시간이 너무 짧아 분석할 수 없습니다. (3초 이상 녹음해주세요)"
                recording.status = "completed"
                recording.completed_at = datetime.utcnow()
                await db.commit()
                return

            transcribe_prompt = (
                "이 녹음은 학생이 오늘 배운 내용을 자신의 말로 설명하는 복습 녹음입니다. "
                "한국어 위주이지만 과목 용어로 영어나 외래어가 섞일 수 있습니다. "
                "들리는 내용만 정확히 받아 적고, 들리지 않으면 빈 문자열을 반환하세요."
            )

            transcripts: list[str] = []
            last_response = None
            for i, chunk_bytes in enumerate(wav_chunks):
                tail_context = ""
                if transcripts:
                    tail_context = " 이전 구간 끝부분: " + transcripts[-1][-200:]

                buf = io.BytesIO(chunk_bytes)
                buf.name = f"chunk-{i:03d}.wav"

                last_response = await client.audio.transcriptions.create(
                    model="gpt-4o-transcribe",
                    file=buf,
                    prompt=transcribe_prompt + tail_context,
                )
                transcripts.append((last_response.text or "").strip())

            recording.transcript = " ".join(t for t in transcripts if t)

            try:
                recording.feedback = await analyze_recording(
                    transcript=last_response.text if last_response else "",
                    question_number=recording.question_number,
                )
            except Exception as analyze_err:
                recording.feedback = f"분석 실패: {str(analyze_err)}"

            recording.status = "completed"
            recording.completed_at = datetime.utcnow()

        except Exception as e:
            recording.status = "failed"
            recording.transcript = f"전사 실패: {str(e)}"

        await db.commit()

        if recording.status == "completed":
            await _send_recording_kakao(recording)


async def _send_recording_kakao(recording) -> None:
    raw = recording.student_name or ""
    if " (" in raw and raw.endswith(")"):
        name, grade = raw[:-1].split(" (", 1)
    else:
        name, grade = raw, None

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
        f"[AI 튜터] 복습 녹음 분석 완료\n"
        f"학생: {name}\n"
        f"주제: {recording.question_number}\n\n"
        f"{recording.feedback or '분석 결과 없음'}"
    )
    await send_kakao(phone, message)


# --- Endpoints ---

@router.post("", response_model=RecordingResponse)
async def create_recording(
    background_tasks: BackgroundTasks,
    student_name: str = Form(...),
    question_number: str = Form(...),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """오디오 업로드 → STT 백그라운드 실행 (오디오는 DB에 저장하지 않음)"""
    if not question_number.strip():
        raise HTTPException(status_code=400, detail="문항 번호가 비어있습니다.")

    if audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 오디오 형식: {audio.content_type}")

    audio_bytes = await audio.read()

    recording = Recording(
        student_name=student_name,
        question_number=question_number,
        status="pending",
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)

    background_tasks.add_task(transcribe_recording, recording.id, audio_bytes)

    return _to_response(recording)


@router.get("", response_model=List[RecordingResponse])
async def list_recordings(db: AsyncSession = Depends(get_db)):
    """모든 복습 녹음 목록"""
    result = await db.execute(
        select(Recording).order_by(Recording.created_at.desc())
    )
    return [_to_response(r) for r in result.scalars().all()]


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(recording_id: int, db: AsyncSession = Depends(get_db)):
    """녹음 상태 및 결과 조회"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    return _to_response(recording)


@router.delete("/{recording_id}", status_code=204)
async def delete_recording(recording_id: int, db: AsyncSession = Depends(get_db)):
    """녹음 삭제"""
    result = await db.execute(
        select(Recording).where(Recording.id == recording_id)
    )
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    await db.delete(recording)
    await db.commit()
    return Response(status_code=204)
