'use client'

import { useState, useCallback } from 'react'
import AudioRecorder from '@/components/AudioRecorder'

type PageState = 'form' | 'recording' | 'uploading' | 'processing' | 'done' | 'error'

interface SessionResult {
  id: number
  summary: string | null
  transcript: string | null
  status: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function StudentPage() {
  const [pageState, setPageState] = useState<PageState>('form')
  const [studentName, setStudentName] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [subject, setSubject] = useState('')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [error, setError] = useState('')

  const handleAudioReady = useCallback((blob: Blob) => {
    setAudioBlob(blob)
  }, [])

  const handleSubmit = async () => {
    if (!audioBlob) {
      setError('먼저 복습 내용을 녹음해주세요.')
      return
    }

    setPageState('uploading')
    setError('')

    const formData = new FormData()
    formData.append('student_name', studentName)
    formData.append('teacher_name', teacherName)
    formData.append('subject', subject)
    formData.append('audio', audioBlob, 'recording.webm')

    try {
      const res = await fetch(`${API_URL}/sessions/`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error(`서버 오류: ${res.status}`)

      const session = await res.json()
      setPageState('processing')

      // 완료될 때까지 폴링 (2초 간격)
      await pollUntilDone(session.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
      setPageState('error')
    }
  }

  const pollUntilDone = async (sessionId: number) => {
    const MAX_WAIT = 120 // 최대 120초
    let waited = 0

    while (waited < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, 2000))
      waited += 2

      const res = await fetch(`${API_URL}/sessions/${sessionId}`)
      const session = await res.json()

      if (session.status === 'completed') {
        setResult(session)
        setPageState('done')
        return
      }

      if (session.status === 'failed') {
        setError(session.summary || '처리 중 오류가 발생했습니다.')
        setPageState('error')
        return
      }
    }

    setError('처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.')
    setPageState('error')
  }

  const reset = () => {
    setPageState('form')
    setAudioBlob(null)
    setResult(null)
    setError('')
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">AI 선생님과 복습하기</h1>
        <p className="text-gray-500 text-sm mt-1">
          오늘 배운 내용을 자신의 말로 설명해보세요
        </p>
      </div>

      {/* 입력 폼 */}
      {(pageState === 'form' || pageState === 'recording') && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="학생 이름" value={studentName} onChange={setStudentName}
              placeholder="홍길동" disabled={pageState === 'recording'} />
            <Field label="선생님 이름" value={teacherName} onChange={setTeacherName}
              placeholder="김선생님" disabled={pageState === 'recording'} />
          </div>
          <Field label="오늘 배운 과목/주제" value={subject} onChange={setSubject}
            placeholder="예: 수학 - 이차방정식" disabled={pageState === 'recording'} />

          <div className="border-t pt-4">
            <p className="text-sm text-gray-500 mb-3 text-center">
              아래 버튼을 눌러 오늘 배운 내용을 자유롭게 이야기해주세요
            </p>
            <AudioRecorder onAudioReady={handleAudioReady} />
          </div>

          {audioBlob && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
              녹음 완료! 아래 버튼으로 선생님께 전송하세요.
            </div>
          )}

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!audioBlob || !studentName || !teacherName || !subject}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            선생님께 전송
          </button>
        </div>
      )}

      {/* 업로드 중 */}
      {pageState === 'uploading' && (
        <StatusCard icon="⬆️" title="전송 중..." desc="녹음 파일을 업로드하고 있어요." />
      )}

      {/* 처리 중 */}
      {pageState === 'processing' && (
        <StatusCard icon="🤖" title="AI가 분석 중..." desc="복습 내용을 정리하고 요약을 작성하고 있어요. 잠시만 기다려주세요." spinner />
      )}

      {/* 완료 */}
      {pageState === 'done' && result && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
          <div className="text-center">
            <span className="text-4xl">✅</span>
            <h2 className="text-xl font-bold text-gray-800 mt-2">복습 완료!</h2>
            <p className="text-gray-500 text-sm">선생님께 요약이 전달되었어요.</p>
          </div>

          {result.summary && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs text-blue-500 font-medium mb-2">AI 요약 미리보기</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {result.summary}
              </p>
            </div>
          )}

          <button onClick={reset}
            className="w-full border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition text-sm">
            새로운 복습 시작
          </button>
        </div>
      )}

      {/* 오류 */}
      {pageState === 'error' && (
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 text-center">
          <span className="text-4xl">⚠️</span>
          <h2 className="text-xl font-bold text-gray-800 mt-2">오류 발생</h2>
          <p className="text-red-500 text-sm mt-1">{error}</p>
          <button onClick={reset}
            className="mt-4 px-6 py-2 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 transition text-sm">
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  )
}

function StatusCard({ icon, title, desc, spinner }: {
  icon: string; title: string; desc: string; spinner?: boolean
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
      <span className="text-5xl">{icon}</span>
      <h2 className="text-xl font-bold text-gray-800 mt-3">{title}</h2>
      <p className="text-gray-500 text-sm mt-1">{desc}</p>
      {spinner && (
        <div className="mt-5 flex justify-center">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
