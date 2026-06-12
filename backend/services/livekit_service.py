import logging
import os

from livekit import api as lk_api
from livekit.api import AccessToken, VideoGrants

logger = logging.getLogger(__name__)

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
_KEY = os.getenv("LIVEKIT_API_KEY", "")
_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


def room_name(classroom_id: int, private_student: str | None = None) -> str:
    if private_student:
        return f"ontact-{classroom_id}-{private_student}"
    return f"ontact-{classroom_id}"


def make_token(
    classroom_id: int,
    identity: str,
    display_name: str,
    is_teacher: bool = False,
    private_student: str | None = None,
) -> str:
    token = (
        AccessToken(api_key=_KEY, api_secret=_SECRET)
        .with_identity(identity)
        .with_name(display_name)
        .with_grants(VideoGrants(
            room_join=True,
            room=room_name(classroom_id, private_student),
            can_publish=True,
            can_subscribe=True,
            room_admin=is_teacher,
        ))
    )
    return token.to_jwt()


async def list_private_students(classroom_id: int) -> list[str]:
    """현재 개인실에 사람이 있는 학생 이름 목록 (LiveKit 서버가 진실 공급원).

    방 이름 ontact-{id}-{학생이름} 에서 이름을 추출한다.
    """
    if not LIVEKIT_URL:
        return []
    prefix = f"ontact-{classroom_id}-"
    names: list[str] = []
    try:
        async with lk_api.LiveKitAPI(LIVEKIT_URL, _KEY, _SECRET) as lk:
            rooms = await lk.room.list_rooms(lk_api.ListRoomsRequest())
            for r in rooms.rooms:
                if r.name.startswith(prefix) and r.num_participants > 0:
                    names.append(r.name[len(prefix):])
    except Exception as e:
        logger.warning(f"개인실 목록 조회 실패 (classroom={classroom_id}): {e}")
    return names


async def delete_classroom_rooms(classroom_id: int) -> None:
    """교실에 속한 LiveKit 방(강의실 + 모든 개인실)을 서버에서 삭제.

    교실을 닫을 때 호출 — 남아 있는 학생들이 유령 방에 갇히지 않도록
    강제로 연결을 끊는다. 실패해도 교실 닫기 자체는 진행돼야 하므로
    예외는 로그만 남긴다.
    """
    if not LIVEKIT_URL:
        return
    prefix = f"ontact-{classroom_id}"
    try:
        async with lk_api.LiveKitAPI(LIVEKIT_URL, _KEY, _SECRET) as lk:
            rooms = await lk.room.list_rooms(lk_api.ListRoomsRequest())
            for r in rooms.rooms:
                if r.name == prefix or r.name.startswith(prefix + "-"):
                    await lk.room.delete_room(lk_api.DeleteRoomRequest(room=r.name))
    except Exception as e:
        logger.warning(f"LiveKit 방 삭제 실패 (classroom={classroom_id}): {e}")
