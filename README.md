# AI Teacher

온택트 줌 과외 수업을 보조하는 AI 서비스.
수업 중 학생-선생님 채팅, 자동 녹음, 수업 후 보고서 자동 생성까지 지원합니다.

## 기능

| 기능 | 설명 |
|------|------|
| 온택트 교실 | 줌 수업 중 1:1 채팅, 문제 사진 전송, 수업 자동 녹음 |
| 수업 보고서 | STT(Whisper) → Kimi K2로 수업 진도·근황·내용 자동 생성 |
| 복습 녹음 | 학생이 배운 내용을 혼자 말로 정리 → AI 피드백 |
| 실시간 AI 대화 | OpenAI Realtime API 기반 음성 복습 |
| 수업 일지 | 선생님 수업 녹음 → STT → 숙제·진도·내용 자동 정리 |

## 폴더 구조

```
AI-Teacher/
├── backend/                     # FastAPI (Railway 배포)
│   ├── main.py
│   ├── database.py              # SQLAlchemy + Supabase PostgreSQL
│   ├── models.py                # ai_tutor 스키마 테이블
│   ├── requirements.txt
│   ├── routers/
│   │   ├── ontact.py            # 온택트 교실 WebSocket + REST
│   │   ├── sessions.py          # 실시간 AI 대화 세션
│   │   ├── recordings.py        # 복습 녹음
│   │   ├── lessons.py           # 수업 일지
│   │   └── realtime.py          # OpenAI Realtime 토큰
│   └── services/
│       ├── ontact_reporter.py   # Kimi K2 보고서 생성
│       ├── lesson_reporter.py   # GPT-4o 수업 일지
│       ├── summarizer.py        # 복습 요약
│       ├── audio.py             # webm → wav 변환
│       └── supabase_client.py   # 학생 정보 조회
│
└── frontend/                    # Next.js (Vercel 배포)
    └── app/
        ├── ontact/page.tsx      # 학생 온택트 교실
        ├── realtime/page.tsx    # 실시간 AI 대화
        ├── record/page.tsx      # 복습 녹음
        ├── lesson/page.tsx      # 수업 일지 녹음
        └── teacher/page.tsx     # 선생님 대시보드
```

## 실행

**백엔드**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # API 키 입력
uvicorn main:app --reload --port 8001
```

**프론트엔드**
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

## 환경 변수

### `backend/.env`
```
DATABASE_URL=postgresql://postgres:[pw]@db.[project].supabase.co:5432/postgres
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...       # Kimi K2 보고서 생성
BACKEND_WS_URL=wss://your-app.railway.app
FRONTEND_URL=https://your-app.vercel.app
API_SHARED_SECRET=...
SUPABASE_STUDENT_URL=https://[project].supabase.co
SUPABASE_STUDENT_KEY=...
```

### `frontend/.env.local`
```
API_URL=https://your-app.railway.app
API_SECRET=...
ACCESS_PASSWORD=...
TEACHER_PASSWORD=...
SESSION_SECRET=...
```

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 백엔드 | FastAPI + PostgreSQL (Supabase, ai_tutor 스키마) |
| STT | OpenAI Whisper (gpt-4o-transcribe) |
| 보고서 | Kimi K2 via OpenRouter (온택트), GPT-4o (수업 일지) |
| 실시간 대화 | OpenAI Realtime API |
| 채팅 | FastAPI WebSocket |
| 프론트엔드 | Next.js 15 + TypeScript + Tailwind CSS |
| 배포 | Vercel (프론트) + Railway (백엔드) |

## 온택트 교실 흐름

```
선생님: 대시보드 → 온택트 교실 열기 → 교실 번호 발급
학생:   /ontact → 교실 번호 + 이름 입력 → 입장
            ↓ 자동 녹음 시작 (마이크 + 시스템 오디오*)
       수업 중 채팅 · 문제 사진 전송
            ↓ 나가기 버튼
       오디오 업로드 → STT → Kimi K2 보고서 생성
선생님: 보고서 검토 · 수정 → 최종 저장
```

> *Windows + Chrome에서 화면 공유 허용 시 선생님 목소리(줌 오디오)도 함께 녹음됩니다.
> macOS·iOS·Android는 마이크 단독 녹음.
