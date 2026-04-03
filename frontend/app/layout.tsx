import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI 선생님 | 온택트 교실',
  description: '학생 복습 보조 AI 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <span className="font-bold text-blue-600 text-lg">AI 선생님</span>
          <div className="flex gap-4 text-sm">
            <a href="/" className="text-gray-600 hover:text-blue-600">학생 복습</a>
            <a href="/teacher" className="text-gray-600 hover:text-blue-600">선생님 대시보드</a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
