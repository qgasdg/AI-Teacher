"""수업 전사 텍스트 → 수업 일지 3개 항목 자동 생성."""
import json
import os

from openai import AsyncOpenAI

_client = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


REPORT_SYSTEM_PROMPT = """당신은 과외 선생님의 수업 일지를 작성하는 보조 AI입니다.
과외 수업 녹음의 전사 텍스트를 분석하여 수업 일지를 작성합니다.
전사 텍스트에 실제로 언급된 내용만 작성하고, 없는 내용은 추측하지 마세요."""

REPORT_USER_TEMPLATE = """학생: {student_name}
과목: {subject}

[수업 녹음 전사]
{transcript}

위 수업 내용을 분석하여 아래 세 항목을 JSON으로 작성해주세요.

{{
  "homework": "다음 수업까지 해올 숙제 목록. 구체적인 범위·분량 포함. 언급이 없으면 '없음'",
  "progress": "오늘 수업 진도. 시험 점수, 다룬 단원·문제 번호, 오답 분석 여부 등 구체적으로.",
  "lesson_content": "수업 내용 종합 — 숙제 태도, 수업 이해도, 특이사항, 다음 수업 목표 등을 자연스러운 문장으로. 반드시 100자 이상."
}}"""


async def generate_lesson_report(
    transcript: str,
    student_name: str,
    subject: str,
) -> dict[str, str]:
    """전사 텍스트에서 수업 일지 3개 항목(homework, progress, lesson_content)을 반환."""
    prompt = REPORT_USER_TEMPLATE.format(
        student_name=student_name,
        subject=subject,
        transcript=transcript,
    )

    response = await _get_client().chat.completions.create(
        model="gpt-4o",
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": REPORT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )

    raw = json.loads(response.choices[0].message.content)
    return {
        "homework": str(raw.get("homework", "")),
        "progress": str(raw.get("progress", "")),
        "lesson_content": str(raw.get("lesson_content", "")),
    }
