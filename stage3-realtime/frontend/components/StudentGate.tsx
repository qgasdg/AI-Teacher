'use client'

import { useState } from 'react'
import { useStudentIdentity, type StudentIdentity } from '@/hooks/useStudentIdentity'

const GRADE_GROUPS = [
  { label: '초등', grades: ['초1', '초2', '초3', '초4', '초5', '초6'] },
  { label: '중학', grades: ['중1', '중2', '중3'] },
  { label: '고등', grades: ['고1', '고2', '고3'] },
  { label: '기타', grades: ['재수', 'N수'] },
]

interface Props {
  children: (student: StudentIdentity) => React.ReactNode
}

function GradeToggle({
  value,
  onChange,
}: {
  value: string
  onChange: (g: string) => void
}) {
  return (
    <div className="space-y-2">
      {GRADE_GROUPS.map(({ label, grades }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8 shrink-0">{label}</span>
          <div className="flex flex-wrap gap-1.5">
            {grades.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onChange(g)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition
                  ${value === g
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StudentForm({ onConfirm }: { onConfirm: (s: StudentIdentity) => void }) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() && grade) onConfirm({ name: name.trim(), grade })
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm space-y-6"
      >
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-800">학생 정보 입력</h2>
          <p className="text-xs text-gray-400 mt-1">한 번만 입력하면 이후엔 자동으로 유지돼요</p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">학년</label>
          <GradeToggle value={grade} onChange={setGrade} />
        </div>

        <button
          type="submit"
          disabled={!name.trim() || !grade}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          확인
        </button>
      </form>
    </div>
  )
}

export default function StudentGate({ children }: Props) {
  const { student, setStudent, clearStudent, loaded } = useStudentIdentity()
  const [editing, setEditing] = useState(false)

  if (!loaded) return null

  if (!student || editing) {
    return (
      <StudentForm
        onConfirm={(s) => {
          setStudent(s)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div>
      {/* 학생 정보 배지 */}
      <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400">학생</span>
          <span className="font-semibold text-blue-800 text-sm">{student.name}</span>
          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{student.grade}</span>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-blue-400 hover:text-blue-600 transition"
        >
          변경
        </button>
      </div>

      {children(student)}
    </div>
  )
}
