"""오디오 후처리: MediaRecorder webm에 duration 메타데이터를 주입한다."""

import asyncio
import tempfile
import os


async def remux_webm(data: bytes) -> bytes:
    """ffmpeg로 webm을 remux하여 duration 메타데이터를 추가한다.

    MediaRecorder가 생성한 webm은 duration 정보가 없어
    브라우저 <audio> 플레이어의 시크바가 정상 동작하지 않는다.
    ffmpeg remux는 재인코딩 없이 컨테이너만 재작성하므로 거의 즉시 완료된다.
    """
    in_path = None
    out_path = None
    try:
        # 임시 파일에 원본 저장
        fd_in, in_path = tempfile.mkstemp(suffix=".webm")
        os.write(fd_in, data)
        os.close(fd_in)

        fd_out, out_path = tempfile.mkstemp(suffix=".webm")
        os.close(fd_out)

        # ffmpeg remux: 코덱 복사 (재인코딩 없음)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", in_path, "-c", "copy", out_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            # remux 실패 시 원본 그대로 반환
            return data

        with open(out_path, "rb") as f:
            return f.read()
    except Exception:
        return data
    finally:
        if in_path and os.path.exists(in_path):
            os.unlink(in_path)
        if out_path and os.path.exists(out_path):
            os.unlink(out_path)
