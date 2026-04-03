# AI Teacher

온택트 교실에서 교사가 자리를 비운 동안 AI가 학생의 복습을 돕고, 대화 내용을 요약해 교사에게 전달하는 서비스입니다.

```
교사 퇴장 → AI 선생님 등장 → 학생과 대화(복습) → 대화 요약 → 교사에게 전달
```

## 단계별 구현 현황

| 단계 | 설명 | 상태 |
|------|------|------|
| Stage 1 | 녹음 → STT → AI 요약 → 교사 대시보드 | 완료 |
| Stage 3 | OpenAI Realtime API 기반 실시간 양방향 대화 | 구현 중 |

---

## 폴더 구조

```
AI-Teacher/
├── backend/                    # Stage 1 백엔드 (FastAPI)
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── routers/
│   │   └── sessions.py         # 업로드/조회 API
│   └── services/
│       ├── stt.py              # OpenAI Whisper STT
│       └── summarizer.py       # Claude 요약
│
├── frontend/                   # Stage 1 프론트엔드 (Next.js)
│   ├── app/
│   │   ├── page.tsx            # 학생 녹음 화면
│   │   └── teacher/page.tsx    # 교사 대시보드
│   ├── components/
│   │   └── AudioRecorder.tsx
│   ├── .env.local.example
│   └── package.json
│
├── stage3-realtime/            # Stage 3 실시간 양방향 대화
│   ├── backend/                # FastAPI + OpenAI Realtime API
│   │   ├── main.py
│   │   ├── routers/
│   │   │   ├── sessions.py
│   │   │   └── realtime.py     # WebSocket 실시간 연동
│   │   └── services/
│   │       ├── openai_realtime.py
│   │       └── summarizer.py
│   └── frontend/               # Next.js 실시간 대화 UI
│       ├── app/
│       ├── components/
│       └── lib/
│
├── SYSTEM_DESIGN.md            # 전체 시스템 설계 및 비용 분석
└── PROGRESS.md                 # 개발 진행 기록
```

---

## 실행 방법

### Stage 1 (녹음 → 요약)

**백엔드**

```bash
cd backend

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# .env에 API 키 입력 후

python main.py
# → http://localhost:8000
```

**프론트엔드**

```bash
cd frontend

npm install

cp .env.local.example .env.local

npm run dev
# → http://localhost:3000
```

| 역할 | URL |
|------|-----|
| 학생 녹음 | http://localhost:3000 |
| 교사 대시보드 | http://localhost:3000/teacher |

---

### Stage 3 (실시간 양방향 대화)

```bash
cd stage3-realtime/backend
# Stage 1 백엔드와 동일한 방식으로 venv 생성 및 실행

cd stage3-realtime/frontend
npm install && npm run dev
```

---

## 환경 변수

### `backend/.env`

```
OPENAI_API_KEY=sk-...           # Whisper STT
ANTHROPIC_API_KEY=sk-ant-...    # Claude 요약
FRONTEND_URL=http://localhost:3000
UPLOAD_DIR=./uploads
```

### `frontend/.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 백엔드 | FastAPI + SQLite (aiosqlite) |
| STT | OpenAI Whisper API |
| 요약 | Anthropic Claude (claude-sonnet-4-6) |
| 실시간 대화 | OpenAI Realtime API + WebSocket |
| 프론트엔드 | Next.js 15 + TypeScript + Tailwind CSS |
