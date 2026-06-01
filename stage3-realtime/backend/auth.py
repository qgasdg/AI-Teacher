"""쉐어드 시크릿 기반 API 보호.

프론트엔드는 Next.js 프록시를 경유하며, 프록시가 서버 사이드에서
`Authorization: Bearer <secret>` 헤더를 첨부한다. 시크릿은 클라이언트
번들에 노출되지 않는다.
"""

import os
from typing import Optional

from fastapi import Header, HTTPException, status

API_SHARED_SECRET = os.getenv("API_SHARED_SECRET", "").strip()


async def verify_secret(
    authorization: Optional[str] = Header(None),
) -> None:
    """API 시크릿 검증.

    - 헤더: `Authorization: Bearer <secret>`
    - API_SHARED_SECRET 미설정 시 검증 스킵 (개발 환경 편의).
    """
    if not API_SHARED_SECRET:
        return

    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer ") :].strip()
        if token == API_SHARED_SECRET:
            return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="유효한 인증이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
