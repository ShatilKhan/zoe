from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    # Local/dev allows running without Clerk. Never disable in a shared deployment.
    auth_enabled: bool = True
    clerk_jwks_url: str = ""
    clerk_issuer: str = ""
    clerk_audience: str = ""

    llama_cloud_api_key: str = ""
    llamaparse_tier: str = "agentic"
    llamaparse_version: str = "latest"
    llamaparse_timeout_seconds: float = 120.0
    llamaparse_poll_seconds: float = 2.0

    cf_account_id: str = ""
    cf_ai_token: str = ""
    cf_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

    pii_size: str = "medium"
    pii_model_dir: str = ""
    pii_allow: tuple[str, ...] = ()
    pii_block: tuple[str, ...] = ()

    rate_limit_per_minute: int = 20
    max_upload_mb: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
