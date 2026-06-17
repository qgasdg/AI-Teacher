"use client";

import { useState } from "react";

interface SessionFormProps {
  studentName: string
  onSubmit: (subject: string) => void;
  loading: boolean;
}

export default function SessionForm({ studentName, onSubmit, loading }: SessionFormProps) {
  const [subject, setSubject] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (subject.trim()) {
      onSubmit(subject.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          오늘 배운 과목 / 주제
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="예: 수학 - 이차방정식"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-800"
          required
          disabled={loading}
          autoFocus
        />
      </div>
      <button
        type="submit"
        disabled={loading || !subject.trim()}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
      >
        {loading ? "연결 중..." : `${studentName}님, AI 튜터와 대화 시작`}
      </button>
    </form>
  );
}
