import os
from contextlib import asynccontextmanager

# macOS python.org 빌드는 CA 인증서가 비어 있어 aiohttp(LiveKit API)의 TLS 검증이
# 실패한다 → certifi 번들을 SSL_CERT_FILE로 지정해 보정.
import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("SSL_CERT_DIR", os.path.dirname(certifi.where()))

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(override=True)

from database import init_db
from routers import sessions, realtime, recordings, lessons, ontact


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="AI Teacher API - Stage 3 Realtime",
    description="온택트 교실 AI 선생님 - 실시간 음성 대화",
    version="3.0.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

# 브라우저는 Next.js 프록시를 경유하므로 백엔드를 직접 호출하지 않음.
# WebSocket은 브라우저가 백엔드에 직접 연결하므로 FRONTEND_URL을 allow_origins에 포함.
_origins = [o.strip() for o in os.getenv("FRONTEND_URL", "http://localhost:3001").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(realtime.router)
app.include_router(recordings.router)
app.include_router(lessons.router)
app.include_router(ontact.router)


@app.get("/health")
async def health():
    return {"status": "ok", "stage": "3-realtime"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 8001)),
        reload=False,
    )
