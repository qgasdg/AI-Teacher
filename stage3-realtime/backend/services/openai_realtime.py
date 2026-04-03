import os

import httpx

REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"
MODEL = "gpt-4o-realtime-preview"


async def get_ephemeral_key(instructions: str, voice: str = "shimmer") -> dict:
    """OpenAI Realtime API용 임시 키를 발급받습니다."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            REALTIME_SESSIONS_URL,
            headers={
                "Authorization": f"Bearer {os.getenv('OPENAI_API_KEY', '')}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "voice": voice,
                "instructions": instructions,
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": None,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()
