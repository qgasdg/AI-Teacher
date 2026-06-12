"""온택트 교실 — LiveKit 기반 화상 수업 + 세션 관리 + 보고서 생성."""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Header, HTTPException,
    Query, UploadFile,
)
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import verify_secret
from database import AsyncSessionLocal, get_db
from models import OntactClassroom, OntactChatMessage, OntactStudentSession
from services.audio import webm_to_wav_chunks
from services.livekit_service import (
    make_token, delete_classroom_rooms, list_private_students, LIVEKIT_URL,
)
from services.ontact_reporter import generate_ontact_report

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ontact", tags=["ontact"])
PROTECTED = [Depends(verify_secret)]


# ── Pydantic 모델 ──────────────────────────────────────────────

class ClassroomCreate(BaseModel):
    title: Optional[str] = None


class ClassroomResponse(BaseModel):
    id: int
    title: Optional[str]
    status: str
    created_at: str


class StudentSessionResponse(BaseModel):
    id: int
    classroom_id: int
    student_name: str
    joined_at: str
    left_at: Optional[str]
    transcript: Optional[str]
    report: Optional[dict]
    report_final: Optional[dict]
    status: str


class ReportFinalUpdate(BaseModel):
    report_final: dict


class ChatMessageCreate(BaseModel):
    sender: str
    to_student: Optional[str] = None
    content: Optional[str] = None
    student_session_id: Optional[int] = None


# ── REST 엔드포인트 ────────────────────────────────────────────

@router.post("/classrooms", response_model=ClassroomResponse, dependencies=PROTECTED)
async def create_classroom(body: ClassroomCreate, db: AsyncSession = Depends(get_db)):
    """선생님 입장. 교실은 항상 1개만 열려 있도록 보장한다.

    - 이미 열린 교실이 있으면 가장 최근 것을 재사용하고 나머지는 모두 닫는다.
      (학생이 먼저 입장한 경우에도 같은 방으로 수렴 + 방치된 옛 교실 정리)
    - 없으면 새로 생성한다.
    """
    result = await db.execute(
        select(OntactClassroom)
        .where(OntactClassroom.status == "open")
        .order_by(OntactClassroom.created_at.desc())
    )
    open_rooms = result.scalars().all()

    if open_rooms:
        classroom = open_rooms[0]  # 가장 최근 = 학생이 current로 들어오는 방
        stale_ids = []
        for stale in open_rooms[1:]:
            stale.status = "closed"
            stale.closed_at = datetime.utcnow()
            stale_ids.append(stale.id)
        await db.commit()
        await db.refresh(classroom)
        for sid in stale_ids:
            await delete_classroom_rooms(sid)
        return _classroom_to_resp(classroom)

    classroom = OntactClassroom(title=body.title, status="open")
    db.add(classroom)
    await db.commit()
    await db.refresh(classroom)
    return _classroom_to_resp(classroom)


@router.post("/classrooms/ensure-open", response_model=ClassroomResponse, dependencies=PROTECTED)
async def ensure_open_classroom(db: AsyncSession = Depends(get_db)):
    """학생 입장용. 열린 교실이 있으면 가장 최근 것을 반환, 없으면 새로 생성.

    학생이 선생님보다 먼저 입장할 수 있게 한다. 다른 교실을 닫지는 않는다
    (교실 정리는 선생님 입장 시에만 — 최소 권한).
    """
    result = await db.execute(
        select(OntactClassroom)
        .where(OntactClassroom.status == "open")
        .order_by(OntactClassroom.created_at.desc())
        .limit(1)
    )
    classroom = result.scalars().first()
    if classroom:
        return _classroom_to_resp(classroom)

    classroom = OntactClassroom(title=None, status="open")
    db.add(classroom)
    await db.commit()
    await db.refresh(classroom)
    return _classroom_to_resp(classroom)


@router.get("/classrooms/current", response_model=ClassroomResponse, dependencies=PROTECTED)
async def get_current_classroom(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(OntactClassroom)
        .where(OntactClassroom.status == "open")
        .order_by(OntactClassroom.created_at.desc())
        .limit(1)
    )
    classroom = result.scalars().first()
    if not classroom:
        raise HTTPException(status_code=404, detail="현재 열린 교실이 없습니다.")
    return _classroom_to_resp(classroom)


@router.get("/classrooms/{classroom_id}", response_model=ClassroomResponse, dependencies=PROTECTED)
async def get_classroom(classroom_id: int, db: AsyncSession = Depends(get_db)):
    classroom = await _get_classroom_or_404(classroom_id, db)
    return _classroom_to_resp(classroom)


@router.get("/classrooms/{classroom_id}/private-rooms", dependencies=PROTECTED)
async def get_private_rooms(classroom_id: int):
    """개인실에 있는 학생 이름 목록 — LiveKit 서버 기준 실시간 조회."""
    return {"students": await list_private_students(classroom_id)}


