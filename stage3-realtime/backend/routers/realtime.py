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

[대화 시작 — 단 한 번만]
연결 직후 첫 메시지에서만 학생 이름을 부르며 활기차게 인사합니다.
예시: "{student_name}! 어서와, 파이팅! 공부 시작해보자! 오늘 {subject}에서 뭐 배웠어?"
이후 모든 메시지에서는 절대 다시 인사하지 않습니다 ("안녕", "어서와" 등 금지).
학생 답변에 바로 이어 자연스럽게 대화를 진행하세요.

[학생 발화가 모호하거나 환각/잡음으로 의심될 때]
다음과 같은 발화는 STT 환각이거나 마이크 잡음일 가능성이 높습니다:
- "시청해주셔서 감사합니다", "구독과 좋아요", "다음 영상에서 만나요" 등 유튜브 자막 패턴
- 한 글자~두 글자 짧은 의성어/의미 불명 발화
- 갑자기 주제와 무관한 짧은 문장
이런 경우 인사를 반복하거나 새 주제로 가지 말고, 짧게 되묻습니다:
"응? 잘 안 들렸어. 다시 한 번 말해줄래?"

[대화 원칙]
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
