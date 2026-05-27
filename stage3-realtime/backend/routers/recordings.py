from __future__ import annotations

from datetime import datetime
from typing import Optional, List

import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Form, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import defer
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

# 모든 /recordings 엔드포인트 인증 필요 (예외 없음)
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
    has_audio: bool = False

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
        has_audio=r.audio_data is not None,
    )


# --- Background Task: Whisper STT ---

async def transcribe_recording(recording_id: int):
    """백그라운드에서 STT 실행.

    파이프라인:
      1) DB에서 webm 바이트 로드
      2) ffmpeg로 16kHz mono wav 변환 + 25MB 미만 청크 분할
      3) 각 청크를 gpt-4o-transcribe로 순차 전사
      4) 결과 텍스트 합치고 GPT 피드백 생성
    """
    import io
    import os
    from openai import AsyncOpenAI

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Recording).where(Recording.id == recording_id))
        recording = result.scalar_one_or_none()
        if not recording or not recording.audio_data:
            return

        try:
            recording.status = "processing"
            await db.commit()

            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            # 1+2) webm → wav 청크 분할
            wav_chunks = await webm_to_wav_chunks(recording.audio_data)

            # 너무 짧은 녹음(< 3초)은 환각 방지를 위해 STT 스킵
            # 16kHz mono PCM: 1초 = 16000 samples × 2 bytes = 32,000 bytes
            MIN_DURATION_BYTES = 32_000 * 3  # 3초
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

            # 3) 청크별 전사 (순차 실행 — 청크 간 prompt 컨텍스트 이어가기)
            transcripts: list[str] = []
            for i, chunk_bytes in enumerate(wav_chunks):
                # 이전 청크 마지막 일부를 prompt에 붙여 문맥 연결
                tail_context = ""
                if transcripts:
                    tail_context = " 이전 구간 끝부분: " + transcripts[-1][-200:]

                buf = io.BytesIO(chunk_bytes)
                buf.name = f"chunk-{i:03d}.wav"  # OpenAI SDK가 확장자로 포맷 판단

                response = await client.audio.transcriptions.create(
                    model="gpt-4o-transcribe",
                    file=buf,
                    prompt=transcribe_prompt + tail_context,
                )
                transcripts.append((response.text or "").strip())

            recording.transcript = " ".join(t for t in transcripts if t)

            # GPT 분석: 취약 구간/어려워한 단어 피드백 생성
            try:
                recording.feedback = await analyze_recording(
                    transcript=response.text,
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

        # 카카오 발송 (전사/분석 완료 후)
        if recording.status == "completed":
            await _send_recording_kakao(recording)


async def _send_recording_kakao(recording) -> None:
    """복습 녹음 완료 후 학생에게 카카오 발송."""
    raw = recording.student_name or ""
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
        f"[AI 튜터] 복습 녹음 분석 완료\n"
        f"학생: {name}\n"
        f"주제: {recording.question_number}\n\n"
        f"{recording.feedback or '분석 결과 없음'}"
    )
    await send_kakao(phone, message)


# --- Endpoints ---

@router.post("/", response_model=RecordingResponse)
async def create_recording(
    background_tasks: BackgroundTasks,
    student_name: str = Form(...),
    question_number: str = Form(...),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """오디오 업로드 → 녹음 생성 → 백그라운드 STT"""
    if not question_number.strip():
        raise HTTPException(status_code=400, detail="문항 번호가 비어있습니다.")

    if audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 오디오 형식: {audio.content_type}")

    audio_bytes = await audio.read()

    recording = Recording(
        student_name=student_name,
        question_number=question_number,
        audio_data=audio_bytes,
        status="pending",
    )
    db.add(recording)
    await db.commit()
    await db.refresh(recording)

    background_tasks.add_task(transcribe_recording, recording.id)

    return _to_response(recording)


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(recording_id: int, db: AsyncSession = Depends(get_db)):
    """녹음 상태 및 결과 조회"""
    result = await db.execute(
        select(Recording)
        .where(Recording.id == recording_id)
        .options(defer(Recording.audio_data))
    )
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    return _to_response(recording)


@router.get("/{recording_id}/audio")
async def get_audio(
    recording_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """녹음 오디오 스트리밍 (HTTP Range 요청 지원 — seek 가능)"""
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    if not recording.audio_data:
        raise HTTPException(status_code=404, detail="오디오가 없습니다.")

    audio = recording.audio_data
    size = len(audio)
    range_header = request.headers.get("range") or request.headers.get("Range")

    base_headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f"inline; filename=recording-{recording_id}.webm",
        "Cache-Control": "no-cache",
    }

    if range_header:
        # "bytes=START-END" 파싱 (END는 생략 가능)
        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)

            if start > end or start >= size:
                return Response(
                    status_code=416,
                    headers={**base_headers, "Content-Range": f"bytes */{size}"},
                )

            chunk = audio[start : end + 1]
            return Response(
                content=chunk,
                status_code=206,
                media_type="audio/webm",
                headers={
                    **base_headers,
                    "Content-Range": f"bytes {start}-{end}/{size}",
                    "Content-Length": str(len(chunk)),
                },
            )

    # Range 헤더가 없으면 전체 반환 (+ Accept-Ranges 광고)
    return Response(
        content=audio,
        media_type="audio/webm",
        headers={**base_headers, "Content-Length": str(size)},
    )


@router.get("/", response_model=List[RecordingResponse])
async def list_recordings(db: AsyncSession = Depends(get_db)):
    """모든 복습 녹음 목록"""
    result = await db.execute(
        select(Recording)
        .order_by(Recording.created_at.desc())
        .options(defer(Recording.audio_data))
    )
    return [_to_response(r) for r in result.scalars().all()]


@router.post("/{recording_id}/retry", response_model=RecordingResponse)
async def retry_recording(
    recording_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """저장된 오디오로 재전사 (재업로드 불필요)"""
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    if not recording.audio_data:
        raise HTTPException(status_code=400, detail="원본 오디오가 없어 재전사할 수 없습니다.")

    # 이전 결과 초기화 후 백그라운드 재실행
    recording.transcript = None
    recording.feedback = None
    recording.status = "pending"
    recording.completed_at = None
    await db.commit()
    await db.refresh(recording)

    background_tasks.add_task(transcribe_recording, recording.id)
    return _to_response(recording)


@router.delete("/{recording_id}", status_code=204)
async def delete_recording(recording_id: int, db: AsyncSession = Depends(get_db)):
    """녹음 삭제 (오디오 + 전사 + 피드백)"""
    result = await db.execute(
        select(Recording)
        .where(Recording.id == recording_id)
        .options(defer(Recording.audio_data))
    )
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    await db.delete(recording)
    await db.commit()
    return Response(status_code=204)
