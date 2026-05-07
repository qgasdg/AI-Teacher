"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import SessionForm from "@/components/SessionForm";
import VoiceSession from "@/components/VoiceSession";
import SessionSummary from "@/components/SessionSummary";
import { startWebRTC, type TranscriptEntry, type WebRTCSession } from "@/lib/webrtc";
import { apiFetch, API_URL as API } from "@/lib/api";

const ACCESS_PASSWORD = process.env.NEXT_PUBLIC_ACCESS_PASSWORD || "";
const ACCESS_AUTH_KEY = "access_authed";

type PageState = "form" | "connecting" | "conversation" | "ending" | "done" | "error";

const NUDGE_TIMEOUT_MS = 30_000; // 30초 후 독려

function AccessGate({ onAuth }: { onAuth: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === ACCESS_PASSWORD) {
      sessionStorage.setItem(ACCESS_AUTH_KEY, "1");
      onAuth();
    } else {
      setError(true);
      setInput("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm space-y-4"
      >
        <h1 className="text-lg font-bold text-gray-800 text-center">AI 선생님</h1>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="비밀번호를 입력하세요"
          className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        {error && (
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

export default function StudentPage() {
  const [authed, setAuthed] = useState(false);
  const [pageState, setPageState] = useState<PageState>("form");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [summary, setSummary] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const webrtcRef = useRef<WebRTCSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ACCESS_PASSWORD || sessionStorage.getItem(ACCESS_AUTH_KEY) === "1") {
      setAuthed(true);
    }
  }, []);

  // 탭 닫힘 감지: active 세션을 best-effort로 abandoned 처리
  // (sendBeacon은 페이지 unload 중에도 안정적으로 전송됨)
  // visibilitychange는 단순 탭 전환에도 발생해서 false positive 위험 — 사용 안 함
  // 모바일 강제 종료 등 잡히지 않는 케이스는 백엔드의 2시간 타임아웃으로 정리됨
  useEffect(() => {
    if (!sessionId || pageState !== "conversation") return;

    const onBeforeUnload = () => {
      try {
        navigator.sendBeacon(`${API}/sessions/${sessionId}/abandon`);
      } catch {
        // 실패해도 무시 — 백엔드 타임아웃으로 자동 정리됨
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sessionId, pageState]);

  // 경과 타이머
  useEffect(() => {
    if (pageState === "conversation") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pageState]);

  // 독려 타이머: AI가 말 끝낸 후 30초 동안 학생 반응 없으면 독려
  const resetNudgeTimer = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = null;
  }, []);

  const startNudgeTimer = useCallback(() => {
    resetNudgeTimer();
    nudgeTimerRef.current = setTimeout(() => {
      if (webrtcRef.current) {
        webrtcRef.current.nudgeStudent();
      }
    }, NUDGE_TIMEOUT_MS);
  }, [resetNudgeTimer]);

  // AI 말하기 상태 변경 처리
  const handleAiSpeakingChange = useCallback((speaking: boolean) => {
    setAiSpeaking(speaking);
    if (!speaking) {
      // AI가 말 끝남 → 독려 타이머 시작
      startNudgeTimer();
    } else {
      // AI가 말하는 중 → 독려 타이머 리셋
      resetNudgeTimer();
    }
  }, [startNudgeTimer, resetNudgeTimer]);

  // PTT 토글
  const handleToggleRecording = useCallback(() => {
    if (!webrtcRef.current) return;

    if (isRecording) {
      // 녹음 종료 → 마이크 off + 오디오 커밋 + AI 응답 요청
      webrtcRef.current.setMicEnabled(false);
      webrtcRef.current.commitAudioAndRespond();
      setIsRecording(false);
      resetNudgeTimer();
    } else {
      // 녹음 시작 → AI 응답 중단 + 마이크 on
      webrtcRef.current.cancelAiResponse();
      webrtcRef.current.setMicEnabled(true);
      setIsRecording(true);
      setAiSpeaking(false);
      resetNudgeTimer();
    }
  }, [isRecording, resetNudgeTimer]);

  // 대화 시작
  const handleStart = useCallback(async (name: string, subj: string) => {
    setStudentName(name);
    setSubject(subj);
    setTranscript([]);
    setElapsedSeconds(0);
    setIsRecording(false);
    setAiSpeaking(false);
    setPageState("connecting");

    try {
      // 1. 세션 생성
      const sessionRes = await apiFetch(`/sessions/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_name: name, subject: subj }),
      });

      if (!sessionRes.ok) throw new Error("세션 생성 실패");
      const sessionData = await sessionRes.json();
      setSessionId(sessionData.id);

      // 2. 임시 키 발급
      const tokenRes = await apiFetch(`/api/session/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionData.id }),
      });

      if (!tokenRes.ok) throw new Error("임시 키 발급 실패");
      const tokenData = await tokenRes.json();

      // 3. WebRTC 연결
      const session = await startWebRTC(tokenData.client_secret, {
        onConnected: () => setPageState("conversation"),
        onTranscript: (entries) => setTranscript(entries),
        onError: (error) => {
          setErrorMsg(error);
          setPageState("error");
        },
        onDisconnected: () => {
          // 의도적 종료가 아닌 경우만 처리
        },
        onAiSpeakingChange: handleAiSpeakingChange,
      });

      webrtcRef.current = session;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "연결에 실패했습니다");
      setPageState("error");
    }
  }, [handleAiSpeakingChange]);

  // 대화 종료
  const handleEnd = useCallback(async () => {
    resetNudgeTimer();

    // 녹음 데이터 먼저 가져오기 (disconnect 전에)
    let audioBlob: Blob | null = null;
    if (webrtcRef.current) {
      audioBlob = await webrtcRef.current.getRecordingBlob();
      webrtcRef.current.disconnect();
      webrtcRef.current = null;
    }

    if (!sessionId) return;
    setPageState("ending");

    // 트랜스크립트를 텍스트로 변환
    const transcriptText = transcript
      .map((e) => `${e.role === "user" ? "학생" : "AI 선생님"}: ${e.text}`)
      .join("\n");

    try {
      // 세션 종료 + 트랜스크립트 + 오디오 전송 (multipart/form-data)
      const formData = new FormData();
      formData.append("transcript", transcriptText);
      formData.append("duration_seconds", String(elapsedSeconds));
      if (audioBlob) {
        formData.append("audio", audioBlob, "session-audio.webm");
      }

      await apiFetch(`/sessions/${sessionId}/end`, {
        method: "POST",
        body: formData,
      });

      // 요약 생성 완료 대기 (폴링)
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await apiFetch(`/sessions/${sessionId}`);
        const data = await res.json();

        if (data.status === "completed") {
          setSummary(data.summary);
          setPageState("done");
          return;
        }
        if (data.status === "failed") {
          setErrorMsg(data.summary || "요약 생성에 실패했습니다");
          setPageState("error");
          return;
        }
      }

      setErrorMsg("요약 생성 시간이 초과되었습니다");
      setPageState("error");
    } catch {
      setErrorMsg("세션 종료 중 오류가 발생했습니다");
      setPageState("error");
    }
  }, [sessionId, transcript, elapsedSeconds, resetNudgeTimer]);

  // 새 세션
  const handleNewSession = () => {
    setPageState("form");
    setSessionId(null);
    setTranscript([]);
    setSummary("");
    setErrorMsg("");
    setElapsedSeconds(0);
    setIsRecording(false);
    setAiSpeaking(false);
  };

  if (!authed) {
    return <AccessGate onAuth={() => setAuthed(true)} />;
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        {/* 제목 */}
        <h1 className="text-xl font-bold text-gray-800 mb-6">
          {pageState === "form" && "AI 선생님과 복습하기"}
          {pageState === "connecting" && "연결 중..."}
          {pageState === "conversation" && "AI 선생님과 대화 중"}
          {pageState === "ending" && "요약 생성 중..."}
          {pageState === "done" && "복습 완료"}
          {pageState === "error" && "오류 발생"}
        </h1>

        {/* Form */}
        {pageState === "form" && (
          <SessionForm onSubmit={handleStart} loading={false} />
        )}

        {/* Connecting */}
        {pageState === "connecting" && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 text-sm">
              AI 선생님에게 연결하고 있습니다...
            </p>
          </div>
        )}

        {/* Conversation */}
        {pageState === "conversation" && (
          <VoiceSession
            status="connected"
            transcript={transcript}
            elapsedSeconds={elapsedSeconds}
            isRecording={isRecording}
            aiSpeaking={aiSpeaking}
            onEnd={handleEnd}
            onToggleRecording={handleToggleRecording}
          />
        )}

        {/* Ending */}
        {pageState === "ending" && (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 text-sm">
              대화 내용을 요약하고 있습니다...
            </p>
          </div>
        )}

        {/* Done */}
        {pageState === "done" && (
          <SessionSummary
            summary={summary}
            studentName={studentName}
            subject={subject}
            duration={elapsedSeconds}
            onNewSession={handleNewSession}
          />
        )}

        {/* Error */}
        {pageState === "error" && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-700 text-sm">{errorMsg}</p>
            </div>
            <button
              onClick={handleNewSession}
              className="w-full py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition"
            >
              다시 시작
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
