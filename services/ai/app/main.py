from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from .agent import ask
from .auth import RateLimiter, require_subject
from .config import get_settings
from .ocr import LlamaParseError, get_ocr
from .pii import redact_text
from .schemas import AskAnswer, ParseResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
    yield


app = FastAPI(title="Zoe AI service", version="0.1.0", lifespan=lifespan)


def _read_image(file: UploadFile, max_bytes: int) -> tuple[str, bytes, str]:
    content_type = file.content_type or "application/octet-stream"
    if not content_type.startswith("image/"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Image upload required")
    data = file.file.read()
    if len(data) > max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
    return file.filename or "prescription.jpg", data, content_type


@app.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "auth_enabled": settings.auth_enabled,
        "llm_model": settings.cf_model,
        "pii_size": settings.pii_size,
    }


@app.post("/parse", response_model=ParseResponse)
def parse_prescription(
    file: UploadFile = File(...),
    _subject: str = Depends(require_subject),
) -> ParseResponse:
    settings = get_settings()
    filename, data, content_type = _read_image(file, settings.max_upload_mb * 1024 * 1024)
    try:
        markdown, page_count = get_ocr(settings).parse(filename, data, content_type)
    except LlamaParseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    redacted, labels = redact_text(markdown, settings)
    return ParseResponse(text=redacted, page_count=page_count, pii_labels=labels)


@app.post("/ask", response_model=AskAnswer)
def ask_about_prescription(
    question: str = Form(...),
    file: UploadFile | None = File(default=None),
    text: str = Form(default=""),
    _subject: str = Depends(require_subject),
) -> AskAnswer:
    settings = get_settings()
    source = text
    if file is not None:
        filename, data, content_type = _read_image(file, settings.max_upload_mb * 1024 * 1024)
        try:
            markdown, _ = get_ocr(settings).parse(filename, data, content_type)
        except LlamaParseError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
        source, _ = redact_text(markdown, settings)
    return ask(question, source, settings)
