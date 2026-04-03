'use client'

import { useEffect, useState } from 'react'

interface Session {
  id: number
  student_name: string
  teacher_name: string
  subject: string
  status: string
  transcript: string | null
  summary: string | null
  created_at: string
  completed_at: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:    { label: '대기 중',   color: 'bg-gray-100 text-gray-600' },
  processing: { label: '분석 중',   color: 'bg-yellow-100 text-yellow-700' },
  completed:  { label: '완료',     color: 'bg-green-100 text-green-700' },
  failed:     { label: '오류',     color: 'bg-red-100 text-red-600' },
}

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filterTeacher, setFilterTeacher] = useState('')

  const fetchSessions = async () => {
    const url = filterTeacher
      ? `${API_URL}/sessions/?teacher_name=${encodeURIComponent(filterTeacher)}`
      : `${API_URL}/sessions/`
    const res = await fetch(url)
    const data = await res.json()
    setSessions(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 5000)
    return () => clearInterval(interval)
  }, [filterTeacher])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('ko-KR', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">선생님 대시보드</h1>
          <p className="text-gray-500 text-sm mt-0.5">학생 복습 현황을 확인하세요</p>
        </div>
        <button onClick={fetchSessions}
          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
          <RefreshIcon /> 새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="mb-4">
        <input
          type="text"
          value={filterTeacher}
          onChange={(e) => setFilterTeacher(e.target.value)}
          placeholder="선생님 이름으로 필터..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 w-64"
        />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-3">📭</p>
          <p>아직 복습 세션이 없습니다.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((session) => {
            const st = STATUS_LABEL[session.status] ?? STATUS_LABEL.pending
            const isOpen = expanded === session.id

            return (
              <div key={session.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* 헤더 */}
                <button
                  onClick={() => setExpanded(isOpen ? null : session.id)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{session.student_name}</span>
                        <span className="text-gray-400 text-sm">|</span>
                        <span className="text-gray-600 text-sm">{session.subject}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(session.created_at)} · 담당: {session.teacher_name}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                      {st.label}
                    </span>
                    <ChevronIcon open={isOpen} />
                  </div>
                </button>

                {/* 내용 (펼침) */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4 flex flex-col gap-4">
                    {session.summary && (
                      <div>
                        <p className="text-xs font-semibold text-blue-500 mb-1.5">AI 요약 보고서</p>
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                            {session.summary}
                          </p>
                        </div>
                      </div>
                    )}

                    {session.transcript && (
                      <div>
                        <p className="text-xs font-semibold text-gray-400 mb-1.5">원본 녹음 텍스트</p>
                        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                          <p className="text-sm text-gray-500 whitespace-pre-wrap leading-relaxed">
                            {session.transcript}
                          </p>
                        </div>
                      </div>
                    )}

                    {session.status === 'processing' && (
                      <div className="flex items-center gap-2 text-yellow-600 text-sm">
                        <div className="w-4 h-4 border-2 border-yellow-300 border-t-yellow-600 rounded-full animate-spin" />
                        AI가 분석 중입니다...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 통계 */}
      {sessions.length > 0 && (
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: '전체', value: sessions.length, color: 'text-gray-700' },
            { label: '완료', value: sessions.filter((s) => s.status === 'completed').length, color: 'text-green-600' },
            { label: '처리 중', value: sessions.filter((s) => s.status === 'processing' || s.status === 'pending').length, color: 'text-yellow-600' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-100 rounded-xl p-4 text-center shadow-sm">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
