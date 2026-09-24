#!/usr/bin/env python3
"""Hook 2 (Homework 6): hard-deny unbounded destructive SQL — DROP TABLE,
TRUNCATE, or DELETE with no WHERE clause — wherever its *text* is visible to
the tool call: a Bash command (psql, docker exec ... psql, python -c with an
embedded execute(), a heredoc) or a file Claude is about to Write/Edit.

What this hook CANNOT see, on purpose stated here rather than assumed away:
a PreToolUse hook is given the tool call, not a trace of what runs
afterwards. If Claude writes `scripts/cleanup.py` today with no dangerous
SQL in it, this hook has nothing to deny; if that script is edited *next
week* to build a DROP TABLE string at runtime from concatenated variables
and then executed, this hook still has nothing to deny at the moment
`python scripts/cleanup.py` is run, because the SQL text is not present in
the tool call itself — it exists only inside the interpreter, after the
hook has already returned. The same is true of an ORM `.delete()` call
with no `.filter()`, or a stored procedure invoked by name. Closing that
gap needs either a wrapped database driver (this project's dependency-free
Bash/psql-only dev workflow does not have one) or an allowlisted DB proxy
in front of Postgres — out of scope for a PreToolUse hook, noted as a real
gap rather than quietly ignored.

What this hook DOES see and denies: the SQL keywords appearing literally in
a Bash command *segment whose own program name is a database client*
(psql, python/python3/ipython, mysql, sqlite3 — directly or via
`docker exec ... psql`) or in the text a Write/Edit call is about to put
into a non-documentation file — which covers every destructive statement an
agent types directly, including inside a new migration file, which is
exactly the path the incident in Hook 1's docstring could just as easily
have taken (a migration silently dropping a table instead of a plain `rm`).

That "segment whose own program name" qualifier was not the first version
of this hook. It started as "scan the whole command text", which sounds
more thorough and is actually worse: it denied a `git commit -m "..."`
that merely *named* these keywords to explain this feature, and — after
narrowing to "does this text mention a database-client word anywhere" —
still denied one that mentioned "python" in passing while discussing
`python -c` examples, because the SQL scan ran across the entire command
regardless of which word actually invoked which program. Both were caught
live, while writing this file's own documentation and its test suite (see
`_segment_invokes_a_database_client` and `tests/test_safety_hooks.py`'s
`test_allows_a_commit_message_that_only_discusses_the_banned_keywords`).
Neither was a "fail closed" success — they were false positives on prose
that never touched a database, which is exactly the failure mode a
literal-text scanner is prone to, narrowed here as far as a regex-based
check reasonably can be without parsing shell semantics for real.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ToolCall, run_hook  # noqa: E402

HOOK_NAME = "block-destructive-sql"

# Case-insensitive, tolerant of the whitespace/newlines a heredoc or a
# multi-line Write introduces. `\b` keeps DROPTABLE (no such thing, but
# also e.g. a column literally named "truncated") from matching by accident.
DROP_TABLE_RE = re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE)
TRUNCATE_RE = re.compile(r"\bTRUNCATE\b", re.IGNORECASE)
DELETE_FROM_RE = re.compile(r"\bDELETE\s+FROM\s+([A-Za-z0-9_.\"]+)", re.IGNORECASE)


def _statements(text: str) -> list[str]:
    """Split on `;` so a WHERE clause in one statement never masks a bare
    DELETE in the next. A final statement with no trailing `;` is kept."""
    return [s for s in text.split(";") if s.strip()]


def _find_unbounded_delete(text: str) -> str | None:
    for statement in _statements(text):
        match = DELETE_FROM_RE.search(statement)
        if match and not re.search(r"\bWHERE\b", statement, re.IGNORECASE):
            return match.group(1)
    return None


def _scan(text: str) -> str | None:
    """Return a human reason if `text` contains one of the three banned
    shapes, else None. Order matters only for which reason is reported
    first when more than one appears."""
    if DROP_TABLE_RE.search(text):
        table = re.search(r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_.\"]+)", text, re.IGNORECASE)
        return f"DROP TABLE{' ' + table.group(1) if table else ''}"
    if TRUNCATE_RE.search(text):
        table = re.search(r"\bTRUNCATE\s+(?:TABLE\s+)?([A-Za-z0-9_.\",\s]+)", text, re.IGNORECASE)
        return f"TRUNCATE {table.group(1).strip()}" if table else "TRUNCATE"
    unbounded = _find_unbounded_delete(text)
    if unbounded:
        return f"DELETE FROM {unbounded} with no WHERE clause"
    return None


DB_CLIENT_WORDS = {"psql", "mysql", "mariadb", "sqlite3", "python", "python3", "ipython"}

# Markdown/plain-text files can quote these keywords all day while
# explaining what this hook does; only code-shaped files can actually run
# them, so only those are worth the same "false positive on prose" risk.
_DOC_EXTENSIONS = {".md", ".mdx", ".txt", ".rst"}


def _split_commands(command: str) -> list[str]:
    """`a && b | c; d` -> ["a", "b", "c", "d"] as raw text, not tokens — kept
    as strings (not shlex'd) because `_scan` needs to see the real
    whitespace/quoting of each piece, not a re-joined approximation."""
    return [piece.strip() for piece in re.split(r"&&|\|\||;|\n|\|", command) if piece.strip()]


def _segment_invokes_a_database_client(segment: str) -> bool:
    """True only if THIS segment's own program name is a DB client — not
    "the word appears somewhere in this segment's text".

    Found live, twice, while writing this hook's own documentation and its
    tests: checking "does the whole command mention any of these words
    anywhere" meant a `git commit -m "..."` whose message *named* one of
    these clients (to explain what this hook does) was treated as if it
    were invoking one. A command's own program name — the first word of a
    `docker exec ...` target included — is the right signal; a word
    appearing later, inside a quoted string, is not."""
    try:
        words = re.findall(r"[^\s]+", segment)
    except Exception:
        return True  # unparseable is closer to "could be anything" than "definitely not a DB client"
    if not words:
        return False
    if words[0].rsplit("/", 1)[-1] in DB_CLIENT_WORDS:
        return True
    # `docker exec <container> psql ...` / `docker compose exec db psql ...`:
    # the client name shows up as one of docker's own trailing arguments.
    if words[0] == "docker" and DB_CLIENT_WORDS.intersection(words[1:]):
        return True
    return False


def classify(call: ToolCall) -> tuple[str, str] | None:
    if call.tool_name == "Bash":
        command = call.command()
        if not command.strip():
            return None
        for segment in _split_commands(command):
            if not _segment_invokes_a_database_client(segment):
                continue
            verdict = _classify_text(segment)
            if verdict:
                return verdict
        return None

    if call.tool_name in ("Write", "Edit", "NotebookEdit"):
        path = call.file_path()
        if path and Path(path).suffix.lower() in _DOC_EXTENSIONS:
            return None
        return _classify_text(call.written_text())

    return None


def _classify_text(text: str) -> tuple[str, str] | None:
    if not text.strip():
        return None
    reason = _scan(text)
    if reason is None:
        return None
    statement = reason.split(" with no WHERE", 1)[0]
    return "deny", (
        f"unbounded destructive SQL detected - {reason}. "
        f"Exact statement: {statement!r}. "
        "This class of statement is never run by the agent; if it is genuinely "
        "needed, the owner runs it by hand."
    )


if __name__ == "__main__":
    run_hook(HOOK_NAME, classify)
