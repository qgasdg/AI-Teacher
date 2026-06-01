"""
DB에 저장된 오디오 파일을 로컬로 내보내는 스크립트.

사용법:
  DATABASE_URL=postgresql://... python export_audio.py [출력_디렉토리]

출력 디렉토리 기본값: ./audio_export/
각 파일명:
  recording-{id}-{학생명}-{문항}.webm
  session-{id}-{학생명}.webm
"""
import asyncio
import os
import re
import sys
from pathlib import Path

import asyncpg


def safe_filename(s: str) -> str:
    return re.sub(r"[^\w가-힣-]", "_", s)[:40]


async def export(out_dir: Path):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL 환경변수가 필요합니다.")
        sys.exit(1)

    # asyncpg는 postgresql:// 또는 postgres:// 사용
    url = db_url.replace("postgresql+asyncpg://", "postgresql://").replace(
        "postgres://", "postgresql://"
    )

    print(f"연결 중: {url[:40]}...")
    conn = await asyncpg.connect(url)

    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0

    # --- recordings ---
    rows = await conn.fetch(
        "SELECT id, student_name, question_number, audio_data FROM recordings "
        "WHERE audio_data IS NOT NULL"
    )
    print(f"recordings: {len(rows)}개 발견")
    for row in rows:
        name = safe_filename(row["student_name"] or "unknown")
        qn = safe_filename(row["question_number"] or "")
        fname = out_dir / f"recording-{row['id']}-{name}-{qn}.webm"
        fname.write_bytes(bytes(row["audio_data"]))
        print(f"  저장: {fname.name}  ({len(row['audio_data']) // 1024}KB)")
        total += 1

    # --- realtime_sessions ---
    rows = await conn.fetch(
        "SELECT id, student_name, audio_data FROM realtime_sessions "
        "WHERE audio_data IS NOT NULL"
    )
    print(f"realtime_sessions: {len(rows)}개 발견")
    for row in rows:
        name = safe_filename(row["student_name"] or "unknown")
        fname = out_dir / f"session-{row['id']}-{name}.webm"
        fname.write_bytes(bytes(row["audio_data"]))
        print(f"  저장: {fname.name}  ({len(row['audio_data']) // 1024}KB)")
        total += 1

    await conn.close()
    print(f"\n완료: {total}개 파일 → {out_dir.resolve()}")
    print()
    print("오디오 확인 후 아래 SQL로 컬럼 삭제:")
    print("  ALTER TABLE recordings DROP COLUMN IF EXISTS audio_data;")
    print("  ALTER TABLE realtime_sessions DROP COLUMN IF EXISTS audio_data;")


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("audio_export")
    asyncio.run(export(out))
