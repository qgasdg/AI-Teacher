"""Supabase B kakao_sender 테이블 INSERT → 카카오 자동 발송 트리거.

컬럼: message, recipient, recipient_type, sender_info
SUPABASE_KAKAO_* 미설정 시 비활성.
"""

import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

KAKAO_URL = os.getenv("SUPABASE_KAKAO_URL", "").rstrip("/")
KAKAO_KEY = os.getenv("SUPABASE_KAKAO_KEY", "")
KAKAO_TABLE = os.getenv("SUPABASE_KAKAO_TABLE", "kakao_sender")

SENDER_INFO = "AI 튜터"


def _enabled() -> bool:
    return bool(KAKAO_URL and KAKAO_KEY and KAKAO_TABLE)


def _normalize_phone(phone: str) -> str:
    """전화번호에서 숫자만 추출. 예: 010-1234-5678 → 01012345678"""
    return re.sub(r"\D", "", phone or "")


async def send_kakao(phone: str, message: str) -> bool:
    """kakao_sender 테이블에 INSERT. 성공 시 True."""
    if not _enabled():
        logger.debug("카카오 트리거 미설정 — 발송 스킵")
        return False

    normalized = _normalize_phone(phone)
    if not normalized:
        logger.warning("카카오 발송 스킵: 전화번호 없음")
        return False

    headers = {
        "apikey": KAKAO_KEY,
        "Authorization": f"Bearer {KAKAO_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    payload = {
        "recipient": normalized,
        "recipient_type": "phone",
        "message": message,
        "sender_info": SENDER_INFO,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(
                f"{KAKAO_URL}/rest/v1/{KAKAO_TABLE}",
                json=payload,
                headers=headers,
            )
            res.raise_for_status()
            logger.info(f"카카오 발송 완료 → {normalized[:7]}***")
            return True
    except Exception as e:
        logger.error(f"카카오 발송 실패 ({normalized[:7]}***): {e}")
        return False
