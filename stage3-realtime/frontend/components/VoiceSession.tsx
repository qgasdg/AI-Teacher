"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import SpeakingIndicator from "./SpeakingIndicator";
import type { TranscriptEntry } from "@/lib/webrtc";

const SPEED_OPTIONS = [1.0, 1.25, 1.5];

interface VoiceSessionProps {
  status: "connecting" | "connected" | "disconnected";
  transcript: TranscriptEntry[];
  elapsedSeconds: number;
  isRecording: boolean;
  aiSpeaking: boolean;
  onEnd: () => void;
  onToggleRecording: () => void;
  onSpeedChange?: (rate: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function VoiceSession({
  status,
  transcript,
  elapsedSeconds,
  isRecording,
  aiSpeaking,
  onEnd,
  onToggleRecording,
  onSpeedChange,
}: VoiceSessionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [speedIdx, setSpeedIdx] = useState(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // 버튼 라벨 & 스타일 결정
  const canRecord = status === "connected" && !aiSpeaking;

  const getMicButtonLabel = useCallback(() => {
    if (aiSpeaking) return "AI 선생님이 말하는 중...";
    if (isRecording) return "말하기 완료";
    return "🎤 말하기";
  }, [aiSpeaking, isRecording]);

  return (
    <div className="space-y-4">
      {/* 상태 바 */}
      <div className="flex items-center justify-between">
        <SpeakingIndicator status={status} />
        <div className="flex items-center gap-2">
          {onSpeedChange && (
            <button
              onClick={() => {
                const next = (speedIdx + 1) % SPEED_OPTIONS.length;
                setSpeedIdx(next);
                onSpeedChange(SPEED_OPTIONS[next]);
              }}
              className="text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 rounded px-1.5 py-0.5 transition"
            >
              {SPEED_OPTIONS[speedIdx]}x
            </button>
          )}
          <span className="text-sm text-gray-500 font-mono">
            {formatTime(elapsedSeconds)}
          </span>
        </div>
      </div>

      {/* 대화 내용 */}
      <div
        ref={scrollRef}
        className="h-80 overflow-y-auto border border-gray-200 rounded-xl bg-white p-4 space-y-3"
      >
        {transcript.length === 0 && status === "connected" && (
          <p className="text-gray-400 text-sm text-center mt-8">
            말하기 버튼을 눌러 선생님께 인사의 말을 건네보세요!
          </p>
        )}
        {transcript.map((entry, i) => (
          <div
            key={i}
            className={`flex ${
              entry.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                entry.role === "user"
                  ? "bg-blue-600 text-white rounded-br-md"
                  : "bg-gray-100 text-gray-800 rounded-bl-md"
              }`}
            >
              <p className="text-xs font-medium mb-1 opacity-70">
                {entry.role === "user" ? "나" : "AI 선생님"}
              </p>
              {entry.text}
            </div>
          </div>
        ))}
      </div>

      {/* 안내 텍스트 */}
      {aiSpeaking && (
        <p className="text-center text-sm text-gray-400">
          AI 선생님이 말하고 있어요. 끝나면 말하기 버튼을 눌러주세요.
        </p>
      )}
      {!aiSpeaking && !isRecording && status === "connected" && transcript.length > 0 && (
        <p className="text-center text-sm text-gray-400">
          아래 말하기 버튼을 누르고 대답해주세요.
        </p>
      )}

      {/* PTT 버튼 */}
      <button
        onClick={onToggleRecording}
        disabled={!canRecord}
        className={`w-full py-4 font-medium rounded-xl text-lg transition ${
          isRecording
            ? "bg-orange-500 text-white hover:bg-orange-600 animate-pulse"
            : canRecord
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-gray-200 text-gray-400 cursor-not-allowed"
        }`}
      >
        {getMicButtonLabel()}
      </button>

      {/* 종료 버튼 */}
      <button
        onClick={onEnd}
        disabled={status !== "connected"}
        className="w-full py-3 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
      >
        대화 종료
      </button>
    </div>
  );
}
