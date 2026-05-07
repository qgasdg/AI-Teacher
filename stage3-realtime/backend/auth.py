"""쉐어드 시크릿 기반 API 보호.

NEXT_PUBLIC_* 환경변수로 프론트 번들에 노출되므로 진짜 비밀이라기보단
'무작위 스캐너/봇 차단용 게이트'에 가깝다. 본격 인증(학생/교사 로그인)은
별도 작업.
"""

import os
from typing import Optional

from fastapi import Header, HTTPException, Query, status

API_SHARED_SECRET = os.getenv("API_SHARED_SECRET", "").strip()


async def verify_secret(
    authorization: Optional[str] = Header(None),
    secret: Optional[str] = Query(None),
) -> None:
    """API 시크릿 검증.

    - 헤더: `Authorization: Bearer <secret>` (기본)
    - 쿼리: `?secret=<secret>` (HTML <audio>/<img> src 등 헤더를 못 보내는 케이스용)
    - API_SHARED_SECRET 미설정 시 검증 스킵 (개발 환경 편의).
    """
    if not API_SHARED_SECRET:
        return

    # 헤더 우선
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer ") :].strip()
        if token == API_SHARED_SECRET:
            return

    # 쿼리 폴백
    if secret and secret == API_SHARED_SECRET:
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="유효한 인증이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
