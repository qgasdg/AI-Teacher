"use client";

interface SpeakingIndicatorProps {
  status: "connecting" | "connected" | "disconnected";
}

export default function SpeakingIndicator({ status }: SpeakingIndicatorProps) {
  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2 text-yellow-600">
        <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-sm font-medium">연결 중...</span>
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <div className="w-3 h-3 rounded-full bg-gray-400" />
        <span className="text-sm font-medium">연결 종료됨</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-green-600">
      <div className="relative flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-green-500" />
        <div className="absolute w-3 h-3 rounded-full bg-green-500 animate-ping" />
      </div>
      <span className="text-sm font-medium">대화 중</span>
    </div>
  );
}
