"use client";

import ReactMarkdown from "react-markdown";

interface SessionSummaryProps {
  summary: string;
  studentName: string;
  subject: string;
  duration: number | null;
  onNewSession: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

export default function SessionSummary({
  summary,
  studentName,
  subject,
  duration,
  onNewSession,
}: SessionSummaryProps) {
  return (
    <div className="space-y-5">
      <div className="bg-green-50 border border-green-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="w-5 h-5 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-medium text-green-800">대화 완료</span>
        </div>
        <div className="text-sm text-green-700 space-y-1">
          <p>
            <span className="font-medium">학생:</span> {studentName}
          </p>
          <p>
            <span className="font-medium">과목:</span> {subject}
          </p>
          {duration && (
            <p>
              <span className="font-medium">대화 시간:</span>{" "}
              {formatDuration(duration)}
            </p>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-medium text-gray-800 mb-3">AI 복습 요약</h3>
        <div className="text-sm text-gray-700 leading-relaxed">
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h1 className="text-base font-bold text-gray-800 mt-4 mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="text-sm font-bold text-gray-800 mt-3 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 mt-2 mb-0.5">{children}</h3>,
              strong: ({ children }) => <strong className="font-semibold text-gray-800">{children}</strong>,
              ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
              li: ({ children }) => <li className="ml-2">{children}</li>,
              p: ({ children }) => <p className="mb-1.5">{children}</p>,
              hr: () => <hr className="my-3 border-gray-200" />,
            }}
          >
            {summary}
          </ReactMarkdown>
        </div>
      </div>

      <button
        onClick={onNewSession}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
      >
        새 대화 시작
      </button>
    </div>
  );
}
