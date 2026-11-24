from pydantic import BaseModel, Field


class Medicine(BaseModel):
    name: str = Field(description="Medicine name as written on the prescription")
    dosage: str | None = Field(default=None, description="Dose and frequency, if legible")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class Citation(BaseModel):
    page: int = Field(ge=1, description="1-based page number in the parsed document")
    excerpt: str = Field(description="Short supporting excerpt from the parsed text")


class AskAnswer(BaseModel):
    answer: str = Field(description="Short, non-diagnostic answer grounded in the supplied text")
    medicines: list[Medicine] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    uncertainty: str = Field(default="", description="What could not be read or confirmed")


class ParseResponse(BaseModel):
    text: str = Field(description="Redacted markdown returned by LlamaParse")
    page_count: int = Field(ge=0)
    pii_labels: list[str] = Field(default_factory=list)
