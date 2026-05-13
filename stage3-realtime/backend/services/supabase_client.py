"""Supabase REST API를 통한 학생 정보 조회.

이름(+학년)으로 학생을 찾아 전화번호를 반환합니다.
- 0명: None 반환
- 1명: 학생 레코드 반환
- 2명+: 동명이인으로 간주, 경고 로그 후 None 반환
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

STUDENT_URL = os.getenv("SUPABASE_STUDENT_URL", "").rstrip("/")
STUDENT_KEY = os.getenv("SUPABASE_STUDENT_KEY", "")
STUDENT_TABLE = os.getenv("SUPABASE_STUDENT_TABLE", "students")


def _enabled() -> bool:
    return bool(STUDENT_URL and STUDENT_KEY)


async def find_student(name: str, grade: Optional[str] = None) -> Optional[dict]:
    """이름(+학년)으로 학생 1명 조회. 0명/2명+ 시 None."""
    if not _enabled():
        logger.debug("Supabase 미설정 — 학생 조회 스킵")
        return None

    params = {
        "select": "id,name,phone,grade",
        "name": f"eq.{name}",
    }
    if grade:
        params["grade"] = f"eq.{grade}"

    headers = {
        "apikey": STUDENT_KEY,
        "Authorization": f"Bearer {STUDENT_KEY}",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"{STUDENT_URL}/rest/v1/{STUDENT_TABLE}",
                params=params,
                headers=headers,
            )
            res.raise_for_status()
            students = res.json()
    except Exception as e:
        logger.error(f"Supabase 조회 실패: {e}")
        return None

    if len(students) == 0:
        logger.warning(f"Supabase 학생 없음: '{name}' (grade={grade})")
        return None

    if len(students) > 1:
        logger.warning(
            f"카톡 스킵: '{name}' (grade={grade}) 동명이인 {len(students)}명 — Supabase 중복"
        )
        return None

    return students[0]
