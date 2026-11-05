"""Application configuration."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database -----------------------------------------------------------
    db_host: str = Field(default="127.0.0.1")
    db_port: int = Field(default=3306)
    db_user: str
    db_password: str
    db_default_schema: str = Field(default="myuser")

    # --- Auth ---------------------------------------------------------------
    jwt_secret: str
    jwt_access_token_minutes: int = Field(default=30)
    jwt_refresh_token_days: int = Field(default=7)
    admin_customer_codes: str = Field(default="717,1")
    legacy_pw_prefix_key: str = Field(default="forget1c#")

    # --- Feature flags ------------------------------------------------------
    # If true, inline edits open a confirmation modal showing the diff before
    # applying. If false, edits commit on blur/Enter with no extra click.
    enable_edit_confirmation: bool = Field(default=False)

    # If true, the refresh_all() routine rebuilds the denormalized user_details*
    # views after every canonical write. Left false by default because an
    # external process handles this on the current deployment.
    enable_view_refresh: bool = Field(default=True)

    # --- CORS / cookies -----------------------------------------------------
    cors_origins: str = Field(default="http://localhost:5173")
    cookie_secure: bool = Field(default=False)
    cookie_domain: str = Field(default="")

    # --- App ----------------------------------------------------------------
    app_env: Literal["development", "staging", "production"] = Field(
        default="development"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")

    @field_validator("jwt_secret")
    @classmethod
    def _reject_placeholder_secret(cls, v: str) -> str:
        if v.startswith("change_me") or len(v) < 32:
            raise ValueError(
                "jwt_secret must be changed from the default and be at least "
                "32 characters. Generate with: "
                "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )
        return v
    
    @property
    def admin_customer_code_set(self) -> set[int]:
        return {int(c.strip()) for c in self.admin_customer_codes.split(",") if c.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_dev(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
