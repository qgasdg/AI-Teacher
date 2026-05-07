"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";

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

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const TEACHER_PASSWORD = process.env.NEXT_PUBLIC_TEACHER_PASSWORD || "teacher1234";
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
  has_audio: boolean;
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
  has_audio: boolean;
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

const SPEED_OPTIONS = [1.0, 1.25, 1.5];

function AudioPlayer({ sessionId, duration }: { sessionId: number; duration: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const totalDuration = duration || 0;

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !totalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * totalDuration;
    setCurrentTime(ratio * totalDuration);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const toggleSpeed = () => {
    const next = (speedIdx + 1) % SPEED_OPTIONS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEED_OPTIONS[next];
  };

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 bg-gray-100 rounded-lg px-4 py-3">
      <audio
        ref={audioRef}
        src={`${API}/sessions/${sessionId}/audio`}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
      />
      <button
        onClick={togglePlay}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition flex-shrink-0"
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>
      <span className="text-xs text-gray-500 font-mono w-12 flex-shrink-0">
        {formatTime(currentTime)}
      </span>
      <div
        className="flex-1 h-2 bg-gray-300 rounded-full cursor-pointer relative"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 font-mono w-12 flex-shrink-0 text-right">
        {formatTime(totalDuration)}
      </span>
      <button
        onClick={toggleSpeed}
        className="text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded px-1.5 py-0.5 flex-shrink-0 transition"
      >
        {SPEED_OPTIONS[speedIdx]}x
      </button>
    </div>
  );
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
  const [tab, setTab] = useState<"sessions" | "recordings">("sessions");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedRecId, setExpandedRecId] = useState<number | null>(null);

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

  const fetchRecordings = async () => {
    try {
      const res = await fetch(`${API}/recordings/`);
      if (res.ok) setRecordings(await res.json());
    } catch {
      // 조용히 실패
    }
  };

  const deleteRecording = async (id: number) => {
    if (!confirm("이 녹음을 삭제할까요? 복구할 수 없습니다.")) return;
    try {
      const res = await fetch(`${API}/recordings/${id}`, { method: "DELETE" });
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
      const res = await fetch(`${API}/sessions/${id}`, { method: "DELETE" });
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

  const retryRecording = async (id: number) => {
    // 낙관적 업데이트: 즉시 processing 상태로
    setRecordings((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "processing", transcript: null, feedback: null }
          : r
      )
    );
    try {
      const res = await fetch(`${API}/recordings/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        alert("재전사 요청에 실패했습니다.");
        fetchRecordings();
      }
    } catch {
      alert("재전사 중 오류가 발생했습니다.");
      fetchRecordings();
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchRecordings();
    const interval = setInterval(() => {
      fetchSessions();
      fetchRecordings();
    }, 5000);
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
      </div>

      {/* ── 실시간 AI 대화 탭 ── */}
      {tab === "sessions" && (<>
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
                  {/* 오디오 플레이어 */}
                  {session.has_audio && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        대화 녹음
                      </h4>
                      <AudioPlayer
                        sessionId={session.id}
                        duration={session.duration_seconds || 0}
                      />
                    </div>
                  )}

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

            const canRetry = rec.has_audio && rec.status !== "processing" && rec.status !== "pending";

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
                    {canRetry && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          retryRecording(rec.id);
                        }}
                        title="이 녹음만 재전사"
                        className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition active:scale-95"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
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
                    {/* 오디오 플레이어 */}
                    {rec.has_audio && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">녹음 재생</h4>
                        <audio
                          controls
                          src={`${API}/recordings/${rec.id}/audio`}
                          className="w-full"
                        />
                      </div>
                    )}

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
    </div>
  );
}
