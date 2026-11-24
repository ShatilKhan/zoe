import pytest
from fastapi import HTTPException

from app.auth import RateLimiter


def test_rate_limiter_allows_then_blocks():
    limiter = RateLimiter(2, window_seconds=60)
    limiter.check("user-a")
    limiter.check("user-a")
    with pytest.raises(HTTPException) as exc:
        limiter.check("user-a")
    assert exc.value.status_code == 429


def test_rate_limiter_is_per_subject():
    limiter = RateLimiter(1, window_seconds=60)
    limiter.check("user-a")
    limiter.check("user-b")
