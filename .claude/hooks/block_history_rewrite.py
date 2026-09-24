#!/usr/bin/env python3
"""Hook 3 (Homework 6): ask before any git operation that rewrites history
or forces work onto `main` outside the branch+PR flow (masign-ticket-flow).

Originally scoped as "block direct pushes to main"; widened per the owner's
sign-off on 2026-09-24 to the whole family of commands that discard commits
or rewrite them in place, because the incident that motivated Homework 6
was a `git reset --hard`, not a push:

  - `git push` (or `push --force`/`-f`) straight to `main` — direct or via
    `origin HEAD:main`, or a plain `git push` while `main` is checked out.
  - `git push --force` / `-f` / `--force-with-lease` to *any* branch — a
    force-push can discard a collaborator's commits regardless of branch.
  - `git reset --hard` — discards uncommitted work and, with a ref, commits.
  - `git commit --amend` — rewrites the tip commit already pushed elsewhere.
  - `git rebase` (any form) — rewrites commit history.
  - `git filter-branch` — rewrites the whole history.
  - `git reflog expire` — removes the safety net `reset --hard` itself
    depends on for recovery.
  - `git gc --prune=...` (explicit prune) — can garbage-collect commits that
    are only reachable via reflog, i.e. the same safety net.

IMPORTANT, found live while building this hook: `ask` prints
`permissionDecision: "ask"` and exits 0 so Claude Code raises its normal
interactive permission prompt — and a `git push origin HEAD:main` and a
`git reset --hard HEAD` both ran through, unprompted, in an autonomous
("Auto Mode") session with nobody present to answer that prompt, in the
same session that had block_destructive_sql.py's hard `deny` stop a real
DROP + TABLE attempt outright, no prompt involved, every single time it
was tried. This was not a bug in this file's classification (both commands
were independently confirmed to return the right decision when the script
is run standalone against the same input) — it is that `ask` delegates to
a permission system an unattended session can sail through, while `deny`
(exit 2) is unconditional and never enters that system at all.

Two decisions came out of that finding (owner sign-off, 2026-09-24), split
by how reversible the command is:

- `git push` to `main`, and any `--force`/`-f`/`--force-with-lease` push,
  stay `ask`. A push reaching a shared remote is itself the point where a
  second human (a PR reviewer) is already in the loop before it lands
  anywhere permanent — Hook 1 (file protection) is left the same way for
  the same reason: both act on things a human downstream still gets a
  chance to see before real damage.
- `git reset --hard`, `commit --amend`, `rebase`, `filter-branch`,
  `reflog expire` and `gc --prune` — the commands that can quietly destroy
  local work with no remote or reviewer ever in a position to notice — are
  now `confirm`, not `ask`: a new decision (`_common.py`'s `confirm()`)
  that does not use Claude Code's permission prompt at all. It opens the
  real OS console directly (bypassing this process's own stdin, already
  consumed by the tool-call JSON, and its stdout, not guaranteed to reach
  a human watching in real time) and requires a human to type a
  confirmation code the owner set themselves — in `MASIGN_CONFIRM_CODE` or
  a local, git-ignored `.claude/hooks/.confirm_code` file — within a time
  limit. No code configured, no console attached (exactly the unattended
  case above), a wrong code, or nobody answering in time: every one of
  those denies, same as Hook 2. Only a correct, human-typed code lets the
  call through, so an unattended session now gets a real stop here instead
  of a silent pass-through, while a human physically present keeps the
  flexibility a blanket `deny` would have removed. See `_common.confirm()`
  for the full mechanism and its test seam.
"""

from __future__ import annotations

import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ToolCall, run_hook  # noqa: E402

HOOK_NAME = "block-history-rewrite"


def _split_commands(command: str) -> list[list[str]]:
    pieces = re.split(r"&&|\|\||;|\n", command)
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


_POSIX_DRIVE_RE = re.compile(r"^/([A-Za-z])/(.*)$")


def _windows_style(path: str) -> str | None:
    """`/c/Github-Ai/MaSign` -> `C:/Github-Ai/MaSign`. This project runs a
    native Windows Python under a Git-Bash shell, so the `cwd` a hook
    receives can be POSIX-style even though the interpreter is not — a
    caught-in-testing case (`subprocess.run(cwd="/c/...")` raises
    `NotADirectoryError` on Windows) worth a real fallback rather than
    silently degrading every branch lookup to "unknown"."""
    match = _POSIX_DRIVE_RE.match(path)
    return f"{match.group(1).upper()}:/{match.group(2)}" if match else None


def _current_branch(cwd: str) -> str | None:
    """Best-effort: None (not "main") if it cannot be determined — a hook
    that can't tell what branch it's on must not use that as a reason to
    wave a push through, so callers treat None as "assume it could be main"
    for the no-explicit-target case specifically."""
    candidates = [cwd] if cwd else [None]
    if cwd:
        alt = _windows_style(cwd)
        if alt:
            candidates.append(alt)
    for candidate in candidates:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=candidate,
                capture_output=True,
                text=True,
                timeout=5,
            )
        except Exception:
            continue
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    return None


def _push_targets_main(words: list[str], cwd: str) -> bool:
    """`words` is the full `git push ...` argv (word[0] == 'push')."""
    non_flags = [w for w in words[1:] if not w.startswith("-")]
    # `git push origin HEAD:main` / `git push origin refs/heads/main`
    for arg in non_flags:
        target = arg.split(":", 1)[-1]
        target = target.rsplit("/", 1)[-1]
        if target == "main":
            return True
    # An explicit non-main branch name (and no ':main' refspec) means this
    # push is not aimed at main, whatever the current branch is.
    if len(non_flags) >= 2:
        return False
    # `git push` / `git push origin` with no explicit branch: git pushes the
    # current branch (or its configured upstream). If we cannot tell what
    # that is, fail closed rather than assume it is safe.
    branch = _current_branch(cwd)
    return branch is None or branch == "main"


def _is_force_push(words: list[str]) -> bool:
    return any(w in ("--force", "-f", "--force-with-lease") for w in words[1:])


def classify(call: ToolCall) -> tuple[str, str] | None:
    if call.tool_name != "Bash":
        return None
    command = call.command()
    if not command.strip():
        return None

    for words in _split_commands(command):
        if len(words) < 2 or words[0] != "git":
            continue
        sub = words[1]
        rest = words[2:]

        if sub == "push":
            if _push_targets_main(words[1:], call.cwd):
                return "ask", "git push would push directly to main — use a feature branch + PR (masign-ticket-flow)"
            if _is_force_push(words[1:]):
                return "ask", "git push --force can discard commits on the remote branch"

        elif sub == "reset" and "--hard" in rest:
            return "confirm", "git reset --hard discards uncommitted work (and commits, with a ref) — this is the exact command that wiped uncommitted CLAUDE.md/.gitignore edits once already"

        elif sub == "commit" and "--amend" in rest:
            return "confirm", "git commit --amend rewrites the tip commit, which may already be pushed"

        elif sub == "rebase":
            return "confirm", "git rebase rewrites commit history"

        elif sub == "filter-branch":
            return "confirm", "git filter-branch rewrites the entire history"

        elif sub == "reflog" and rest[:1] == ["expire"]:
            return "confirm", "git reflog expire removes the recovery net that a bad reset/rebase depends on"

        elif sub == "gc" and any(w == "--prune" or w.startswith("--prune=") for w in rest):
            return "confirm", "git gc --prune can permanently remove commits only reachable via reflog"

    return None


if __name__ == "__main__":
    run_hook(HOOK_NAME, classify)
