"""Shared plumbing for MaSign's PreToolUse safety hooks (Homework 6).

Every hook is a standalone script Claude Code runs as `PreToolUse`: it gets
one JSON object on stdin describing the tool call about to happen, and must
decide allow / ask / deny before that call is allowed to run. This module is
the one place that:

- reads that JSON without ever raising (a malformed or unexpected payload is
  the input, not an excuse to skip the check),
- writes the decision back in the two shapes Claude Code understands (a JSON
  "ask" on stdout, or exit 2 for a hard "deny"),
- appends every ask/deny to a local audit log the owner can read later.

Fail closed: `read_tool_call()` never throws. If stdin cannot be parsed, it
returns a call with `tool_name=""` and the raw error in `.parse_error`, and
each hook treats that the same as "I cannot classify this" — an `ask`, never
a silent allow. The individual hook scripts wrap their own `main()` in
try/except for the same reason: a crash in a hook's own logic must still end
in `ask`, not in the tool call going through un-checked (Claude Code treats a
non-exit-2 crash as non-blocking, i.e. open — the one failure mode this
module exists to close).
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
DEFAULT_LOG_PATH = HOOKS_DIR / "blocked.log"


@dataclass
class ToolCall:
    tool_name: str
    tool_input: dict = field(default_factory=dict)
    cwd: str = ""
    raw: dict = field(default_factory=dict)
    parse_error: str | None = None

    def command(self) -> str:
        """The shell command for a Bash call, or "" for any other tool."""
        return str(self.tool_input.get("command", "")) if self.tool_name == "Bash" else ""

    def file_path(self) -> str:
        """The path a Write/Edit/NotebookEdit call would touch, or ""."""
        return str(self.tool_input.get("file_path") or self.tool_input.get("notebook_path") or "")

    def written_text(self) -> str:
        """The text a Write/Edit/NotebookEdit call would put in the file."""
        for key in ("content", "new_string", "new_source"):
            if key in self.tool_input:
                return str(self.tool_input[key])
        return ""


def read_tool_call() -> ToolCall:
    """Read and parse stdin. Never raises — a bad payload becomes `parse_error`."""
    try:
        raw_text = sys.stdin.read()
    except Exception as error:  # pragma: no cover - stdin itself failing is exotic
        return ToolCall(tool_name="", parse_error=f"could not read stdin: {error}")
    try:
        payload = json.loads(raw_text) if raw_text.strip() else {}
    except Exception as error:
        return ToolCall(tool_name="", parse_error=f"stdin was not valid JSON: {error}")
    if not isinstance(payload, dict):
        return ToolCall(tool_name="", parse_error="stdin JSON was not an object")
    tool_name = str(payload.get("tool_name") or "")
    if not tool_name:
        # A real PreToolUse invocation always names the tool; empty or
        # missing stdin means we cannot tell what is about to happen, which
        # is exactly the "cannot classify" case the fail-closed rule covers
        # — this is deliberately a parse_error, not a quiet allow.
        return ToolCall(tool_name="", parse_error="no tool_name in the hook payload")
    tool_input = payload.get("tool_input")
    return ToolCall(
        tool_name=tool_name,
        tool_input=tool_input if isinstance(tool_input, dict) else {},
        cwd=str(payload.get("cwd", "")),
        raw=payload,
    )


def _log_path() -> Path:
    # Tests point this at a throwaway file so the real audit log stays clean.
    override = os.environ.get("MASIGN_HOOK_LOG")
    return Path(override) if override else DEFAULT_LOG_PATH


def log_event(*, hook: str, decision: str, reason: str, call: ToolCall) -> None:
    """Append one line to the audit log. A logging failure must not block the
    decision already made — it is caught and swallowed, never raised."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "hook": hook,
        "decision": decision,
        "reason": reason,
        "tool_name": call.tool_name,
        "detail": call.command() or call.file_path() or "(unparsed input)",
    }
    try:
        path = _log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # pragma: no cover - logging must never itself block
        pass


def ask(*, hook: str, reason: str, call: ToolCall) -> None:
    """Force the normal permission prompt instead of letting the call through
    silently. Exits 0: Claude Code reads the JSON on stdout for the decision."""
    log_event(hook=hook, decision="ask", reason=reason, call=call)
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def deny(*, hook: str, reason: str, call: ToolCall) -> None:
    """Hard-block the call: no prompt, no way through. Exit 2 is the
    documented blocking signal — stderr is what Claude (and the owner) sees.

    Written as UTF-8 bytes with `errors="replace"`, not a plain text write:
    stderr's encoding follows the console's codepage, which on Windows is
    not UTF-8 by default, and a non-ASCII character in a reason string
    (caught once during testing — an em dash came out as `?`) must degrade
    to a readable substitute, never raise past a `deny()` that is supposed
    to be the one call in this module guaranteed not to throw."""
    log_event(hook=hook, decision="deny", reason=reason, call=call)
    message = f"[{hook}] BLOCKED: {reason}\n"
    try:
        sys.stderr.buffer.write(message.encode("utf-8", errors="replace"))
        sys.stderr.flush()
    except Exception:  # pragma: no cover - stderr itself failing is exotic
        sys.stderr.write(message.encode("ascii", errors="replace").decode("ascii"))
    sys.exit(2)


def allow() -> None:
    """Explicitly say nothing and get out of the way. This is the common case
    (an ordinary command) and must be cheap and silent."""
    sys.exit(0)


def run_hook(hook_name: str, classify) -> None:
    """Boilerplate every hook script shares: read stdin, run `classify`, and
    guarantee that *any* exception between here and a decision becomes an
    `ask` rather than an uncaught crash (which Claude Code would not treat
    as blocking). `classify(call) -> tuple[str, str] | None` returns
    ("ask"|"deny", reason) or None for "this call is fine"."""
    call = read_tool_call()
    if call.parse_error:
        ask(hook=hook_name, reason=f"could not parse the tool call ({call.parse_error}); failing safe", call=call)
        return
    try:
        verdict = classify(call)
    except Exception:
        ask(
            hook=hook_name,
            reason=f"hook crashed while classifying this call ({traceback.format_exc(limit=2).strip().splitlines()[-1]}); failing safe",
            call=call,
        )
        return
    if verdict is None:
        allow()
        return
    decision, reason = verdict
    if decision == "deny":
        deny(hook=hook_name, reason=reason, call=call)
    else:
        ask(hook=hook_name, reason=reason, call=call)
