"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LiveKitRoom,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  VideoTrack,
  AudioTrack,
  useTracks,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "@/lib/api";
import type { Editor } from "@tldraw/tldraw";
import dynamic from "next/dynamic";

const ScreenShareAnnotation = dynamic(
  () => import("@/components/ScreenShareAnnotation").then((m) => m.ScreenShareAnnotation),
  { ssr: false }
);

// AI 출력(요약/피드백)에 들어있는 마크다운을 렌더링하기 위한 공통 컴포넌트.
// Tailwind typography 플러그인 없이도 읽기 좋게 보이도록 element별로 className 지정.
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2.5 mb-1">{children}</h3>,
        h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>,
        p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-outside pl-5 my-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-outside pl-5 my-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-gray-200 text-gray-800 text-xs font-mono">{children}</code>
        ),
        hr: () => <hr className="my-3 border-gray-200" />,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600 my-2">{children}</blockquote>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

const AUTH_KEY = "teacher_authed";

interface Recording {
  id: number;
  student_name: string;
  question_number: string;
  transcript: string | null;
  feedback: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

const RECORDING_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:    { label: "대기 중",   className: "bg-gray-100 text-gray-600" },
  processing: { label: "전산화 중", className: "bg-yellow-100 text-yellow-700" },
  completed:  { label: "완료",     className: "bg-green-100 text-green-700" },
  failed:     { label: "실패",     className: "bg-red-100 text-red-700" },
};

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

