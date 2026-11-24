from langchain_openai import ChatOpenAI

from .config import Settings, get_settings


def build_chat_model(settings: Settings | None = None) -> ChatOpenAI:
    settings = settings or get_settings()
    if not settings.cf_account_id or not settings.cf_ai_token:
        raise RuntimeError("CF_ACCOUNT_ID and CF_AI_TOKEN must be configured")
    return ChatOpenAI(
        base_url=f"https://api.cloudflare.com/client/v4/accounts/{settings.cf_account_id}/ai/v1",
        api_key=settings.cf_ai_token,
        model=settings.cf_model,
        temperature=0,
        max_retries=2,
        timeout=60,
    )
