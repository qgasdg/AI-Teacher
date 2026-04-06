# AI Teacher

온택트 교실에서 교사가 자리를 비운 동안 AI가 학생의 복습을 돕고, 대화 내용을 요약해 교사에게 전달하는 서비스입니다.

```
교사 퇴장 → AI 선생님 등장 → 학생과 대화(복습) → 대화 요약 → 교사에게 전달
```

## 단계별 구현 현황

| 단계 | 설명 | 상태 |
|------|------|------|
| Stage 1 | 녹음 → STT → AI 요약 → 교사 대시보드 | 완료 |
| Stage 3 | OpenAI Realtime API 기반 실시간 양방향 대화 (PTT + 독려 타이머) | 구현 중 |

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
│   │       ├── openai_realtime.py  # turn_detection: None (서버 VAD 비활성화)
│   │       └── summarizer.py
│   └── frontend/               # Next.js 실시간 대화 UI
│       ├── app/
│       │   └── page.tsx            # PTT 상태 관리 + 30초 독려 타이머
│       ├── components/
│       │   └── VoiceSession.tsx    # PTT 버튼 UI (녹음/대기/AI발화 상태)
│       └── lib/
│           └── webrtc.ts           # 마이크 제어 + 오디오 커밋 + 독려 메시지
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

## Stage 3 대화 흐름 (PTT 방식)

서버 VAD를 비활성화하고, 학생이 직접 **Push-to-Talk(PTT) 버튼**으로 발화를 제어합니다.

```
AI 인사 → AI 말 끝남 → [학생 대기]
                         ├─ 학생이 "말하기" 누름 → 녹음 중 → "말하기 완료" 누름 → AI 응답
                         └─ 30초 경과 → AI: "자, 이제 좀 생각해본 것 같은데 한번 얘기해볼까?"
```

### 주요 기능

| 기능 | 설명 |
|------|------|
| PTT 버튼 | "말하기" ↔ "말하기 완료" 토글, AI 발화 중 비활성화 (회색) |
| 녹음 표시 | 녹음 중 주황색 + pulse 애니메이션 |
| 독려 타이머 | AI 발화 종료 후 30초간 학생 무응답 시 자동 독려 메시지 |
| 서버 VAD 비활성화 | `turn_detection: None` — AI가 임의로 끼어들지 않음 |
| 마이크 제어 | 기본 음소거, `setMicEnabled()` / `commitAudioAndRespond()` |
| AI 발화 감지 | `onAiSpeakingChange` 콜백으로 AI 말하기 시작/종료 감지 |

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
