"""복습 녹음 STT용 오디오 전처리.

흐름: MediaRecorder webm → ffmpeg로 16kHz mono PCM wav 변환 → 25MB 미만 청크로 분할.

목적:
1. gpt-4o-transcribe가 MediaRecorder webm 일부를 거부하는 문제 회피
   (wav는 헤더 구조가 단순/명확해 모든 STT 모델에서 통과)
2. OpenAI API의 25MB 파일 크기 리밋 처리
   (16kHz mono 16-bit PCM 기준 1초 ≈ 32KB → 25MB ≈ 13분)
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from typing import List

# 안전 마진 1MB 둠 (실제 한도 25MB)
MAX_CHUNK_BYTES = 24 * 1024 * 1024
# 16kHz mono 16-bit 기준 약 12분 → 약 23MB
CHUNK_DURATION_SEC = 720


class AudioConversionError(RuntimeError):
    """ffmpeg 호출 실패 시 발생."""


async def _run_ffmpeg(*args: str) -> None:
    """ffmpeg 서브프로세스 실행. 실패 시 stderr와 함께 예외."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-loglevel", "error", *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = stderr.decode(errors="ignore").strip()[:500] or "(no stderr)"
        raise AudioConversionError(f"ffmpeg 실패 (exit={proc.returncode}): {msg}")


async def webm_to_wav_chunks(webm_bytes: bytes) -> List[bytes]:
    """webm 바이트를 16kHz mono PCM wav로 변환 후, 필요하면 25MB 미만 청크로 분할.

    반환: 시간 순서대로 정렬된 wav 바이트 청크 리스트. 길이 1 이상 보장.
    """
    if not webm_bytes:
        raise AudioConversionError("입력 오디오가 비어 있습니다.")

    work_dir = tempfile.mkdtemp(prefix="aiteacher-stt-")
    try:
        in_path = os.path.join(work_dir, "input.webm")
        with open(in_path, "wb") as f:
            f.write(webm_bytes)

        # 1) webm → 16kHz mono PCM wav 변환
        wav_path = os.path.join(work_dir, "full.wav")
        await _run_ffmpeg(
            "-i", in_path,
            "-ar", "16000",  # 16kHz 다운샘플
            "-ac", "1",      # 모노
            "-c:a", "pcm_s16le",
            wav_path,
        )

        wav_size = os.path.getsize(wav_path)
        if wav_size == 0:
            raise AudioConversionError("변환된 wav 파일이 비어 있습니다.")

        # 2) 단일 청크로 충분하면 그대로 반환
        if wav_size <= MAX_CHUNK_BYTES:
            with open(wav_path, "rb") as f:
                return [f.read()]

        # 3) 큰 파일은 시간 단위로 분할 (PCM 재인코딩 — 비용 거의 없음)
        chunks: List[bytes] = []
        idx = 0
        while True:
            start = idx * CHUNK_DURATION_SEC
            chunk_path = os.path.join(work_dir, f"chunk-{idx:03d}.wav")
            try:
                await _run_ffmpeg(
                    "-ss", str(start),
                    "-t", str(CHUNK_DURATION_SEC),
                    "-i", wav_path,
                    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                    chunk_path,
                )
            except AudioConversionError:
                # ss가 길이를 넘으면 ffmpeg가 실패할 수 있음 — 정상 종료로 간주
                break

            if not os.path.exists(chunk_path):
                break
            size = os.path.getsize(chunk_path)
            # wav 헤더만 있는 경우(약 44바이트)는 빈 청크로 간주
            if size < 1024:
                break

            with open(chunk_path, "rb") as f:
                chunks.append(f.read())
            idx += 1

        if not chunks:
            raise AudioConversionError("분할 결과 청크가 0개입니다.")
        return chunks
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
