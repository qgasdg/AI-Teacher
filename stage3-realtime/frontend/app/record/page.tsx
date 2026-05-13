'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import StudentGate from '@/components/StudentGate'
import type { StudentIdentity } from '@/hooks/useStudentIdentity'

const ACCESS_PASSWORD = process.env.NEXT_PUBLIC_ACCESS_PASSWORD || ''
const ACCESS_AUTH_KEY = 'access_authed'

type PageState = 'form' | 'recording' | 'uploading' | 'done' | 'error'

function AccessGate({ onAuth }: { onAuth: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input === ACCESS_PASSWORD) {
      sessionStorage.setItem(ACCESS_AUTH_KEY, '1')
      onAuth()
    } else {
      setError(true)
      setInput('')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm space-y-4"
      >
        <h1 className="text-lg font-bold text-gray-800 text-center">복습 녹음</h1>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="비밀번호를 입력하세요"
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
  )
}

function RecordForm({ student }: { student: StudentIdentity }) {
  const [pageState, setPageState] = useState<PageState>('form')
  const [question, setQuestion] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [elapsedSec, setElapsedSec] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      mr.start()
      mediaRecorderRef.current = mr
      setIsRecording(true)
      setElapsedSec(0)
      setPageState('recording')

      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    } catch {
      setError('마이크 접근 권한이 필요합니다.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
    setPageState('form')
  }, [])

  const handleSubmit = async () => {
    if (!audioBlob || !question.trim()) return
    setPageState('uploading')
    setError('')

    const formData = new FormData()
    formData.append('student_name', `${student.name} (${student.grade})`)
    formData.append('question_number', question.trim())
    formData.append('audio', audioBlob, 'recording.webm')

    try {
      const res = await apiFetch('/recordings/', { method: 'POST', body: formData })
      if (!res.ok) throw new Error(`서버 오류: ${res.status}`)
      await res.json()
      setPageState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
      setPageState('error')
    }
  }

  const reset = () => {
    setPageState('form')
    setAudioBlob(null)
    setError('')
    setElapsedSec(0)
    setQuestion('')
  }

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (pageState === 'uploading') {
    return <StatusCard title="전송 중..." desc="녹음 파일을 업로드하고 있어요." spinner />
  }

  if (pageState === 'done') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
        <div className="text-center">
          <span className="text-4xl">✅</span>
          <h2 className="text-xl font-bold text-gray-800 mt-2">전송 완료!</h2>
          <p className="text-gray-500 text-sm">
            {student.name}님의 복습 녹음이 선생님께 전달되었어요.
          </p>
        </div>
        <button
          onClick={reset}
          className="w-full border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition text-sm"
        >
          다른 내용 녹음하기
        </button>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 text-center">
        <span className="text-4xl">⚠️</span>
        <h2 className="text-xl font-bold text-gray-800 mt-2">오류 발생</h2>
        <p className="text-red-500 text-sm mt-1">{error}</p>
        <button
          onClick={reset}
          className="mt-4 px-6 py-2 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200 transition text-sm"
        >
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-5">
      {/* 학습 주제 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">학습 주제</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 수학 - 이차방정식, 영어 본문 3과"
          disabled={isRecording}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      {/* 녹음 컨트롤 */}
      <div className="border-t pt-4 flex flex-col items-center gap-3">
        {isRecording ? (
          <>
            <div className="flex items-center gap-2 text-red-500 font-medium">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              녹음 중 — {formatTime(elapsedSec)}
            </div>
            <button
              onClick={stopRecording}
              className="w-full py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition"
            >
              녹음 중지
            </button>
          </>
        ) : (
          <button
            onClick={startRecording}
            disabled={!question.trim()}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            녹음 시작
          </button>
        )}

        {audioBlob && !isRecording && (
          <div className="w-full bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 text-center">
            녹음 완료 ({formatTime(elapsedSec)}) — 아래 버튼으로 전송하세요
          </div>
        )}
      </div>

      {error && <p className="text-red-500 text-sm text-center">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!audioBlob || !question.trim() || isRecording}
        className="w-full bg-gray-800 text-white py-3 rounded-xl font-medium hover:bg-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        선생님께 전송
      </button>
    </div>
  )
}

export default function RecordPage() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    if (!ACCESS_PASSWORD || sessionStorage.getItem(ACCESS_AUTH_KEY) === '1') {
      setAuthed(true)
    }
  }, [])

  if (!authed) return <AccessGate onAuth={() => setAuthed(true)} />

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">복습 녹음 제출</h1>
        <p className="text-gray-500 text-sm mt-1">오늘 배운 내용을 자신의 말로 설명하고 녹음해 주세요</p>
      </div>

      <StudentGate>
        {(student) => <RecordForm student={student} />}
      </StudentGate>
    </div>
  )
}

function StatusCard({ title, desc, spinner }: { title: string; desc: string; spinner?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
      <h2 className="text-xl font-bold text-gray-800">{title}</h2>
      <p className="text-gray-500 text-sm mt-1">{desc}</p>
      {spinner && (
        <div className="mt-5 flex justify-center">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
