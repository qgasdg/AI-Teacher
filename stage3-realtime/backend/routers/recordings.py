from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AsyncSessionLocal
from models import Recording
from services.recording_analyzer import analyze_recording

router = APIRouter(prefix="/recordings", tags=["recordings"])

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
    """백그라운드에서 Whisper STT로 녹음 전사"""
    import os
    import tempfile
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

            # 임시 파일로 저장 후 Whisper 전송
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                tmp.write(recording.audio_data)
                tmp_path = tmp.name

            with open(tmp_path, "rb") as f:
                # 직독직해는 영어 원문 → 한국어 해석이 혼용되므로
                # language를 고정하지 않고, 영/한 혼용임을 prompt로 힌트 제공
                response = await client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    prompt=(
                        "This is an English reading comprehension exercise (직독직해). "
                        "The student reads English sentences aloud and immediately "
                        "interprets them in Korean. 영어 원문과 한국어 해석이 섞여 있습니다."
                    ),
                )

            import os as _os
            _os.unlink(tmp_path)

            recording.transcript = response.text

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
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    return _to_response(recording)


@router.get("/{recording_id}/audio")
async def get_audio(recording_id: int, db: AsyncSession = Depends(get_db)):
    """녹음 오디오 스트리밍"""
    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="녹음을 찾을 수 없습니다.")
    if not recording.audio_data:
        raise HTTPException(status_code=404, detail="오디오가 없습니다.")
    return Response(
        content=recording.audio_data,
        media_type="audio/webm",
        headers={"Content-Disposition": f"inline; filename=recording-{recording_id}.webm"},
    )


@router.get("/", response_model=List[RecordingResponse])
async def list_recordings(db: AsyncSession = Depends(get_db)):
    """모든 직독직해 녹음 목록"""
    result = await db.execute(select(Recording).order_by(Recording.created_at.desc()))
    return [_to_response(r) for r in result.scalars().all()]