@router.post("/classrooms/{classroom_id}/close", dependencies=PROTECTED)
async def close_classroom(
    classroom_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    classroom = await _get_classroom_or_404(classroom_id, db)
    classroom.status = "closed"
    classroom.closed_at = datetime.utcnow()
    await db.commit()
    # LiveKit 방(강의실+개인실) 강제 종료 — 남은 학생이 유령 방에 갇히지 않도록
    await delete_classroom_rooms(classroom_id)
    # 안전망: 살아있는 학생 탭은 Disconnected로 스스로 종료(processing)하지만,
    # 탭이 죽어 있으면 세션이 active로 영원히 남는다 → 유예 후 남은 active를 종료 처리.
    background_tasks.add_task(_abandon_stale_sessions, classroom_id)
    return {"ok": True}


async def _abandon_stale_sessions(classroom_id: int, grace_seconds: int = 20):
    """교실 닫힌 뒤 유예 시간 후에도 active로 남은 학생 세션을 abandoned 처리.

    살아있는 클라이언트는 유예 안에 complete를 호출해 processing으로 넘어가므로
    보고서 생성 경로를 방해하지 않는다.
    """
    import asyncio
    await asyncio.sleep(grace_seconds)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(OntactStudentSession)
            .where(OntactStudentSession.classroom_id == classroom_id)
            .where(OntactStudentSession.status == "active")
        )
        for s in result.scalars().all():
            s.status = "abandoned"
            s.left_at = s.left_at or datetime.utcnow()
        await db.commit()


@router.get(
    "/classrooms/{classroom_id}/sessions",
    response_model=list[StudentSessionResponse],
    dependencies=PROTECTED,
)
async def list_sessions(classroom_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(OntactStudentSession)
        .where(OntactStudentSession.classroom_id == classroom_id)
        .order_by(OntactStudentSession.joined_at.desc())
    )
    return [_session_to_resp(s) for s in result.scalars().all()]


@router.get("/student-sessions/{session_id}", response_model=StudentSessionResponse, dependencies=PROTECTED)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    session = await _get_session_or_404(session_id, db)
    return _session_to_resp(session)


