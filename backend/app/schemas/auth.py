"""Auth request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class CurrentAgent(BaseModel):
    """Shape returned by /auth/me and carried through request state.

    Identity is the MariaDB user_id (a string). There is no separate
    numeric agent id — CS agents are main-app users whose customer_code
    equals the configured admin code.
    """
    user_id: str
    customer_code: int
    e_mail: EmailStr
    first_name: str
    last_name: str
    is_admin: bool

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.user_id


class MessageResponse(BaseModel):
    message: str
