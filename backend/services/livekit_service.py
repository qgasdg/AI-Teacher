import os
from livekit.api import AccessToken, VideoGrants

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
