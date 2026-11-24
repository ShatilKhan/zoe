from functools import lru_cache

from langchain.agents import create_agent

from .config import Settings, get_settings
from .pii import build_pii_middleware
from .providers import build_chat_model
from .schemas import AskAnswer

SYSTEM_PROMPT = """You are Zoe's medicine-label assistant.
Use only the supplied parsed text. Never diagnose, prescribe, or invent a value.
Return short answers, list medicines only when legible, and cite page numbers when possible.
Say explicitly when text is unreadable or missing."""


@lru_cache
def get_agent(settings: Settings | None = None):
    settings = settings or get_settings()
    return create_agent(
        model=build_chat_model(settings),
        system_prompt=SYSTEM_PROMPT,
        middleware=[build_pii_middleware(settings)],
        response_format=AskAnswer,
    )


def ask(question: str, source_text: str, settings: Settings | None = None) -> AskAnswer:
    if not source_text.strip():
        return AskAnswer(
            answer="No parsed text was supplied. Capture a clearer image and try again.",
            uncertainty="Missing source text.",
        )
    prompt = f"Question: {question}\n\nParsed prescription text:\n{source_text}"
    result = get_agent(settings).invoke({"messages": [{"role": "user", "content": prompt}]})
    structured = result.get("structured_response")
    if isinstance(structured, AskAnswer):
        return structured
    return AskAnswer(answer=str(structured) if structured else "No answer produced.", uncertainty="Unstructured response.")
