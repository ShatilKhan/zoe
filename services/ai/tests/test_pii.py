from types import SimpleNamespace

from app import pii


def test_redact_text_collects_labels(monkeypatch):
    class FakeRedactor:
        def detect(self, text):
            return [SimpleNamespace(label="PERSON"), SimpleNamespace(label="EMAIL")]

        def redact(self, text):
            return SimpleNamespace(text="[PERSON] took [EMAIL]")

    monkeypatch.setattr(pii, "get_redactor", lambda settings=None: FakeRedactor())
    redacted, labels = pii.redact_text("Kim took kim@example.com")
    assert redacted == "[PERSON] took [EMAIL]"
    assert labels == ["EMAIL", "PERSON"]
