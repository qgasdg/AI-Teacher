"""온택트 수업 전사 + 채팅 → 보고서 3개 항목 (Kimi K2 via OpenRouter)."""
import json
import os

import httpx

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
KIMI_MODEL = "moonshotai/kimi-k2:free"

SYSTEM_PROMPT = """당신은 온라인 과외 수업 보고서를 작성하는 보조 AI입니다.
선생님과 학생의 줌 수업 녹음 전사와 채팅 내용을 분석하여 보고서를 작성합니다.
실제로 언급된 내용만 작성하고, 없는 내용은 추측하지 마세요."""

USER_TEMPLATE = """학생: {student_name}

[수업 녹음 전사]
{transcript}

[수업 중 채팅]
{chat_context}

위 내용을 분석하여 아래 세 항목을 JSON으로 작성해주세요.

{{
  "수업_진도": "오늘 다룬 단원·문제 번호·시험 점수 등 구체적인 진도. 언급 없으면 '미확인'",
  "일상_근황": "수업 전후 일상 대화에서 파악한 학생 근황. 없으면 '특이사항 없음'",
  "수업_내용": "수업 이해도, 어려워한 부분, 잘한 부분, 다음 수업 목표 등을 자연스러운 문장으로. 반드시 100자 이상."
}}"""


async def generate_ontact_report(
    transcript: str,
    chat_context: str,
    student_name: str,
) -> dict[str, str]:
    """전사+채팅에서 온택트 보고서 3항목을 반환."""
    if not OPENROUTER_API_KEY:
        return {
            "수업_진도": "OpenRouter API 키 미설정",
            "일상_근황": "",
            "수업_내용": "",
        }

    prompt = USER_TEMPLATE.format(
        student_name=student_name,
        transcript=transcript or "(전사 없음)",
        chat_context=chat_context or "(채팅 없음)",
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": KIMI_MODEL,
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        res.raise_for_status()
        raw = json.loads(res.json()["choices"][0]["message"]["content"])

    return {
        "수업_진도": str(raw.get("수업_진도", "")),
        "일상_근황": str(raw.get("일상_근황", "")),
        "수업_내용": str(raw.get("수업_내용", "")),
    }
