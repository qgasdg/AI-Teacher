"use client";

import { useState } from "react";

interface SessionFormProps {
  onSubmit: (studentName: string, subject: string) => void;
  loading: boolean;
}

export default function SessionForm({ onSubmit, loading }: SessionFormProps) {
  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (studentName.trim() && subject.trim()) {
      onSubmit(studentName.trim(), subject.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          학생 이름
        </label>
        <input
          type="text"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          placeholder="이름을 입력하세요"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-800"
          required
          disabled={loading}
        />
      </div>
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
        />
      </div>
      <button
        type="submit"
        disabled={loading || !studentName.trim() || !subject.trim()}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
      >
        {loading ? "연결 중..." : "AI 선생님과 대화 시작"}
      </button>
    </form>
  );
}
