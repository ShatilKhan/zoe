from fastapi.testclient import TestClient

from app import main
from app.auth import require_subject
from app.schemas import AskAnswer


class FakeOCR:
    def parse(self, filename, data, content_type):
        return "| Medicine | Dose |\n| --- | --- |\n| Nifedipine | 10 mg |", 1


def override_subject():
    return "test-user"


def test_parse_redacts_text(monkeypatch):
    monkeypatch.setattr(main, "get_ocr", lambda settings=None: FakeOCR())
    monkeypatch.setattr(main, "redact_text", lambda text, settings=None: ("[PERSON] Nifedipine 10 mg", ["PERSON"]))
    main.app.dependency_overrides[require_subject] = override_subject

    with TestClient(main.app) as client:
        response = client.post(
            "/parse",
            files={"file": ("rx.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        )
    main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["pii_labels"] == ["PERSON"]
    assert "[PERSON]" in response.json()["text"]


def test_ask_uses_existing_redacted_text(monkeypatch):
    monkeypatch.setattr(
        main,
        "ask",
        lambda question, source, settings=None: AskAnswer(
            answer="Nifedipine 10 mg.",
            medicines=[{"name": "Nifedipine", "dosage": "10 mg", "confidence": 0.9}],
            citations=[{"page": 1, "excerpt": "Nifedipine 10 mg"}],
            uncertainty="",
        ),
    )
    main.app.dependency_overrides[require_subject] = override_subject

    with TestClient(main.app) as client:
        response = client.post("/ask", data={"question": "What is listed?", "text": "Nifedipine 10 mg"})
    main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["medicines"][0]["name"] == "Nifedipine"


def test_health_does_not_expose_secrets():
    with TestClient(main.app) as client:
        body = client.get("/health").json()
    assert body["status"] == "ok"
    assert "token" not in str(body).lower()
