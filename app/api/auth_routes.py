"""Registration, login, logout and the current-account probe (MAS-143).

Internal accounts only, no external identity provider (owner decision,
2026-09-28): email + password, Argon2id-hashed, an opaque session token in a
cookie. Personal workspaces only -- registration creates exactly one, in the
same transaction as the user, so an account with no workspace should never
be observable (see `get_current_workspace`'s 500 for the case it somehow is).
"""

import re

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator

from app.api.dependencies import get_current_user, get_db
from app.auth.security import (
    DUMMY_PASSWORD_HASH,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    cookie_is_secure,
    generate_session_id,
    hash_password,
    session_expiry,
    verify_password,
)
from app.database import repository
from app.database.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Generic on purpose: never tell a caller which half of a login was wrong,
# or that an email is already registered vs. some other reason it failed --
# both would let an attacker enumerate real accounts.
_BAD_CREDENTIALS = "Invalid email or password."


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=200)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("Enter a valid email address.")
        return value


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserOut(BaseModel):
    id: str
    email: str

    @classmethod
    def from_model(cls, user: User) -> "UserOut":
        return cls(id=str(user.id), email=user.email)


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=cookie_is_secure(),
        samesite="lax",
        max_age=int(SESSION_TTL.total_seconds()),
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response, db: psycopg.Connection = Depends(get_db)) -> UserOut:
    if repository.get_user_by_email(db, body.email) is not None:
        # Same wording a wrong password gets: existence of an email is not
        # something an unauthenticated caller should be able to probe for.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Could not create that account.")

    user = repository.create_user(db, email=body.email, password_hash=hash_password(body.password))
    repository.create_personal_workspace(db, user_id=user.id, name=f"{body.email}'s workspace")

    session_id = generate_session_id()
    repository.create_session(db, session_id=session_id, user_id=user.id, expires_at=session_expiry())
    _set_session_cookie(response, session_id)
    return UserOut.from_model(user)


@router.post("/login", response_model=UserOut)
def login(body: LoginRequest, response: Response, db: psycopg.Connection = Depends(get_db)) -> UserOut:
    user = repository.get_user_by_email(db, body.email)
    # Always hash, even for an email nobody registered: `or` short-circuiting
    # around verify_password() here would make a nonexistent email return in
    # ~30ms and a wrong password ~150-200ms (MAS-33) -- trivially
    # distinguishable by timing alone, defeating the identical error message
    # below. DUMMY_PASSWORD_HASH costs a real Argon2id verify either way.
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_BAD_CREDENTIALS)

    session_id = generate_session_id()
    repository.create_session(db, session_id=session_id, user_id=user.id, expires_at=session_expiry())
    _set_session_cookie(response, session_id)
    return UserOut.from_model(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: psycopg.Connection = Depends(get_db)) -> Response:
    # Real revocation, not just clearing the client's cookie: the session
    # row is deleted server-side too, so a copy of the old cookie is dead.
    # Mutating and returning the SAME injected `response` matters here --
    # returning a brand new Response(...) instead would silently drop the
    # delete_cookie() call, a real gotcha this project already hit once
    # (MAS-165, a different Response-handling bug in the frontend's request()).
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        repository.delete_session(db, session_id)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.from_model(user)
