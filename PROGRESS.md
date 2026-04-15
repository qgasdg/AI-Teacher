# 개발 진행 기록

> 마지막 업데이트: 2026-04-16

---

## 완료된 작업

### 4. Stage 3 프로덕션 배포 완료 (2026-04-16)

#### 배포 플랫폼
- **프론트엔드**: Vercel (`https://ai-teacher-indol.vercel.app`)
- **백엔드**: Railway (`https://ai-teacher-production-d78f.up.railway.app`)
- **DB**: Railway PostgreSQL (영구 저장, 재배포해도 데이터 유지)

#### 배포 과정 트러블슈팅
| 문제 | 원인 | 해결 |
|------|------|------|
| Vercel 배포 실패 | `next start -p 3001` 포트 하드코딩 | `next start`로 변경 |
| CORS 400 Bad Request | `allow_origins` 특정 URL → 불일치 | `allow_origins=["*"]`로 변경 |
| DB 연결 실패 | Railway가 `postgres://` 형식 제공 | `postgres://` → `postgresql+asyncpg://` 변환 추가 |
| API 키 에러 | Railway 환경변수 붙여넣기 시 줄바꿈 삽입 | 키 재입력 |
| Greenlet 없음 | venv 재생성 후 누락 | `pip install greenlet` + requirements.txt 추가 |

#### 보안
- 메인 페이지(`/`)에 비밀번호 게이트 추가 (`NEXT_PUBLIC_ACCESS_PASSWORD`)
- 교사 대시보드(`/teacher`)도 동일 비밀번호로 보호

#### UX 개선
- 말하기 버튼 누르면 AI 오디오 즉시 음소거 (녹음 중 AI 소리 차단)
- 녹음 종료 시 음소거 해제
- 말하기 버튼으로 AI 응답 중단 가능 (`response.cancel`)
- 빈 화면 안내 문구 변경: "말하기 버튼을 눌러 선생님께 인사의 말을 건네보세요!"

#### 로컬 개발 환경
- `stage3-realtime/frontend/.env.local` 설정 완료
- Windows CMD에서 venv 재생성 방법 확인

---

### 1. 시스템 설계 문서화 (`SYSTEM_DESIGN.md`)
- 4단계 구현 로드맵 설계 (Stage 1~4)
- 단계별 기술 스택 비교 및 선택 이유 기록
- **비용 예상** (월 200세션 기준)
  - Stage 1 (Whisper + Claude 요약): ~$20/월
  - Stage 2 (Deepgram 스트리밍): ~$25/월
  - Stage 3-A (OpenAI Realtime): ~$223/월 ⚠️ 고비용
  - Stage 3-B (Deepgram + Claude + ElevenLabs): ~$25/월 ← 권장
  - Stage 4 (+ 아바타): ~$35/월
- 기술 리스크 및 대응 방안 정리

### 2. Stage 1 MVP 구현 완료

#### 백엔드 (`backend/`)
- **FastAPI** + **SQLite(aiosqlite)** + **SQLAlchemy 2.0 async**
- **OpenAI Whisper API** 연동 (한국어 STT)
- **Anthropic Claude** (`claude-sonnet-4-6`) 연동 (복습 요약)
- 오디오 업로드 → 백그라운드 처리 (STT → 요약) → 결과 저장
- REST API: `POST /sessions/`, `GET /sessions/`, `GET /sessions/{id}`

#### 프론트엔드 (`frontend/`)
- **Next.js 15** + TypeScript + Tailwind CSS
- **학생 화면** (`/`): 이름/과목 입력 → 마이크 녹음 → 전송 → 결과 확인
- **교사 대시보드** (`/teacher`): 세션 목록, AI 요약 확인, 5초 자동 갱신
- Web MediaRecorder API 기반 브라우저 녹음

#### 설정
- `.gitignore` 생성 (API 키, 오디오 파일, DB, 패키지 폴더 보호)
- `.env.example` / `.env.local.example` 환경변수 템플릿

### 3. 서버 실행 확인
- 백엔드 `http://localhost:8000` → `/health` 응답 확인
- 프론트엔드 `http://localhost:3000` → 200 OK 확인

---

## 트러블슈팅 기록

| 문제 | 원인 | 해결 |
|------|------|------|
| SQLAlchemy `No module named 'greenlet'` | uvicorn `reload=True` 시 Anaconda Python이 서브프로세스를 실행하면서 venv의 greenlet을 못 찾음 | `main.py`에서 `reload=False`로 변경 |

---

## 현재 파일 구조

```
AI-Teacher/
├── .gitignore
├── README.md              빠른 시작 가이드
├── SYSTEM_DESIGN.md       전체 시스템 설계 + 비용 분석
├── PROGRESS.md            이 파일
├── backend/
│   ├── main.py            FastAPI 앱 (CORS, lifespan, 라우터 등록)
│   ├── database.py        SQLite async 엔진 + init_db
│   ├── models.py          Session DB 모델
│   ├── requirements.txt   Python 패키지 목록
│   ├── .env.example       환경변수 템플릿
│   ├── server.log         실행 로그 (서버 실행 시 생성)
│   ├── ai_teacher.db      SQLite DB (서버 실행 시 생성)
│   ├── uploads/           오디오 파일 저장 (서버 실행 시 생성)
│   ├── venv/              Python 가상환경 (설치 완료)
│   ├── routers/
│   │   └── sessions.py    업로드/조회 API + 백그라운드 처리
│   └── services/
│       ├── stt.py         Whisper STT 서비스
│       └── summarizer.py  Claude 요약 서비스
└── frontend/
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── .env.local.example 환경변수 템플릿
    ├── node_modules/      패키지 (설치 완료)
    ├── app/
    │   ├── layout.tsx     공통 레이아웃 + 네비게이션
    │   ├── globals.css    Tailwind 기본 스타일
    │   ├── page.tsx       학생 녹음 페이지
    │   └── teacher/
    │       └── page.tsx   교사 대시보드
    └── components/
        └── AudioRecorder.tsx  마이크 녹음 컴포넌트
```

---

## 다음에 이어서 할 작업

### 즉시 가능
- [ ] 실제 녹음 → 업로드 → 요약 E2E 테스트
- [ ] 교사 대시보드 이메일 알림 추가 (SendGrid)

### Stage 2 (실시간 STT)
- [ ] Deepgram WebSocket 스트리밍 연동
- [ ] WebSocket 서버 엔드포인트 추가
- [ ] 프론트엔드 실시간 텍스트 표시 UI
- [ ] Redis 세션 임시 저장

### Stage 3 (양방향 대화)
- [ ] 파이프라인 결정: OpenAI Realtime vs Deepgram+Claude+ElevenLabs
- [ ] AI 선생님 시스템 프롬프트 튜닝
- [ ] 대화 이력 저장 구조 설계

---

## 서버 재실행 명령어

```bash
# 백엔드
cd backend
venv/bin/python main.py

# 프론트엔드 (새 터미널)
cd frontend
npm run dev
```

---

## 필요한 API 키

| 키 이름 | 발급처 | 용도 |
|---------|--------|------|
| `OPENAI_API_KEY` | platform.openai.com | Whisper STT |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Claude 요약 |
