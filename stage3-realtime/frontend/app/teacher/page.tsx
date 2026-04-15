"use client";

import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const TEACHER_PASSWORD = process.env.NEXT_PUBLIC_TEACHER_PASSWORD || "teacher1234";
const AUTH_KEY = "teacher_authed";

interface Session {
  id: number;
  student_name: string;
  subject: string;
  transcript: string | null;
  summary: string | null;
  status: string;
  created_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "대화 중", className: "bg-blue-100 text-blue-700" },
  ending: { label: "요약 중", className: "bg-yellow-100 text-yellow-700" },
  completed: { label: "완료", className: "bg-green-100 text-green-700" },
  failed: { label: "실패", className: "bg-red-100 text-red-700" },
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeacherDashboard() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") setAuthed(true);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwInput === TEACHER_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, "1");
      setAuthed(true);
      setPwError(false);
    } else {
      setPwError(true);
      setPwInput("");
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API}/sessions/`);
      if (res.ok) setSessions(await res.json());
    } catch {
      // 조용히 실패
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const activeCount = sessions.filter((s) => s.status === "active").length;

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form
          onSubmit={handleLogin}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm space-y-4"
        >
          <h1 className="text-lg font-bold text-gray-800 text-center">교사 대시보드</h1>
          <input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder="비밀번호를 입력하세요"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {pwError && (
            <p className="text-red-500 text-xs">비밀번호가 올바르지 않습니다.</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            확인
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{sessions.length}</p>
          <p className="text-xs text-gray-500">전체 세션</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{completedCount}</p>
          <p className="text-xs text-gray-500">완료</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{activeCount}</p>
          <p className="text-xs text-gray-500">진행 중</p>
        </div>
      </div>

      {/* 세션 목록 */}
      <div className="space-y-3">
        {sessions.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            아직 세션이 없습니다
          </div>
        )}

        {sessions.map((session) => {
          const statusInfo = STATUS_LABELS[session.status] || {
            label: session.status,
            className: "bg-gray-100 text-gray-600",
          };
          const isExpanded = expandedId === session.id;

          return (
            <div
              key={session.id}
              className="bg-white rounded-xl border border-gray-100 overflow-hidden"
            >
              {/* 헤더 */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : session.id)}
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium text-gray-800">
                      {session.student_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {session.subject} · {formatDate(session.created_at)}
                      {session.duration_seconds
                        ? ` · ${formatDuration(session.duration_seconds)}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.className}`}
                  >
                    {statusInfo.label}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </button>

              {/* 상세 내용 */}
              {isExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                  {session.summary && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        AI 복습 요약
                      </h4>
                      <div className="bg-blue-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {session.summary}
                      </div>
                    </div>
                  )}
                  {session.transcript && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        대화 기록
                      </h4>
                      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                        {session.transcript}
                      </div>
                    </div>
                  )}
                  {!session.summary && !session.transcript && (
                    <p className="text-sm text-gray-400">
                      아직 대화 내용이 없습니다
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
