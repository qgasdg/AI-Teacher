"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "@/lib/api";

const AUTH_KEY = "teacher_authed";

type PageState = "form" | "recording" | "uploading" | "waiting" | "done" | "error";

interface LessonReport {
  id: number;
  student_name: string;
  subject: string;
  homework: string | null;
  progress: string | null;
  lesson_content: string | null;
  status: string;
}

// ── 로그인 게이트 ──────────────────────────────────────────────
function LoginGate({ onAuth }: { onAuth: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/teacher-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        sessionStorage.setItem(AUTH_KEY, "1");
        onAuth();
      } else {
        setError(true);
        setPw("");
      }
    } catch {
      setError(true);
      setPw("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm space-y-4"
      >
        <h1 className="text-lg font-bold text-gray-800 text-center">수업 일지</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="선생님 비밀번호"
          className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        {error && <p className="text-red-500 text-xs">비밀번호가 올바르지 않습니다.</p>}
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

// ── 보고서 필드 렌더 ──────────────────────────────────────────
function ReportField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
        {value}
      </div>
    </div>
  );
}

// ── 메인 녹음·업로드 화면 ─────────────────────────────────────
export default function LessonPage() {
  const [authed, setAuthed] = useState(false);
  const [pageState, setPageState] = useState<PageState>("form");

  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [report, setReport] = useState<LessonReport | null>(null);
  const [lessonId, setLessonId] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") setAuthed(true);
  }, []);

  // 폴링: 보고서 생성 완료 대기
  useEffect(() => {
    if (pageState !== "waiting" || !lessonId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/lessons/${lessonId}`);
        if (!res.ok) return;
        const data: LessonReport = await res.json();
        if (data.status === "completed") {
          clearInterval(pollRef.current!);
          setReport(data);
          setPageState("done");
        } else if (data.status === "failed") {
          clearInterval(pollRef.current!);
          setError("보고서 생성에 실패했습니다. 다시 시도해주세요.");
          setPageState("error");
        }
      } catch {
        // 잠시 후 재시도
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pageState, lessonId]);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const startRecording = useCallback(async () => {
    if (!studentName.trim() || !subject.trim()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => stream.getTracks().forEach((t) => t.stop());
      mr.start();
      mediaRecorderRef.current = mr;
      setElapsedSec(0);
      setPageState("recording");
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } catch {
      setError("마이크 접근 권한이 필요합니다.");
    }
  }, [studentName, subject]);

  const stopAndUpload = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (timerRef.current) clearInterval(timerRef.current);

    mr.onstop = async () => {
      mr.stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setPageState("uploading");

      const formData = new FormData();
      formData.append("student_name", studentName.trim());
      formData.append("subject", subject.trim());
      formData.append("duration_seconds", String(elapsedSec));
      formData.append("audio", blob, "lesson.webm");

      try {
        const res = await apiFetch("/lessons/", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`서버 오류: ${res.status}`);
        const data: LessonReport = await res.json();
        setLessonId(data.id);
        setPageState("waiting");
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드 중 오류");
        setPageState("error");
      }
    };
    mr.stop();
    setPageState("uploading");
  }, [studentName, subject, elapsedSec]);

  const reset = () => {
    setPageState("form");
    setReport(null);
    setLessonId(null);
    setError("");
    setElapsedSec(0);
  };

  if (!authed) return <LoginGate onAuth={() => setAuthed(true)} />;

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800">수업 일지</h1>
        <p className="text-gray-500 text-sm mt-1">수업 전체를 녹음하면 보고서가 자동으로 작성됩니다</p>
      </div>

      {/* ── 폼 ── */}
      {pageState === "form" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">학생 이름</label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="예: 홍길동"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">과목</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="예: 영어, 수학"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={startRecording}
            disabled={!studentName.trim() || !subject.trim()}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            🎙 녹음 시작
          </button>
        </div>
      )}

      {/* ── 녹음 중 ── */}
      {pageState === "recording" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5 text-center">
          <div className="flex items-center justify-center gap-2 text-red-500 font-medium text-lg">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            녹음 중
          </div>
          <p className="text-4xl font-mono font-bold text-gray-800">{formatTime(elapsedSec)}</p>
          <p className="text-sm text-gray-500">
            {studentName} · {subject}
          </p>
          <button
            onClick={stopAndUpload}
            className="w-full py-3 bg-gray-800 text-white font-medium rounded-xl hover:bg-gray-900 transition"
          >
            수업 종료 및 보고서 생성
          </button>
        </div>
      )}

      {/* ── 업로드 중 ── */}
      {pageState === "uploading" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-600 font-medium">녹음 파일 업로드 중...</p>
        </div>
      )}

      {/* ── 보고서 생성 대기 ── */}
      {pageState === "waiting" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-600 font-medium">수업 내용을 분석하고 있습니다...</p>
          <p className="text-gray-400 text-sm">수업 길이에 따라 수 분이 걸릴 수 있어요</p>
        </div>
      )}

      {/* ── 완료 ── */}
      {pageState === "done" && report && (
        <div className="space-y-5">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-green-700 font-medium">✅ 수업 일지 생성 완료</p>
            <p className="text-green-600 text-sm mt-0.5">{report.student_name} · {report.subject}</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
            <ReportField label="📋 다음 숙제" value={report.homework} />
            <ReportField label="📚 수업 진도" value={report.progress} />
            <ReportField label="📝 수업 내용" value={report.lesson_content} />
          </div>

          <button
            onClick={reset}
            className="w-full py-3 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition text-sm"
          >
            새 수업 일지 작성
          </button>
        </div>
      )}

      {/* ── 에러 ── */}
      {pageState === "error" && (
        <div className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-4">
          <p className="text-red-500">⚠️ {error}</p>
          <button
            onClick={reset}
            className="px-6 py-2 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 transition text-sm"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
