import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-800">AI 튜터</h1>
        <p className="text-gray-500 mt-2">오늘 배운 내용을 AI와 함께 복습하세요</p>
      </div>

      <div className="grid gap-5">
        {/* 온택트 교실 */}
        <Link href="/ontact" className="group block bg-white border border-gray-200 rounded-2xl p-6 hover:border-purple-300 hover:shadow-sm transition">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-purple-100 transition">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">온택트 교실</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                줌 수업 중 선생님과 1:1 채팅. 모르는 문제는 사진으로 바로 전송.
                수업 종료 후 AI가 보고서를 자동 생성합니다.
              </p>
              <span className="inline-block mt-3 text-xs font-medium text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full">채팅 · 녹음 · 보고서</span>
            </div>
          </div>
        </Link>

        {/* 실시간 대화 */}
        <Link href="/realtime" className="group block bg-white border border-gray-200 rounded-2xl p-6 hover:border-blue-300 hover:shadow-sm transition">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">실시간 대화</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                AI 튜터와 음성으로 직접 대화하며 복습합니다. 오늘 배운 내용을 말로 설명해보고,
                부족한 부분은 AI의 질문과 피드백으로 채워나갑니다.
              </p>
              <span className="inline-block mt-3 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">음성 · 실시간</span>
            </div>
          </div>
        </Link>

        {/* 복습 녹음 */}
        <Link href="/record" className="group block bg-white border border-gray-200 rounded-2xl p-6 hover:border-green-300 hover:shadow-sm transition">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-green-100 transition">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">복습 녹음</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                배운 내용을 혼자 말로 정리하고 녹음해 선생님께 제출합니다. AI가 자동으로
                전사하여 선생님이 학생의 이해도를 빠르게 파악할 수 있습니다.
              </p>
              <span className="inline-block mt-3 text-xs font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full">녹음 · 제출</span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}