function parseTranscript(transcript: string): { role: "user" | "assistant"; text: string }[] {
  return transcript.split("\n").filter(Boolean).map((line) => {
    if (line.startsWith("학생: ")) {
      return { role: "user" as const, text: line.slice(4) };
    } else if (line.startsWith("AI 선생님: ")) {
      return { role: "assistant" as const, text: line.slice(8) };
    }
    return { role: "assistant" as const, text: line };
  });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "대화 중", className: "bg-blue-100 text-blue-700" },
  ending: { label: "요약 중", className: "bg-yellow-100 text-yellow-700" },
  completed: { label: "완료", className: "bg-green-100 text-green-700" },
  failed: { label: "실패", className: "bg-red-100 text-red-700" },
  abandoned: { label: "중단됨", className: "bg-gray-200 text-gray-500" },
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
  const [tab, setTab] = useState<"sessions" | "recordings" | "ontact">("sessions");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedRecId, setExpandedRecId] = useState<number | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") setAuthed(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/teacher-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      if (res.ok) {
        sessionStorage.setItem(AUTH_KEY, "1");
        setAuthed(true);
        setPwError(false);
      } else {
        setPwError(true);
        setPwInput("");
      }
    } catch {
      setPwError(true);
      setPwInput("");
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await apiFetch(`/sessions/`);
      if (res.ok) setSessions(await res.json());
    } catch {
      // 조용히 실패
    }
  };

  const fetchRecordings = async () => {
    try {
      const res = await apiFetch(`/recordings/`);
      if (res.ok) setRecordings(await res.json());
    } catch {
      // 조용히 실패
    }
  };

  const deleteRecording = async (id: number) => {
    if (!confirm("이 녹음을 삭제할까요? 복구할 수 없습니다.")) return;
    try {
      const res = await apiFetch(`/recordings/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRecordings((prev) => prev.filter((r) => r.id !== id));
        if (expandedRecId === id) setExpandedRecId(null);
      } else {
        alert("삭제에 실패했습니다.");
      }
    } catch {
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  const deleteSession = async (id: number) => {
    if (!confirm("이 대화 세션을 삭제할까요? 복구할 수 없습니다.")) return;
    try {
      const res = await apiFetch(`/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (expandedId === id) setExpandedId(null);
      } else {
        alert("삭제에 실패했습니다.");
      }
    } catch {
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchRecordings();
    const interval = setInterval(() => {
      fetchSessions();
      fetchRecordings();
    }, 60000);
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
      {/* 탭 */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setTab("sessions")}
          className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
            tab === "sessions"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          실시간 AI 대화
        </button>
        <button
          onClick={() => setTab("recordings")}
          className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
            tab === "recordings"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          복습 녹음
          {recordings.filter((r) => r.status === "completed").length > 0 && (
            <span className="ml-1.5 bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5 rounded-full">
              {recordings.filter((r) => r.status === "completed").length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("ontact")}
          className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
            tab === "ontact"
              ? "border-purple-600 text-purple-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          온택트 교실
        </button>
      </div>

      {/* ── 실시간 AI 대화 탭 ── */}
      {tab === "sessions" && (<>
      <div className="flex justify-end mb-4">
        <button
          onClick={fetchSessions}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5"
        >
          ↻ 새로고침
        </button>
      </div>
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
          const isAbandoned = session.status === "abandoned";
          const isExpanded = !isAbandoned && expandedId === session.id;

          return (
            <div
              key={session.id}
              className={`rounded-xl border border-gray-100 overflow-hidden ${
                isAbandoned ? "bg-gray-50 opacity-60" : "bg-white"
              }`}
            >
              {/* 헤더 — abandoned는 클릭 불가 */}
              <div className="w-full px-5 py-4 flex items-center justify-between">
                <button
                  onClick={() => !isAbandoned && setExpandedId(isExpanded ? null : session.id)}
                  disabled={isAbandoned}
                  className={`flex-1 text-left flex items-center gap-3 ${
                    isAbandoned ? "cursor-default" : "hover:opacity-80"
                  }`}
                >
                  <div>
                    <p className={`font-medium ${isAbandoned ? "text-gray-500" : "text-gray-800"}`}>
                      {session.student_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {session.subject} · {formatDate(session.created_at)}
                      {session.duration_seconds
                        ? ` · ${formatDuration(session.duration_seconds)}`
                        : ""}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.className}`}
                  >
                    {statusInfo.label}
                  </span>
                  {isAbandoned ? (
                    <button
                      onClick={() => deleteSession(session.id)}
                      title="삭제"
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  ) : (
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
                  )}
                </div>
              </div>

              {/* 상세 내용 */}
              {isExpanded && (
                <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                  {/* AI 복습 요약 */}
                  {session.summary && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        AI 복습 요약
                      </h4>
                      <div className="bg-blue-50 rounded-lg p-4 text-sm text-gray-700">
                        <Markdown>{session.summary}</Markdown>
                      </div>
                    </div>
                  )}

                  {/* 대화 기록 — 말풍선 */}
                  {session.transcript && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        대화 기록
                      </h4>
                      <div className="bg-gray-50 rounded-lg p-4 max-h-80 overflow-y-auto space-y-2">
                        {parseTranscript(session.transcript).map((entry, i) => (
                          <div
                            key={i}
                            className={`flex ${
                              entry.role === "user" ? "justify-end" : "justify-start"
                            }`}
                          >
                            <div
                              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                                entry.role === "user"
                                  ? "bg-blue-600 text-white rounded-br-md"
                                  : "bg-white text-gray-800 rounded-bl-md border border-gray-200"
                              }`}
                            >
                              <p className="text-xs font-medium mb-0.5 opacity-70">
                                {entry.role === "user" ? "학생" : "AI 선생님"}
                              </p>
                              {entry.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!session.summary && !session.transcript && (
                    <p className="text-sm text-gray-400">
                      아직 대화 내용이 없습니다
                    </p>
                  )}

                  {/* 삭제 버튼 */}
                  <div className="pt-2 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => deleteSession(session.id)}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 px-3 py-1.5 rounded hover:bg-red-50 transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}

      {/* ── 복습 녹음 탭 ── */}
      {tab === "recordings" && (
        <div className="space-y-3">
          <div className="flex justify-end mb-1">
            <button
              onClick={fetchRecordings}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5"
            >
              ↻ 새로고침
            </button>
          </div>
          {recordings.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              아직 복습 녹음이 없습니다
            </div>
          )}

          {recordings.map((rec) => {
            const statusInfo = RECORDING_STATUS_LABELS[rec.status] || {
              label: rec.status,
              className: "bg-gray-100 text-gray-600",
            };
            const isExpanded = expandedRecId === rec.id;

            return (
              <div
                key={rec.id}
                className="bg-white rounded-xl border border-gray-100 overflow-hidden"
              >
                <div className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition">
                  <button
                    onClick={() => setExpandedRecId(isExpanded ? null : rec.id)}
                    className="flex-1 text-left"
                  >
                    <p className="font-medium text-gray-800">
                      {rec.student_name}
                      <span className="ml-2 text-blue-600 font-semibold">{rec.question_number}</span>
                    </p>
                    <p className="text-xs text-gray-500">{formatDate(rec.created_at)}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.className}`}>
                      {statusInfo.label}
                    </span>
                    <button
                      onClick={() => setExpandedRecId(isExpanded ? null : rec.id)}
                      className="p-1"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                    {/* GPT 피드백 — 취약 구간/어려워한 단어 */}
                    {rec.feedback && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">AI 피드백 (취약 구간 분석)</h4>
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-gray-700">
                          <Markdown>{rec.feedback}</Markdown>
                        </div>
                      </div>
                    )}

                    {/* 전사 텍스트 */}
                    {rec.transcript && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">복습 녹음 전사 텍스트</h4>
                        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                          {rec.transcript}
                        </div>
                      </div>
                    )}

                    {rec.status === "processing" && (
                      <div className="flex items-center gap-2 text-yellow-600 text-sm">
                        <div className="w-4 h-4 border-2 border-yellow-300 border-t-yellow-600 rounded-full animate-spin" />
                        전산화 중입니다...
                      </div>
                    )}

                    {/* 실패 상세 */}
                    {rec.status === "failed" && rec.transcript && (
                      <div>
                        <h4 className="text-sm font-medium text-red-600 mb-2">전사 실패</h4>
                        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700 whitespace-pre-wrap break-all">
                          {rec.transcript}
                        </div>
                      </div>
                    )}

                    {/* 삭제 버튼 */}
                    <div className="pt-2 border-t border-gray-100 flex justify-end">
                      <button
                        onClick={() => deleteRecording(rec.id)}
                        className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 px-3 py-1.5 rounded hover:bg-red-50 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                        삭제
                      </button>
                    </div>

                    {!rec.transcript && rec.status !== "processing" && (
                      <p className="text-sm text-gray-400">전사 텍스트가 없습니다</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 온택트 교실 탭 ── */}
      {tab === "ontact" && <OntactTeacherView />}
    </div>
  );
}

// ── 온택트 교실 선생님 뷰 ─────────────────────────────────────

interface OntactSession {
  id: number;
  classroom_id: number;
  student_name: string;
  joined_at: string;
  left_at: string | null;
  transcript: string | null;
  report: Record<string, string> | null;
  report_final: Record<string, string> | null;
  status: string;
}

interface OntactChatMsg {
  sender: string;
  content: string;
  image_url?: string;
  ts: number;
}

interface DataMsg {
  type: "chat" | "room_switch" | "entered_private" | "left_private";
  sender: string;
  to: string | null;
  content: string;
  image_url?: string;
  target_room?: "group" | "private";
}

type RoomType = "group" | "private";

function OntactTeacherView() {
  const [classroom, setClassroom] = useState<{ id: number; status: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [sessions, setSessions] = useState<OntactSession[]>([]);
  const [roomType, setRoomType] = useState<RoomType>("group");
  const [privateStudent, setPrivateStudent] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState(0);
  const [roomConnecting, setRoomConnecting] = useState(false);

  const fetchSessions = useCallback(async (classroomId: number) => {
    try {
      const res = await apiFetch(`/ontact/classrooms/${classroomId}/sessions`);
      if (res.ok) setSessions(await res.json());
    } catch {}
  }, []);

  const getToken = useCallback(async (
    classroomId: number,
    type: RoomType,
    student: string | null = null,
  ) => {
    const params = new URLSearchParams({
      classroom_id: String(classroomId),
      name: "선생님",
      room_type: type,
      ...(student ? { target: student } : {}),
    });
    const res = await apiFetch(`/ontact/token?${params}`);
    if (!res.ok) return null;
    return res.json() as Promise<{ token: string; livekit_url: string }>;
  }, []);

  const createClassroom = async () => {
    setCreating(true);
    try {
      // 이미 열린 교실이 있으면 재사용 (학생이 먼저 입장한 경우 등)
      let data: { id: number; status: string } | null = null;
      const currentRes = await apiFetch("/ontact/classrooms/current");
      if (currentRes.ok) {
        data = await currentRes.json();
      } else {
        const res = await apiFetch("/ontact/classrooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: null }),
        });
        if (!res.ok) { setCreating(false); return; }
        data = await res.json();
      }
      if (!data) { setCreating(false); return; }

      const tokenData = await getToken(data.id, "group");
      if (!tokenData) { setCreating(false); return; }

      setToken(tokenData.token);
      setServerUrl(tokenData.livekit_url);
      setClassroom(data);
      setRoomType("group");
      setPrivateStudent(null);
      await fetchSessions(data.id);
    } catch (err) {
      console.error(err);
    }
    setCreating(false);
  };

  const switchRoom = useCallback(async (type: RoomType, student: string | null = null) => {
    if (!classroom) return;
    const tokenData = await getToken(classroom.id, type, student);
    if (!tokenData) return;
    const scrollY = window.scrollY;
    // 이전 방 완전히 해제 후 새 방 연결 (LiveKit 경쟁 조건 방지)
    setRoomConnecting(true);
    await new Promise((r) => setTimeout(r, 200));
    setToken(tokenData.token);
    setRoomType(type);
    setPrivateStudent(student);
    setRoomKey((k) => k + 1);
    setRoomConnecting(false);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }, [classroom, getToken]);

  const closeClassroom = async () => {
    if (!classroom) return;
    await apiFetch(`/ontact/classrooms/${classroom.id}/close`, { method: "POST" });
    setClassroom(null);
    setToken("");
    setSessions([]);
  };

  if (!classroom) {
    return (
      <div className="text-center py-16">
        <button
          onClick={createClassroom}
          disabled={creating}
          className="bg-purple-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-purple-700 transition disabled:opacity-50"
        >
          {creating ? "입장 중..." : "입장"}
        </button>
      </div>
    );
  }

  if (roomConnecting) {
    return <div className="py-16 text-center text-sm text-gray-400">방 이동 중...</div>;
  }

  return (
    <LiveKitRoom
      key={roomKey}
      token={token}
      serverUrl={serverUrl}
      audio={true}
      video={false}
      connect={true}
    >
      <TeacherRoom
        classroom={classroom}
        sessions={sessions}
        roomType={roomType}
        privateStudent={privateStudent}
        onSwitchRoom={switchRoom}
        onClose={closeClassroom}
        onRefreshSessions={() => fetchSessions(classroom.id)}
        classroomId={classroom.id}
      />
    </LiveKitRoom>
  );
}

// ── 선생님 방 UI ──────────────────────────────────────────────

function TeacherRoom({
  classroom,
  sessions,
  roomType,
  privateStudent,
  onSwitchRoom,
  onClose,
  onRefreshSessions,
  classroomId,
}: {
  classroom: { id: number; status: string };
  sessions: OntactSession[];
  roomType: RoomType;
  privateStudent: string | null;
  onSwitchRoom: (type: RoomType, student?: string | null) => void;
  onClose: () => void;
  onRefreshSessions: () => void;
  classroomId: number;
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const participants = useParticipants();
  const students = participants.filter((p) => p.identity !== "teacher");

  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [chatMap, setChatMap] = useState<Record<string, OntactChatMsg[]>>({});
  const [input, setInput] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [editReport, setEditReport] = useState<Record<string, string> | null>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [privateStudentNames, setPrivateStudentNames] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const tldrawEditorRef = useRef<Editor | null>(null);

  // 학생 입/퇴장 시 세션 목록 갱신
  useEffect(() => {
    const onJoin = () => onRefreshSessions();
    const onLeave = () => onRefreshSessions();
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [room, onRefreshSessions]);

  // DataChannel 수신
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const msg: DataMsg = JSON.parse(new TextDecoder().decode(payload));
        if (msg.type === "entered_private") {
          setPrivateStudentNames((prev) => [...new Set([...prev, msg.sender])]);
          return;
        }
        if (msg.type === "left_private") {
          setPrivateStudentNames((prev) => prev.filter((n) => n !== msg.sender));
          return;
        }
        if (msg.type !== "chat") return;
        setChatMap((prev) => ({
          ...prev,
          [msg.sender]: [...(prev[msg.sender] ?? []), {
            sender: msg.sender,
            content: msg.content,
            image_url: msg.image_url,
            ts: Date.now(),
          }],
        }));
      } catch {}
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMap, selectedStudent]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !selectedStudent) return;

    const target = participants.find((p) => p.identity === selectedStudent);
    const msg: DataMsg = { type: "chat", sender: "선생님", to: selectedStudent, content: text };
    room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(msg)),
      {
        reliable: true,
        destinationIdentities: target ? [target.identity] : undefined,
      }
    );
    setChatMap((prev) => ({
      ...prev,
      [selectedStudent]: [...(prev[selectedStudent] ?? []), { sender: "나", content: text, ts: Date.now() }],
    }));
    setInput("");
    // DB 저장 (fire-and-forget)
    apiFetch(`/ontact/classrooms/${classroomId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "선생님", to_student: selectedStudent, content: text }),
    }).catch(() => {});
  }, [input, selectedStudent, room, participants, classroomId]);

  const sendImage = useCallback((file: File) => {
    if (!selectedStudent) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const target = participants.find((p) => p.identity === selectedStudent);
      const msg: DataMsg = { type: "chat", sender: "선생님", to: selectedStudent, content: "[사진]", image_url: dataUrl };
      room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(msg)),
        { reliable: true, destinationIdentities: target ? [target.identity] : undefined }
      );
      setChatMap((prev) => ({
        ...prev,
        [selectedStudent]: [...(prev[selectedStudent] ?? []), { sender: "나", content: "[사진]", image_url: dataUrl, ts: Date.now() }],
      }));
    };
    reader.readAsDataURL(file);
  }, [selectedStudent, room, participants]);

  const saveReport = async (sessionId: number) => {
    if (!editReport) return;
    setSavingReport(true);
    try {
      await apiFetch(`/ontact/student-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_final: editReport }),
      });
      setEditReport(null);
      onRefreshSessions();
    } catch {}
    setSavingReport(false);
  };

  const allCameraTracks = useTracks([Track.Source.Camera]);
  const remoteAudioTracks = useTracks([Track.Source.Microphone]).filter(
    (t) => t.participant.identity !== "teacher"
  );
  const allScreenShareTracks = useTracks([Track.Source.ScreenShare]);
  const studentVideoTracks = allCameraTracks.filter(
    (t) => t.participant.identity !== "teacher"
  );
  const teacherLocalVideoTracks = allCameraTracks.filter(
    (t) => t.participant.identity === "teacher"
  );
  const activeScreenShare = allScreenShareTracks[0] ?? null;

  const currentChat = selectedStudent ? (chatMap[selectedStudent] ?? []) : [];

  return (
    <div className="space-y-6">
      {/* 원격 오디오 재생 */}
      {remoteAudioTracks.map((t) => (
        <AudioTrack key={t.publication.trackSid} trackRef={t} />
      ))}

      {/* 컨트롤 + 닫기 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 현재 방 표시 */}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            roomType === "group"
              ? "bg-purple-100 text-purple-700"
              : "bg-amber-100 text-amber-700"
          }`}>
            {roomType === "group" ? "강의실" : `개인실 · ${privateStudent}`}
          </span>
          {roomType === "private" && (<>
            <button
              onClick={() => onSwitchRoom("group")}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium transition"
            >
              ← 강의실로
            </button>
            <button
              onClick={async () => {
                // 학생도 함께 강의실로 데려가기
                const msg = { type: "room_switch", sender: "선생님", to: null, content: "", target_room: "group" };
                room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true });
                setPrivateStudentNames((prev) => prev.filter((n) => n !== privateStudent));
                await new Promise((r) => setTimeout(r, 250));
                onSwitchRoom("group");
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium transition"
            >
              학생과 함께 강의실로
            </button>
          </>)}
          <button
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
              isCameraEnabled
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "bg-red-100 text-red-600 hover:bg-red-200"
            }`}
          >
            {isCameraEnabled ? "📷 카메라 켜짐" : "📵 카메라 꺼짐"}
          </button>
          <button
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
              isMicrophoneEnabled
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "bg-red-100 text-red-600 hover:bg-red-200"
            }`}
          >
            {isMicrophoneEnabled ? "🎙 마이크 켜짐" : "🔇 마이크 꺼짐"}
          </button>
          <button
            onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
              isScreenShareEnabled
                ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
            title={isScreenShareEnabled ? "화면 공유 중지" : "화면 공유 시작"}
          >
            🖥 {isScreenShareEnabled ? "공유 중" : "화면 공유"}
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-sm font-medium text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg shadow-sm transition"
        >
          나가기
        </button>
      </div>

      {/* 화면 공유 + tldraw 오버레이 */}
      {activeScreenShare && (
        <div className="relative w-full bg-gray-900 rounded-xl overflow-hidden" style={{ height: 480 }}>
          <ScreenShareAnnotation
            trackRef={activeScreenShare}
            room={room}
            senderName="선생님"
            onEditorMount={(ed) => { tldrawEditorRef.current = ed; }}
          />
          {/* 판서 지우기 버튼 */}
          <button
            onClick={() => {
              const ed = tldrawEditorRef.current;
              if (!ed) return;
              const ids = [...ed.getCurrentPageShapeIds()];
              if (ids.length) ed.deleteShapes(ids);
            }}
            className="absolute top-3 right-3 z-[9999] text-xs px-3 py-1.5 rounded-full bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm transition font-medium"
          >
            판서 지우기
          </button>
          <p className="absolute bottom-2 left-3 z-[9999] text-xs text-white/60">
            {allScreenShareTracks[0]?.participant.identity === "teacher"
              ? "내 화면 공유 중"
              : `${allScreenShareTracks[0]?.participant.name ?? "학생"} 화면 공유 중`}
          </p>
        </div>
      )}

      {/* 내 카메라 미리보기 */}
      {isCameraEnabled && teacherLocalVideoTracks.length > 0 && (
        <div className="flex gap-3 items-start">
          {teacherLocalVideoTracks.map((t) => (
            <div key={t.publication.trackSid} className="relative bg-gray-900 rounded-xl overflow-hidden w-48 aspect-video shrink-0">
              <VideoTrack trackRef={t} className="w-full h-full object-cover" />
              <p className="absolute bottom-1 left-2 text-white text-xs bg-black/50 px-1.5 py-0.5 rounded">나</p>
            </div>
          ))}
        </div>
      )}

      {/* 학생 비디오 그리드 */}
      {studentVideoTracks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {studentVideoTracks.map((t) => (
            <div key={t.publication.trackSid} className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
              <VideoTrack trackRef={t} className="w-full h-full object-cover" />
              <p className="absolute bottom-2 left-2 text-white text-xs bg-black/50 px-2 py-0.5 rounded">
                {t.participant.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 채팅 + 학생 목록 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 학생 목록 */}
        <div className="col-span-1 bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">
            접속 중 ({students.length}명)
          </p>
          {students.length === 0 && privateStudentNames.length === 0 ? (
            <p className="text-xs text-gray-400">아직 아무도 없습니다</p>
          ) : (
            <ul className="space-y-1">
              {/* 개인실 중인 학생 */}
              {privateStudentNames.map((name) => (
                <li key={`private-${name}`}>
                  <div className="flex items-center gap-1">
                    <div className="flex-1 text-sm px-3 py-2 rounded-lg text-amber-700 bg-amber-50">
                      <span className="w-2 h-2 bg-amber-400 rounded-full inline-block mr-2" />
                      {name}
                      <span className="ml-1 text-xs text-amber-500">개인실</span>
                    </div>
                    <button
                      onClick={() => onSwitchRoom("private", name)}
                      className="shrink-0 text-xs px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium transition"
                    >
                      입장
                    </button>
                  </div>
                </li>
              ))}
              {/* 강의실 중인 학생 */}
              {students.map((p) => (
                <li key={p.identity}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedStudent(p.identity)}
                      className={`flex-1 text-left text-sm px-3 py-2 rounded-lg transition ${
                        selectedStudent === p.identity
                          ? "bg-purple-100 text-purple-700 font-medium"
                          : "hover:bg-gray-50 text-gray-700"
                      }`}
                    >
                      <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-2" />
                      {p.name}
                      {chatMap[p.identity]?.length ? (
                        <span className="ml-1 text-xs text-purple-500">({chatMap[p.identity].length})</span>
                      ) : null}
                    </button>
                    <button
                      onClick={() => {
                        // 학생만 개인실로 보냄 (선생님은 현재 방 유지)
                        const target = participants.find((par) => par.identity === p.identity);
                        const msg = { type: "room_switch", sender: "선생님", to: p.name, content: "", target_room: "private" };
                        room.localParticipant.publishData(
                          new TextEncoder().encode(JSON.stringify(msg)),
                          { reliable: true, destinationIdentities: target ? [target.identity] : undefined }
                        );
                        // 학생이 entered_private 알림 없이 이동하므로 직접 개인실 목록에 추가
                        setPrivateStudentNames((prev) => [...new Set([...prev, p.name ?? p.identity])]);
                      }}
                      title="학생을 개인실로 이동"
                      className="shrink-0 text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-amber-100 hover:text-amber-700 transition font-medium"
                    >
                      이동
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 채팅창 */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-xl flex flex-col" style={{ height: 360 }}>
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-700 shrink-0">
            {selectedStudent ? `${selectedStudent}에게` : "학생을 선택하면 1:1 채팅"}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {currentChat.map((msg, i) => {
              const isMe = msg.sender === "나";
              return (
                <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                    isMe ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-800"
                  }`}>
                    {msg.image_url && (
                      <img src={msg.image_url} alt="사진" className="rounded mb-1 max-w-[160px]" />
                    )}
                    {msg.content !== "[사진]" && msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 py-2 border-t border-gray-100 flex gap-2 shrink-0">
            <button
              onClick={() => imgRef.current?.click()}
              disabled={!selectedStudent}
              className="text-gray-400 hover:text-gray-600 text-lg shrink-0 disabled:opacity-30"
            >
              🖼
            </button>
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) sendImage(f); e.target.value = ""; }}
            />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), sendMessage())}
              placeholder={selectedStudent ? `${selectedStudent}에게 메시지...` : "학생 선택 후 입력"}
              disabled={!selectedStudent}
              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:bg-gray-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || !selectedStudent}
              className="shrink-0 bg-purple-600 text-white rounded-xl px-3 py-2 text-sm hover:bg-purple-700 transition disabled:opacity-40"
            >
              전송
            </button>
          </div>
        </div>
      </div>

      {/* 세션 보고서 목록 */}
      {sessions.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">수업 세션 ({sessions.length}명)</p>
          <div className="space-y-2">
            {sessions.map((s) => {
              const isExpanded = expandedSessionId === s.id;
              const report = s.report_final ?? s.report;
              const statusLabel: Record<string, string> = {
                active: "수업 중", processing: "보고서 생성 중",
                completed: "완료", failed: "실패",
              };
              return (
                <div key={s.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => { setExpandedSessionId(isExpanded ? null : s.id); setEditReport(null); }}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{s.student_name}</p>
                      <p className="text-xs text-gray-400">{formatDate(s.joined_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.status === "completed" ? "bg-green-100 text-green-700" :
                        s.status === "processing" ? "bg-yellow-100 text-yellow-700" :
                        s.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {statusLabel[s.status] ?? s.status}
                      </span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                      {s.status === "processing" && (
                        <div className="flex items-center gap-2 text-yellow-600 text-sm">
                          <div className="w-4 h-4 border-2 border-yellow-300 border-t-yellow-600 rounded-full animate-spin" />
                          보고서 생성 중...
                        </div>
                      )}
                      {report && (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-700">
                              수업 보고서 {s.report_final ? "(최종 저장됨)" : "(AI 초안)"}
                            </h4>
                            {!editReport && (
                              <button onClick={() => setEditReport({ ...report })}
                                className="text-xs text-purple-600 hover:text-purple-800">수정</button>
                            )}
                          </div>
                          {editReport ? (
                            <div className="space-y-3">
                              {Object.entries(editReport).map(([key, val]) => (
                                <div key={key}>
                                  <label className="text-xs font-medium text-gray-600 mb-1 block">{key}</label>
                                  <textarea
                                    value={val}
                                    onChange={(e) => setEditReport((prev) => ({ ...prev!, [key]: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                                    rows={3}
                                  />
                                </div>
                              ))}
                              <div className="flex gap-2">
                                <button onClick={() => saveReport(s.id)} disabled={savingReport}
                                  className="bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-purple-700 transition disabled:opacity-50">
                                  {savingReport ? "저장 중..." : "최종 저장"}
                                </button>
                                <button onClick={() => setEditReport(null)}
                                  className="text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">취소</button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {Object.entries(report).map(([key, val]) => (
                                <div key={key} className="bg-gray-50 rounded-lg p-3">
                                  <p className="text-xs font-medium text-gray-500 mb-1">{key}</p>
                                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{val}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {s.transcript && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-600 mb-2">수업 전사</h4>
                          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {s.transcript}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
