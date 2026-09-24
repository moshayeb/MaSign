#!/usr/bin/env python3
"""Hook 1 (Homework 6): require a typed confirmation code before a
destructive operation touches a file this project depends on outsiders
never silently losing.

Protected, exactly:
  CLAUDE.md, .gitignore, .dockerignore, .env, .env.example
  every *existing* file under app/database/migrations/*.sql

New migration files are exempt on purpose — creating `009_x.sql` is normal
work; the risk is an existing, already-applied migration being edited or
removed out from under `schema_migrations`.

This exists because it already happened once: a `git reset --hard` used to
move a commit between branches wiped uncommitted CLAUDE.md / .gitignore /
.dockerignore edits, recovered only because they were still in a dangling
stash. This hook is what should have asked first.

Two tool shapes are covered, both routed to `_common.confirm()`:
  - Write / Edit / NotebookEdit whose target path is one of the protected
    files — confirmed regardless of *what* the new content is, because the
    point is "you are about to change this file", not "the change looks
    bad".
  - Bash commands whose parsed structure deletes, overwrites or reverts one
    of these paths: rm/rm -rf, mv onto the path, a truncating `>` redirect,
    `git checkout -- <path>` / `git restore <path>`, and `git clean -f`
    (which can take an *untracked* file like `.env` with it — `.env` is
    deliberately in the protected set even though it is never committed).

`git reset --hard` is deliberately *not* re-implemented here: it discards
uncommitted work project-wide, not path by path, so it belongs to Hook 3
(block_history_rewrite.py), which requires the same confirmation code for
it. That is what would have caught the actual incident — this hook catches
the narrower, more common case of a direct `rm`/`checkout`/`clean` on one
of these five names.

Disclosed gap, found by noticing it applied to this project's own habits:
the Bash classifier only pattern-matches named shell primitives. A one-line
interpreter script run via Bash that opens one of these paths with its own
file I/O and overwrites it — `python -c "open('CLAUDE.md','w').write(...)"`
— is invisible to it, for the same underlying reason Hook 2 cannot see SQL
built at runtime inside a program it merely launches: a PreToolUse hook
sees the tool call's text, not what an interpreter does once it starts.
This matters concretely here: this project's own convention for editing
CLAUDE.md (writing the file directly from a small script, so the change
never goes through `git add` and can be staged by blob instead — see
`masign-ticket-flow`) uses exactly that shape, and is therefore *not*
caught by this hook. Closing it generically would mean sandboxing or
auditing what every interpreter does after a hook returns control, which
is the same out-of-scope problem noted in block_destructive_sql.py, not a
gap unique to this hook.

A second, more important gap surfaced live rather than reasoned about in
advance, and is why this hook no longer uses `ask`: in an unattended
("Auto Mode") session an `ask` can go unanswered and the call proceeds —
a live `rm CLAUDE.md` in that state deleted the file with no prompt
shown and no error, in the same session where block_destructive_sql.py's
`deny` stopped a real destructive-SQL attempt outright every time. `ask`
routes through Claude Code's own interactive permission prompt, which an
unattended session can pass through unanswered; it never even reached
that prompt's answer, it just went straight through. `_common.confirm()`
does not use that plumbing at all: it opens the real OS console directly
and requires a human to type a code the owner set themselves
(`MASIGN_CONFIRM_CODE` or a local, git-ignored
`.claude/hooks/.confirm_code`) within a time limit. No code configured,
no console attached, a wrong code, or nobody answering in time all fail
to `deny`, same as Hook 2 — the same mechanism Hook 3 uses for local
history-rewriting commands, applied here after the live `rm CLAUDE.md`
gap was demonstrated a second time with `ask` still in place (owner
sign-off, 2026-09-24). See block_history_rewrite.py's and
`_common.confirm()`'s docstrings for the full mechanism.
"""

from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ToolCall, run_hook  # noqa: E402

HOOK_NAME = "protect-sensitive-files"

PROTECTED_EXACT = {"CLAUDE.md", ".gitignore", ".dockerignore", ".env", ".env.example"}
MIGRATIONS_DIR = "app/database/migrations"


