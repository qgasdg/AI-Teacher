from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

from sqlalchemy import Integer, String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from database import Base

# PostgreSQL(Supabase)에서는 ai_tutor 스키마 사용, SQLite 로컬 개발은 스키마 없음
_USE_SCHEMA = os.getenv("DATABASE_URL", "").startswith(("postgresql", "postgres"))
_SCHEMA: dict = {"schema": "ai_tutor"} if _USE_SCHEMA else {}


class Recording(Base):
    """복습 녹음 세션 (학생이 배운 내용을 일방향으로 녹음 → STT)"""
    __tablename__ = "recordings"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String(100))
    question_number: Mapped[str] = mapped_column(String(20))
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Lesson(Base):
    """과외 수업 전체 녹음 → 수업 일지 (선생님이 수업 중 녹음)"""
    __tablename__ = "lessons"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String(100))
    subject: Mapped[str] = mapped_column(String(200))
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    homework: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    progress: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lesson_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class RealtimeSession(Base):
    __tablename__ = "realtime_sessions"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_name: Mapped[str] = mapped_column(String(100))
    subject: Mapped[str] = mapped_column(String(200))
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


# ── 온택트 교실 ────────────────────────────────────────────────

class OntactClassroom(Base):
    """선생님이 여는 온택트 교실 (줌 세션 1개 = 교실 1개)"""
    __tablename__ = "ontact_classrooms"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class OntactStudentSession(Base):
    """학생별 입장~퇴장 세션 (오디오 녹음 → STT → 보고서)"""
    __tablename__ = "ontact_student_sessions"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_name: Mapped[str] = mapped_column(String(100))
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    left_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)       # AI 생성 보고서
    report_final: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True) # 선생님 최종본
    report_saved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    # active → processing → completed | failed


class OntactChatMessage(Base):
    """교실 내 채팅 메시지"""
    __tablename__ = "ontact_chat_messages"
    __table_args__ = _SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(Integer, nullable=False)
    student_session_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sender: Mapped[str] = mapped_column(String(100))   # "teacher" | student_name
    to_student: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # None = broadcast
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
