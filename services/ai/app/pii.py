from functools import lru_cache

from newmean_pii import create_redactor
from newmean_pii.langchain import pii_middleware

from .config import Settings, get_settings


@lru_cache
def get_redactor(settings: Settings | None = None):
    settings = settings or get_settings()
    kwargs: dict = {"size": settings.pii_size}
    if settings.pii_model_dir:
        kwargs["model_dir"] = settings.pii_model_dir
    if settings.pii_allow:
        kwargs["allow"] = list(settings.pii_allow)
    if settings.pii_block:
        kwargs["block"] = [tuple(item) for item in settings.pii_block]
    return create_redactor(**kwargs)


def redact_text(text: str, settings: Settings | None = None) -> tuple[str, list[str]]:
    settings = settings or get_settings()
    redactor = get_redactor(settings)
    spans = redactor.detect(text)
    redacted = redactor.redact(text).text
    labels = sorted({span.label for span in spans})
    return redacted, labels


def build_pii_middleware(settings: Settings | None = None):
    settings = settings or get_settings()
    return pii_middleware(
        redactor=get_redactor(settings),
        strategy="redact",
        apply_to_input=True,
        apply_to_output=True,
        apply_to_tool_results=True,
    )
