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
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # 간이 마이그레이션: recordings.feedback 컬럼이 없으면 추가
        try:
            await conn.execute(text("ALTER TABLE recordings ADD COLUMN feedback TEXT"))
        except Exception:
            # 이미 존재하거나 테이블이 없음 — 무시
            pass