def _normalise(path: str) -> str:
    """A path as it would appear relative to the repo root, forward slashes,
    no leading ./ — good enough to compare against our short protected list
    without pulling in a full path-resolution dependency on `cwd`.

    Deliberately NOT `str.lstrip("./")`: lstrip treats its argument as a set
    of characters, not a prefix, so it would strip the leading dot off
    `.gitignore` and `.env.example` too and break the exact-name match this
    whole hook depends on. A caught-in-testing bug, kept in this comment so
    it is not reintroduced."""
    normalised = path.strip().strip('"').strip("'").replace("\\", "/")
    while normalised.startswith("./"):
        normalised = normalised[2:]
    return normalised


def _is_protected(path: str) -> bool:
    normalised = _normalise(path)
    basename = normalised.rsplit("/", 1)[-1]
    if basename in PROTECTED_EXACT or normalised in PROTECTED_EXACT:
        return True
    if normalised.startswith(f"{MIGRATIONS_DIR}/") and normalised.endswith(".sql"):
        # Only an *existing* migration is protected; a brand new one is fine
        # to create. We cannot ask git here without another subprocess call
        # per invocation, so we check the file on disk — every applied
        # migration is committed, so "exists on disk" and "exists in git"
        # agree for the case this hook cares about.
        return (Path.cwd() / normalised).exists()
    return False


def _protected_targets(words: list[str]) -> list[str]:
    return [w for w in words if _is_protected(w)]


# --- Bash command classification --------------------------------------------

# `>` truncation, not `>>` append and not `2>`/`&>` style fd redirects we
# don't care about here — just "a bare > that writes over a named file".
REDIRECT_RE = re.compile(r"(?<!>)>(?!>)\s*([^\s;&|]+)")


def _split_commands(command: str) -> list[list[str]]:
    """Best-effort: split on the shell separators an agent would actually
    type (`;`, `&&`, `||`, newlines, `|`), then shlex each piece. A `psql`
    heredoc or a piece shlex chokes on is kept as one opaque token rather
    than dropped — dropping it would mean silently not checking it."""
    pieces = re.split(r"&&|\|\||;|\n|\|", command)
    result = []
    for piece in pieces:
        piece = piece.strip()
        if not piece:
            continue
        try:
            result.append(shlex.split(piece, posix=True))
        except ValueError:
            result.append([piece])
    return result


def _classify_bash(command: str) -> tuple[str, str] | None:
    reasons: list[str] = []

    for target in (m.group(1) for m in REDIRECT_RE.finditer(command)):
        if _is_protected(target):
            reasons.append(f"'>' would overwrite {_normalise(target)}")

    for words in _split_commands(command):
        if not words:
            continue
        head = words[0]
        rest = words[1:]

        if head == "rm":
            hit = _protected_targets([w for w in rest if not w.startswith("-")])
            if hit:
                reasons.append(f"rm targets {', '.join(hit)}")

        elif head == "mv":
            args = [w for w in rest if not w.startswith("-")]
            if args and _is_protected(args[-1]):
                reasons.append(f"mv would overwrite {_normalise(args[-1])}")

        elif head == "git":
            sub = rest[0] if rest else ""
            if sub in ("checkout", "restore"):
                hit = _protected_targets(rest[1:])
                if hit:
                    reasons.append(f"git {sub} would discard local changes to {', '.join(hit)}")
            elif sub == "clean":
                flags = "".join(w for w in rest[1:] if w.startswith("-"))
                if "f" in flags or "--force" in rest:
                    reasons.append("git clean -f can delete untracked files, including .env")

    if reasons:
        return "confirm", "; ".join(dict.fromkeys(reasons))  # de-duplicate, keep order
    return None


def classify(call: ToolCall) -> tuple[str, str] | None:
    if call.tool_name in ("Write", "Edit", "NotebookEdit"):
        path = call.file_path()
        if path and _is_protected(path):
            return "confirm", f"{call.tool_name} targets protected file {_normalise(path)}"
        return None

    if call.tool_name == "Bash":
        command = call.command()
        if not command.strip():
            return None
        return _classify_bash(command)

    return None


if __name__ == "__main__":
    run_hook(HOOK_NAME, classify)
