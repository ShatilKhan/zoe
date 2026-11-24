import time
from functools import lru_cache

from .config import Settings, get_settings


class LlamaParseError(RuntimeError):
    pass


class LlamaParseOCR:
    def __init__(self, settings: Settings | None = None) -> None:
        from llama_cloud import LlamaCloud

        self.settings = settings or get_settings()
        if not self.settings.llama_cloud_api_key:
            raise RuntimeError("LLAMA_CLOUD_API_KEY must be configured")
        self.client = LlamaCloud(api_key=self.settings.llama_cloud_api_key)

    def parse(self, filename: str, data: bytes, content_type: str) -> tuple[str, int]:
        uploaded = self.client.files.create(
            file=(filename, data, content_type),
            purpose="parse",
        )
        job = self.client.parsing.create(
            file_id=uploaded.id,
            tier=self.settings.llamaparse_tier,
            version=self.settings.llamaparse_version,
            disable_cache=True,
            input_options={"image": {"camera_photo_correction": True}},
        )
        deadline = time.monotonic() + self.settings.llamaparse_timeout_seconds
        while True:
            result = self.client.parsing.get(job.id, expand=["markdown"])
            status = getattr(getattr(result, "job", None), "status", "")
            if status == "COMPLETED":
                break
            if status in {"FAILED", "CANCELLED"}:
                raise LlamaParseError(f"LlamaParse job {status.lower()}")
            if time.monotonic() >= deadline:
                raise LlamaParseError("LlamaParse job timed out")
            time.sleep(self.settings.llamaparse_poll_seconds)

        pages = getattr(getattr(result, "markdown", None), "pages", None) or []
        markdown_pages = [getattr(page, "markdown", "") or "" for page in pages]
        return "\n\n".join(markdown_pages), len(markdown_pages)


@lru_cache
def get_ocr(settings: Settings | None = None) -> LlamaParseOCR:
    return LlamaParseOCR(settings or get_settings())
