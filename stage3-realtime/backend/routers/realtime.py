from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import RealtimeSession
from services.openai_realtime import get_ephemeral_key

router = APIRouter(prefix="/api", tags=["realtime"])

AI_TEACHER_PROMPT_TEMPLATE = """[역할]
당신은 {student_name} 학생의 복습을 도와주는 친근한 AI 선생님입니다.
오늘 {student_name} 학생이 {subject}에 대해 배운 내용을 복습합니다.
반드시 한국어로 대화합니다.

[대화 시작]
먼저 학생에게 인사하고, 오늘 {subject}에서 어떤 내용을 배웠는지 물어봐주세요.

[대화 원칙]
- 학생이 먼저 말하도록 유도한다
- 정답을 바로 알려주지 않고 질문으로 생각을 유도한다
- 틀려도 부드럽게 다시 생각해볼 기회를 준다
- 초등~고등 학생 수준에 맞는 언어를 사용한다
- 한 번에 한 가지 질문만 한다
- 응답은 짧고 자연스럽게 한다 (2~3문장 이내)

[세션 종료]
학생이 끝내자고 하면, 오늘 복습한 내용을 짧게 요약해서 전달한다."""


class TokenRequest(BaseModel):
    session_id: int


class TokenResponse(BaseModel):
    client_secret: str
    expires_at: Optional[int] = None


@router.post("/session/token", response_model=TokenResponse)
async def create_session_token(
    req: TokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """세션에 대한 OpenAI Realtime API 임시 키를 발급합니다."""
    result = await db.execute(
        select(RealtimeSession).where(RealtimeSession.id == req.session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.status != "active":
        raise HTTPException(status_code=400, detail="활성 상태의 세션이 아닙니다")

    instructions = AI_TEACHER_PROMPT_TEMPLATE.format(
        student_name=session.student_name,
        subject=session.subject,
    )

    data = await get_ephemeral_key(instructions)

    return TokenResponse(
        client_secret=data["client_secret"]["value"],
        expires_at=data["client_secret"].get("expires_at"),
    )
