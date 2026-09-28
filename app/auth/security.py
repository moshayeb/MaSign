"""Password hashing and session tokens (MAS-143).

Argon2id (OWASP's current first choice), not a fast hash like sha256 -- a
leaked `users` table must still cost real time per guess. Sessions are an
opaque random token looked up in Postgres, not a signed JWT: logout is one
DELETE, a real revocation, rather than waiting out a token's own expiry.
"""

import os
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()

SESSION_COOKIE_NAME = "masign_session"
SESSION_TTL = timedelta(days=14)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def generate_session_id() -> str:
    return secrets.token_urlsafe(32)


def session_expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + SESSION_TTL


def cookie_is_secure() -> bool:
    """False only for local HTTP development, set explicitly via env.

    A `Secure` cookie is silently dropped by the browser over plain HTTP, so
    local dev needs this off -- but the default is on, so a deployment that
    forgets to set anything gets the safe behaviour, not the convenient one.
    """
    return os.getenv("MASIGN_COOKIE_SECURE", "1") != "0"
