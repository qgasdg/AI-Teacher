"""복습 녹음 전사 텍스트를 분석하여 학생의 이해 취약 부분을 탐지."""

import os

from openai import AsyncOpenAI

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


ANALYZER_SYSTEM_PROMPT = """당신은 학생의 복습 녹음을 분석해 담당 선생님께 보고서를 만드는 보조 AI입니다.
학생이 오늘 배운 내용을 자신의 말로 설명한 녹음의 전사 텍스트를 받아,
이해 취약 구간을 찾아 간결한 피드백을 작성합니다.

과목은 영어 직독직해, 수학 풀이 설명, 과학/사회 개념 정리 등 다양할 수 있습니다.
과목과 무관하게 다음 신호를 중점적으로 찾으세요:
1. 학생이 "모르겠다", "어렵다", "음...", "이게 뭐지" 같이 막힌 표현을 한 구간
2. 개념 설명이 부정확하거나 핵심을 비껴간 부분
3. 학생이 어려워한 것으로 보이는 특정 용어/개념 (추정 가능하면)

출력 형식 (마크다운):
### 취약 구간
- (학생이 막힌 부분 인용 + 추정되는 원인)

### 어려워한 용어/개념
- (용어 또는 개념 + 간단한 설명)

### 종합 코멘트
- (학생의 전반적인 이해도 및 권장 학습 방향)

간결하고 구체적으로, 선생님이 5초 안에 파악할 수 있도록 작성하세요.
특별히 취약점이 없으면 "전반적으로 무난하게 설명했습니다"라고 명시하세요."""


async def analyze_recording(transcript: str, question_number: str) -> str:
    """전사 텍스트를 분석하여 선생님용 피드백 생성."""
    user_message = f"""[문항: {question_number}번]

[학생 복습 녹음 전사]
{transcript}

위 전사 내용을 분석하여 선생님께 전달할 피드백을 작성해 주세요."""

    response = await _get_client().chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=800,
        messages=[
            {"role": "system", "content": ANALYZER_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )

    return response.choices[0].message.content