@router.patch("/student-sessions/{session_id}", dependencies=PROTECTED)
async def save_final_report(
    session_id: int,
    body: ReportFinalUpdate,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session_or_404(session_id, db)
    session.report_final = body.report_final
    session.report_saved_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/classrooms/{classroom_id}/chat", dependencies=PROTECTED)
async def save_chat_message(
    classroom_id: int,
    body: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
):
    """채팅 메시지 DB 저장 (이미지 제외, 텍스트만)."""
    msg = OntactChatMessage(
        classroom_id=classroom_id,
        student_session_id=body.student_session_id,
        sender=body.sender,
        to_student=body.to_student,
        content=body.content,
    )
    db.add(msg)
    await db.commit()
    return {"ok": True}


@router.get("/token", dependencies=PROTECTED)
async def get_livekit_token(
    classroom_id: int = Query(...),
    name: str = Query(...),
    room_type: str = Query("group"),   # "group" | "private"
    target: Optional[str] = Query(None),  # 선생님이 개인실 진입 시 학생 이름
    want: str = Query("teacher"),  # 클라이언트가 원하는 역할 "teacher" | "student"
    x_verified_role: Optional[str] = Header(None),  # 프록시가 주입한 검증된 역할
    db: AsyncSession = Depends(get_db),
):
    """LiveKit 입장 토큰 발급.
    - room_type=group  → 강의실 (ontact-{id})
    - room_type=private → 개인실 (ontact-{id}-{student})
    학생 첫 입장(group)에만 student_session 행 생성.

    권한은 "클라이언트가 원하는 역할(want)을 검증된 권한(헤더) 이하로만 허용"한다.
    - 권한 상승 차단: 학생(access)이 want=teacher 요청해도 student로 강등.
    - 다운그레이드 허용: 선생님 쿠키가 있는 브라우저의 학생 탭이 want=student를
      요청하면 student 신원 발급(같은 브라우저 쿠키 공유로 인한 신원 충돌 방지).
    """
    if not LIVEKIT_URL:
        raise HTTPException(status_code=503, detail="LiveKit가 설정되지 않았습니다.")

    is_teacher = (x_verified_role == "teacher") and (want != "student")

    classroom = await _get_classroom_or_404(classroom_id, db)
    if classroom.status != "open":
        raise HTTPException(status_code=400, detail="이미 닫힌 교실입니다.")

    # 개인실 대상 학생 결정 — 선생님만 target(타 학생)을 지정할 수 있다.
    private_student: Optional[str] = None
    if room_type == "private":
        private_student = target if is_teacher else name

    session_id: Optional[int] = None
    if not is_teacher and room_type == "group":
        # 이미 active 세션이 있으면 재사용 (재입장·개인실↔강의실 전환 시 중복 생성 방지)
        existing = await db.execute(
            select(OntactStudentSession)
            .where(OntactStudentSession.classroom_id == classroom_id)
            .where(OntactStudentSession.student_name == name)
            .where(OntactStudentSession.status == "active")
            .order_by(OntactStudentSession.joined_at.desc())
            .limit(1)
        )
        student_session = existing.scalar_one_or_none()
        if student_session is None:
            student_session = OntactStudentSession(
                classroom_id=classroom_id,
                student_name=name,
                status="active",
            )
            db.add(student_session)
            await db.commit()
            await db.refresh(student_session)
        session_id = student_session.id

    token = make_token(
        classroom_id=classroom_id,
        identity="teacher" if is_teacher else name,
        display_name="선생님" if is_teacher else name,
        is_teacher=is_teacher,
        private_student=private_student,
    )

    resp: dict = {"token": token, "livekit_url": LIVEKIT_URL}
    if session_id is not None:
        resp["session_id"] = session_id
    return resp


@router.post("/student-sessions/{session_id}/complete", dependencies=PROTECTED)
async def complete_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """학생 퇴장 후 오디오 업로드 → 백그라운드 STT + 보고서."""
    session = await _get_session_or_404(session_id, db)
    if session.status not in ("active",):
        raise HTTPException(status_code=400, detail="이미 처리된 세션입니다.")

    session.left_at = datetime.utcnow()
    session.status = "processing"
    audio_bytes = await audio.read()
    await db.commit()

    background_tasks.add_task(_process_session, session_id, audio_bytes)
    return {"ok": True, "session_id": session_id}


# ── 백그라운드: STT → 보고서 ───────────────────────────────────

async def _process_session(session_id: int, audio_bytes: bytes):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(OntactStudentSession).where(OntactStudentSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            return

        try:
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            wav_chunks = await webm_to_wav_chunks(audio_bytes)
            transcripts: list[str] = []
            for i, chunk_bytes in enumerate(wav_chunks):
                tail = (" 이전: " + transcripts[-1][-200:]) if transcripts else ""
                buf = io.BytesIO(chunk_bytes)
                buf.name = f"chunk-{i:03d}.wav"
                resp = await client.audio.transcriptions.create(
                    model="gpt-4o-transcribe",
                    file=buf,
                    prompt="온택트 줌 과외 수업 녹음. 선생님과 학생 대화." + tail,
                )
                transcripts.append((resp.text or "").strip())

            session.transcript = "\n".join(t for t in transcripts if t)

            from sqlalchemy import or_
            chat_result = await db.execute(
                select(OntactChatMessage)
                .where(OntactChatMessage.classroom_id == session.classroom_id)
                # 학생이 수업에 있던 시간대만
                .where(OntactChatMessage.created_at >= session.joined_at)
                .where(
                    OntactChatMessage.created_at <= session.left_at
                    if session.left_at else True
                )
                # 전체 공지(to_student=None) 또는 해당 학생에게 보낸 메시지만
                .where(
                    or_(
                        OntactChatMessage.to_student == None,
                        OntactChatMessage.to_student == session.student_name,
                    )
                )
                .order_by(OntactChatMessage.created_at)
            )
            chat_context = "\n".join(
                f"[{m.sender}]: {m.content}"
                for m in chat_result.scalars().all()
                if m.content
            )

            report = await generate_ontact_report(
                transcript=session.transcript,
                chat_context=chat_context,
                student_name=session.student_name,
            )
            session.report = report
            session.status = "completed"

        except Exception as e:
            logger.error(f"온택트 세션 처리 실패 (id={session_id}): {e}")
            session.status = "failed"

        await db.commit()


# ── 헬퍼 ──────────────────────────────────────────────────────

async def _get_classroom_or_404(cid: int, db: AsyncSession) -> OntactClassroom:
    result = await db.execute(select(OntactClassroom).where(OntactClassroom.id == cid))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="교실을 찾을 수 없습니다.")
    return obj


async def _get_session_or_404(sid: int, db: AsyncSession) -> OntactStudentSession:
    result = await db.execute(select(OntactStudentSession).where(OntactStudentSession.id == sid))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return obj


def _classroom_to_resp(c: OntactClassroom) -> ClassroomResponse:
    return ClassroomResponse(
        id=c.id, title=c.title, status=c.status,
        created_at=c.created_at.isoformat(),
    )


def _session_to_resp(s: OntactStudentSession) -> StudentSessionResponse:
    return StudentSessionResponse(
        id=s.id,
        classroom_id=s.classroom_id,
        student_name=s.student_name,
        joined_at=s.joined_at.isoformat(),
        left_at=s.left_at.isoformat() if s.left_at else None,
        transcript=s.transcript,
        report=s.report,
        report_final=s.report_final,
        status=s.status,
    )
