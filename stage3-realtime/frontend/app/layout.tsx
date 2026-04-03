import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI 선생님 | 실시간 대화',
  description: '실시간 음성 대화 AI 복습 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <span className="font-bold text-blue-600 text-lg">AI 선생님 (실시간)</span>
          <div className="flex gap-4 text-sm">
            <a href="/" className="text-gray-600 hover:text-blue-600">실시간 대화</a>
            <a href="/teacher" className="text-gray-600 hover:text-blue-600">선생님 대시보드</a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
