from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Integer, String, Text, DateTime, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Recording(Base):
    """복습 녹음 세션 (학생이 배운 내용을 일방향으로 녹음 → STT)"""
    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String(100))
    question_number: Mapped[str] = mapped_column(String(20))  # 자유 입력
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # GPT 분석 피드백
    status: Mapped[str] = mapped_column(String(50), default="pending")
    # pending → processing → completed → failed
    audio_data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RealtimeSession(Base):
    __tablename__ = "realtime_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String(100))
    subject: Mapped[str] = mapped_column(String(200))
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    # active → ending → completed → failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    audio_data: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
