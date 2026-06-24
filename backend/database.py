import os

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite+aiosqlite:///./ai_teacher_realtime.db"

_IS_PG = False
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
    _IS_PG = True
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    _IS_PG = True
elif DATABASE_URL.startswith("postgresql+asyncpg://"):
    _IS_PG = True

# asyncpg: search_path를 ai_tutor,public으로 설정해 스키마 자동 인식
_connect_args = (
    {"server_settings": {"search_path": "ai_tutor,public"}} if _IS_PG else {}
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args=_connect_args,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """DB 초기화. 연결 실패 시 최대 5회 재시도 (지수 백오프)."""
    import asyncio
    from sqlalchemy import text

    last_err = None
    for attempt in range(5):
        try:
            async with engine.begin() as conn:
                # PostgreSQL: ai_tutor 스키마 먼저 생성
                if _IS_PG:
                    await conn.execute(text("CREATE SCHEMA IF NOT EXISTS ai_tutor"))

                await conn.run_sync(Base.metadata.create_all)

                # 마이그레이션: feedback 컬럼 (기존 테이블 호환)
                recordings_tbl = "ai_tutor.recordings" if _IS_PG else "recordings"
                try:
                    await conn.execute(text(f"ALTER TABLE {recordings_tbl} ADD COLUMN feedback TEXT"))
                except Exception:
                    pass

                # 마이그레이션: audio_data 컬럼 제거
                for tbl_name in ("recordings", "realtime_sessions"):
                    tbl = f"ai_tutor.{tbl_name}" if _IS_PG else tbl_name
                    try:
                        await conn.execute(text(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS audio_data"))
                    except Exception:
                        pass

            return
        except Exception as e:
            last_err = e
            wait = 2 ** attempt
            import logging
            logging.getLogger(__name__).warning(
                f"DB 초기화 실패 (시도 {attempt + 1}/5), {wait}초 후 재시도: {e}"
            )
            if attempt < 4:
                await asyncio.sleep(wait)

    raise RuntimeError(f"DB 초기화 최종 실패: {last_err}") from last_err
