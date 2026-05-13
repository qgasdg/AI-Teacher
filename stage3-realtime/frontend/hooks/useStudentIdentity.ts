'use client'

import { useState, useEffect } from 'react'

export interface StudentIdentity {
  name: string
  grade: string
}

const STORAGE_KEY = 'student_identity'

export function useStudentIdentity() {
  const [student, setStudentState] = useState<StudentIdentity | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) setStudentState(JSON.parse(raw))
    } catch {}
    setLoaded(true)
  }, [])

  const setStudent = (s: StudentIdentity) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    setStudentState(s)
  }

  const clearStudent = () => {
    sessionStorage.removeItem(STORAGE_KEY)
    setStudentState(null)
  }

  return { student, setStudent, clearStudent, loaded }
}
