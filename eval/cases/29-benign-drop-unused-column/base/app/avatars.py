import os

CDN = os.environ.get("AVATAR_CDN", "https://cdn.clinicly.app")


def avatar_url(user) -> str | None:
    return f"{CDN}/{user.avatar_key}" if user.avatar_key else None
