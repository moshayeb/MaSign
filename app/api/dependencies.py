from collections.abc import Iterator

import psycopg
from fastapi import Depends, HTTPException, Request, status

from app.answering import llm
from app.auth.security import SESSION_COOKIE_NAME
from app.database import repository
from app.database.models import User, Workspace
from app.database.session import get_connection
from app.retrieval import embeddings, vector_store


def get_db() -> Iterator[psycopg.Connection]:
    """One connection per request, committed when the handler returns."""
    with get_connection() as connection:
        yield connection


def get_current_user(request: Request, db: psycopg.Connection = Depends(get_db)) -> User:
    """The signed-in user, from the session cookie (MAS-143).

    A missing, unknown or expired session all look identical from the
    outside -- 401 with the same generic message -- so a caller cannot use
    the error to tell a stale cookie from a forged one."""
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    user = repository.get_session_user(db, session_id) if session_id else None
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    return user


def get_current_workspace(user: User = Depends(get_current_user), db: psycopg.Connection = Depends(get_db)) -> Workspace:
    """The signed-in user's workspace -- the boundary every contract route
    filters by (MAS-143). Every account has exactly one under the current
    personal-workspace-only model, created at registration."""
    workspace = repository.get_workspace_for_user(db, user.id)
    if workspace is None:
        # Cannot happen for an account created through /api/auth/register,
        # which creates the workspace in the same transaction as the user --
        # fail loudly rather than let a caller silently see no contracts.
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No workspace for this account.")
    return workspace


def get_embedder() -> embeddings.Embedder:
    return embeddings.get_embedder(embeddings.DEFAULT_PROFILE)


def get_vector_store() -> vector_store.VectorStore:
    return vector_store.get_vector_store(vector_store.DEFAULT_PROFILE)


def get_chat_model() -> llm.ChatModel:
    return llm.get_chat_model()
