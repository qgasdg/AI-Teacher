import os
import anthropic

client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SUMMARY_SYSTEM_PROMPT = """당신은 온택트 교실의 AI 보조 선생님입니다.
학생이 복습한 내용의 음성 녹음 텍스트를 받아, 담당 선생님께 전달할 요약 보고서를 작성합니다.

요약 보고서 형식:
- 오늘 복습한 핵심 주제
- 학생이 이해한 내용 (잘 설명한 부분)
- 보완이 필요한 부분 (있다면)
- 전반적인 복습 수준 (상/중/하)

간결하고 명확하게, 선생님이 빠르게 파악할 수 있도록 작성합니다."""


async def summarize_transcript(
    transcript: str,
    student_name: str,
    subject: str,
) -> str:
    """녹음 텍스트를 요약하여 선생님께 전달할 보고서 생성"""
    user_message = f"""학생 이름: {student_name}
과목/주제: {subject}

[학생 복습 내용 녹음 텍스트]
{transcript}

위 내용을 바탕으로 선생님께 전달할 복습 요약 보고서를 작성해주세요."""

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SUMMARY_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text
