import threading
import time
from collections import defaultdict, deque

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)
_jwks: PyJWKClient | None = None
_jwks_lock = threading.Lock()


def _jwks_client(settings: Settings) -> PyJWKClient:
    global _jwks
    if _jwks is None:
        with _jwks_lock:
            if _jwks is None:
                _jwks = PyJWKClient(settings.clerk_jwks_url)
    return _jwks


def decode_clerk_token(token: str, settings: Settings) -> str:
    if not settings.clerk_jwks_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Clerk JWKS URL is not configured")
    try:
        key = _jwks_client(settings).get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.clerk_audience or None,
            issuer=settings.clerk_issuer or None,
            options={"verify_aud": bool(settings.clerk_audience)},
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session") from exc
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has no subject")
    return str(subject)


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
            hits.append(now)


def get_rate_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter | None = getattr(request.app.state, "rate_limiter", None)
    if limiter is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Rate limiter is not configured")
    return limiter


def current_subject(
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    local_subject: str | None = Header(default=None, alias="X-Zoe-Subject"),
) -> str:
    if not settings.auth_enabled:
        return (local_subject or "local-dev").strip()
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer token required")
    return decode_clerk_token(credentials.credentials, settings)


def require_subject(
    subject: str = Depends(current_subject),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> str:
    limiter.check(subject)
    return subject
