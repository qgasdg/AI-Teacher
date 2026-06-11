import os

from openai import AsyncOpenAI

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client

SUMMARY_SYSTEM_PROMPT = """당신은 온택트 교실의 AI 보조 선생님입니다.
학생과 AI 선생님의 실시간 대화 기록을 받아, 담당 선생님께 전달할 요약 보고서를 작성합니다.

요약 보고서 형식:
- 오늘 복습한 핵심 주제
- 학생이 이해한 내용 (잘 설명한 부분)
- 보완이 필요한 부분 (있다면)
- AI 선생님의 주요 피드백
- 전반적인 복습 수준 (상/중/하)

평가 기준:
- **하**: 학생의 실질적인 발화가 없거나 단답(네/아니오 수준)만 있는 경우. 내용을 설명한 발화가 전혀 확인되지 않으면 반드시 "하"로 평가합니다.
- **중**: 학생이 일부 내용을 설명했으나 오개념이나 빈 곳이 눈에 띄는 경우
- **상**: 학생이 핵심 내용을 스스로 명확하게 설명한 경우

간결하고 명확하게, 선생님이 빠르게 파악할 수 있도록 작성합니다."""


async def summarize_conversation(
    transcript: str,
    student_name: str,
    subject: str,
) -> str:
    """대화 기록을 요약하여 선생님께 전달할 보고서 생성"""
    user_message = f"""학생 이름: {student_name}
과목/주제: {subject}

[학생과 AI 선생님 대화 기록]
{transcript}

위 대화 내용을 바탕으로 선생님께 전달할 복습 요약 보고서를 작성해주세요."""

    response = await _get_client().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=1024,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )

    return response.choices[0].message.content
