import os

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite+aiosqlite:///./ai_teacher_realtime.db"

# Railway는 postgres:// 또는 postgresql://로 주입 — asyncpg 드라이버 명시로 교체
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,   # 유휴 후 끊긴 연결 재사용 방지
    pool_recycle=1800,    # 30분마다 연결 교체 (Railway idle timeout 대비)
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """DB 초기화. 연결 실패 시 최대 5회 재시도 (지수 백오프).
    모든 시도 실패해도 앱은 기동 — 이후 요청마다 pool_pre_ping이 재시도함.
    """
    import asyncio
    from sqlalchemy import text

    last_err = None
    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

                # 간이 마이그레이션: recordings.feedback 컬럼이 없으면 추가
                try:
                    await conn.execute(text("ALTER TABLE recordings ADD COLUMN feedback TEXT"))
                except Exception:
                    # 이미 존재하거나 테이블이 없음 — 무시
                    pass
            return  # 성공
        except Exception as e:
            last_err = e
            wait = 2 ** attempt  # 1, 2, 4, 8, 16초
            import logging
            logging.getLogger(__name__).warning(
                f"DB 초기화 실패 (시도 {attempt + 1}/5), {wait}초 후 재시도: {e}"
            )
            if attempt < 4:
                await asyncio.sleep(wait)

    import logging
    logging.getLogger(__name__).error(
        f"DB 초기화 최종 실패 — 앱은 계속 기동, 요청 시 재연결 시도: {last_err}"
    )
