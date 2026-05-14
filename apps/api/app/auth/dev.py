from dataclasses import dataclass


@dataclass
class DevUser:
    id: str | None = None
    email: str = "dev@cloudops.local"
    name: str = "Dev Reviewer"


def get_current_user() -> DevUser:
    return DevUser()
