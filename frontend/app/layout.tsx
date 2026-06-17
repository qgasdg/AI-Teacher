import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI 튜터',
  description: 'AI와 함께하는 음성 복습 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <a href="/" className="font-bold text-blue-600 text-lg hover:text-blue-700 transition">AI 튜터</a>
          <div className="flex gap-4 text-sm">
            <a href="/ontact" className="text-gray-600 hover:text-purple-600">온택트 교실</a>
            <a href="/realtime" className="text-gray-600 hover:text-blue-600">실시간 대화</a>
            <a href="/record" className="text-gray-600 hover:text-blue-600">복습 녹음</a>
            <a href="/teacher" className="text-gray-600 hover:text-blue-600">선생님 대시보드</a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
