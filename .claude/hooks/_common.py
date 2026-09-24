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
import queue
import re
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
DEFAULT_LOG_PATH = HOOKS_DIR / "blocked.log"
CONFIRM_CODE_FILE = HOOKS_DIR / ".confirm_code"

CONFIRM_CODE_ENV = "MASIGN_CONFIRM_CODE"
CONFIRM_CODE_FILE_ENV = "MASIGN_CONFIRM_CODE_FILE"
CONFIRM_TIMEOUT_ENV = "MASIGN_CONFIRM_TIMEOUT"
CONFIRM_TEST_INPUT_ENV = "MASIGN_HOOK_TEST_CONFIRM_INPUT"
DEFAULT_CONFIRM_TIMEOUT = 20.0


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


def _confirm_code() -> str | None:
    """The code a correct answer must match. Env var first (a teammate can
    set it per-shell without touching a tracked file); a local, git-ignored
    `.confirm_code` file next (survives across shells without relying on how
    Claude Code propagates environment variables to a hook subprocess, which
    was not verified either way). Neither present -> None, and `confirm()`
    treats that as "cannot confirm", not "nothing to check".

    The file's path is itself overridable via `MASIGN_CONFIRM_CODE_FILE` --
    not for production use, but so `tests/test_safety_hooks.py` can point it
    at a guaranteed-empty tmp path and get a deterministic "no code
    configured" case, regardless of whether the real
    `.claude/hooks/.confirm_code` happens to exist on the machine running
    the tests (it legitimately does on a dev machine that has set one up)."""
    env_value = os.environ.get(CONFIRM_CODE_ENV, "").strip()
    if env_value:
        return env_value
    file_override = os.environ.get(CONFIRM_CODE_FILE_ENV)
    code_file = Path(file_override) if file_override else CONFIRM_CODE_FILE
    try:
        file_value = code_file.read_text(encoding="utf-8").strip()
    except Exception:
        return None
    return file_value or None


def _open_terminal_for_confirmation():
    """POSIX only (see `_prompt_windows_new_console` for why Windows does not
    use this). A read/write handle onto the *real* controlling terminal,
    independent of this process's own stdin (already consumed by the
    tool-call JSON) and stdout (piped back to Claude Code, not guaranteed to
    reach a human watching in real time). `/dev/tty` opens the controlling
    terminal directly rather than whatever this process's stdio was
    redirected to, and raises if none is attached at all -- the unattended
    case this function exists to detect and refuse, not paper over."""
    try:
        handle = open("/dev/tty", "r+", encoding="utf-8", errors="replace")
        return handle, handle
    except OSError:
        return None, None


_CONFIRM_WINDOW_TITLE = "MaSign confirmation required"


def _bring_window_to_foreground(title: str, poll_seconds: float = 5.0) -> None:
    """Best-effort only -- found live to matter: `CREATE_NEW_CONSOLE` opens a
    window, but Windows does not give it focus, so on a desktop with several
    other windows already open it can land behind all of them with no
    visible signal it exists -- the console genuinely opened, the owner
    genuinely never saw it. Polls (title changes are not instant) for a
    top-level window with this exact title -- set by the `title` command in
    `_prompt_windows_new_console`'s script -- and forces it forward. Looked
    up by title, not by the spawned process's PID: on a machine where
    Windows Terminal is the default console host (Windows 11's default --
    confirmed live on the dev machine this was built on via
    `Get-Process | Where MainWindowTitle`, which found a real
    `WindowsTerminal` process correctly titled this way), the visible
    top-level window can belong to Windows Terminal, not to the `cmd.exe`
    process this module spawned, so a PID-based lookup would find nothing.

    `SetForegroundWindow` alone was found live not to be enough: Windows
    deliberately blocks background/unattended processes from stealing
    focus and silently no-ops the call rather than erroring, so a window
    can exist, be correctly titled, and still never visibly appear.
    `FlashWindowEx` is the API meant for exactly this case -- notify
    without stealing focus -- and is not subject to the same block, so
    both are attempted: foreground if Windows allows it, a flashing
    taskbar entry if it does not. Uses only `ctypes` (no pywin32
    dependency, consistent with the rest of this project's
    dependency-free hook scripts); any failure here is cosmetic -- the
    confirmation prompt and its timeout still work correctly either way,
    it just might not visibly announce itself."""
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        deadline = time.time() + poll_seconds
        hwnd = 0
        while time.time() < deadline and not hwnd:
            hwnd = user32.FindWindowW(None, title)
            if not hwnd:
                time.sleep(0.15)
        if not hwnd:
            return

        SW_RESTORE = 9
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)

        class FLASHWINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.UINT),
                ("hwnd", wintypes.HWND),
                ("dwFlags", wintypes.DWORD),
                ("uCount", wintypes.UINT),
                ("dwTimeout", wintypes.DWORD),
            ]

        FLASHW_ALL = 0x00000003
        FLASHW_TIMERNOFG = 0x0000000C  # flash until the window gets focus
        info = FLASHWINFO(
            cbSize=ctypes.sizeof(FLASHWINFO),
            hwnd=hwnd,
            dwFlags=FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount=0,
            dwTimeout=0,
        )
        user32.FlashWindowEx(ctypes.byref(info))
    except Exception:  # pragma: no cover - cosmetic, never the actual decision
        pass


def _prompt_windows_new_console(prompt_text: str, timeout: float) -> str | None:
    """Windows only. Found live: opening `CONIN$`/`CONOUT$` (this process's
    *own* console handles) does not raise in this project's actual harness
    (a Claude Code session running inside a VSCode extension host) -- but it
    also is not a window the person can see or type into. Something in that
    process tree has *a* console attached, just not one that is visible,
    which meant every real confirmation silently ran out its full timeout
    with nobody ever having had a chance to answer -- safe (it still denies)
    but not what a confirmation prompt is for.

    The fix is to stop relying on whatever console this process inherited
    and instead spawn a brand new one on purpose: `CREATE_NEW_CONSOLE` asks
    Windows for a fresh, independent console window, not a handle onto this
    process's existing (possibly hidden) one. A small `cmd.exe /c set /p`
    script in that new window shows the prompt and reads one line from
    *its own* input -- genuinely separate from this process's stdin/stdout
    either way -- and writes what was typed to a throwaway temp file this
    function reads back, because piping the new console's stdout would
    defeat the point of giving it its own visible one."""
    import subprocess
    import tempfile

    fd, path = tempfile.mkstemp(prefix="masign_confirm_", suffix=".txt")
    os.close(fd)
    try:
        # cmd.exe's own escaping: `&`, `|`, `^` need a caret in front of them
        # inside a /c command line, or they get interpreted as shell syntax.
        safe_prompt = re.sub(r"([&|^<>])", r"^\1", prompt_text)
        script = (
            f"title {_CONFIRM_WINDOW_TITLE} & "
            f"echo {safe_prompt} & "
            f'set /p CODE="Type the confirmation code and press Enter: " & '
            f'>"{path}" echo %CODE%'
        )
        try:
            proc = subprocess.Popen(["cmd.exe", "/c", script], creationflags=subprocess.CREATE_NEW_CONSOLE)
        except Exception:
            return None
        threading.Thread(target=_bring_window_to_foreground, args=(_CONFIRM_WINDOW_TITLE,), daemon=True).start()
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:  # pragma: no cover - best-effort cleanup
                pass
            return None
        try:
            content = Path(path).read_text(encoding="utf-8", errors="replace").strip()
        except Exception:
            return None
        return content or None
    finally:
        try:
            os.remove(path)
        except Exception:  # pragma: no cover - best-effort cleanup
            pass


def _read_line_with_timeout(read_handle, timeout: float) -> str | None:
    """Block on `readline()` in a background thread so a human who never
    answers cannot hang the hook forever -- `thread.join(timeout)` returns
    control either way. A thread still blocked in `readline()` after the
    timeout is abandoned deliberately: it is a daemon thread, so it cannot
    keep the process alive, and the caller must not attempt to close the
    handle out from under it (that risk is why the close happens only on the
    non-timeout path, in `confirm()`)."""
    result: "queue.Queue[str | None]" = queue.Queue(maxsize=1)

    def _reader() -> None:
        try:
            line = read_handle.readline()
        except Exception:
            line = None
        try:
            result.put_nowait(line)
        except Exception:  # pragma: no cover - queue is never full before this
            pass

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        return None
    try:
        line = result.get_nowait()
    except queue.Empty:  # pragma: no cover - thread finished, so it put something
        return None
    return line.strip() if line is not None else None


def confirm(*, hook: str, reason: str, call: ToolCall, action_text: str) -> None:
    """A fourth decision, stronger than `ask` and short of an unconditional
    `deny`: the call proceeds only if a human at the real console types a
    code the owner chose themselves, within a time limit. Exists because a
    live test proved plain `ask` does not stop anything in an unattended
    ("Auto Mode") session -- see block_history_rewrite.py's docstring for
    the full account -- while a blanket `deny` would remove the "sometimes
    this really is the right command" flexibility Hook 3 was built to keep
    (an interactive rebase to clean up a branch before a PR is not wrong).

    Deliberately bypasses Claude Code's own ask/allow plumbing: that
    plumbing is the part shown to pass an unattended session through
    unanswered, so this talks directly to the OS console instead. On
    Windows that means a brand new, genuinely visible console window
    (`_prompt_windows_new_console`) rather than this process's own
    `CONIN$`/`CONOUT$` -- found live, in this project's actual VSCode-
    extension harness, to open without error but attach to a console
    nobody could see, which meant every confirmation ran out its timeout
    unanswered even with a human right there. On POSIX, `/dev/tty` (see
    `_open_terminal_for_confirmation`) is the controlling terminal itself,
    which does not have that problem. Every branch that cannot positively
    confirm a match fails closed as `deny`: no code configured anywhere,
    no console attached or spawnable, a wrong code, or nobody answering
    before the timeout. Only a correct code typed in time allows the call
    through.

    Test seam: `MASIGN_HOOK_TEST_CONFIRM_INPUT`, read in place of prompting
    at all, lets `tests/test_safety_hooks.py` supply "what was typed"
    without scripting a real keystroke into a real console window (not
    something a subprocess test can portably do) -- it still exercises the
    same match/mismatch branches this function uses live, it only swaps out
    where the answer comes from. The no-answer/timeout path is exercised
    for real, against the real platform-specific prompt, with
    `MASIGN_CONFIRM_TIMEOUT` set low so the test does not hang."""
    expected = _confirm_code()
    if not expected:
        deny(
            hook=hook,
            reason=f"{reason} [no confirmation code configured -- set {CONFIRM_CODE_ENV} or {CONFIRM_CODE_FILE.name} to enable a typed override; denied, fail closed]",
            call=call,
        )
        return

    try:
        timeout = float(os.environ.get(CONFIRM_TIMEOUT_ENV, DEFAULT_CONFIRM_TIMEOUT))
    except ValueError:
        timeout = DEFAULT_CONFIRM_TIMEOUT

    test_input = os.environ.get(CONFIRM_TEST_INPUT_ENV)
    if test_input is not None:
        typed = test_input.strip()
    elif os.name == "nt":
        prompt_text = f"[{hook}] CONFIRMATION REQUIRED: {reason} -- about to run: {action_text}"
        typed = _prompt_windows_new_console(prompt_text, timeout)
        if typed is None:
            deny(
                hook=hook,
                reason=f"{reason} [no confirmation code entered within {timeout:.0f}s (or the console could not be opened) -- denied, fail closed]",
                call=call,
            )
            return
    else:
        read_handle, write_handle = _open_terminal_for_confirmation()
        if read_handle is None:
            deny(
                hook=hook,
                reason=f"{reason} [no interactive console attached to confirm -- denied, fail closed]",
                call=call,
            )
            return
        try:
            write_handle.write(
                f"\n[{hook}] CONFIRMATION REQUIRED\n{reason}\n"
                f"About to run: {action_text}\n"
                f"Type the confirmation code within {timeout:.0f}s to allow this, "
                "anything else (or nothing) denies it: "
            )
            write_handle.flush()
        except Exception:  # pragma: no cover - a write failure still falls through to the read
            pass
        typed = _read_line_with_timeout(read_handle, timeout)
        if typed is None:
            deny(
                hook=hook,
                reason=f"{reason} [no confirmation code entered within {timeout:.0f}s -- denied, fail closed]",
                call=call,
            )
            return
        try:
            read_handle.close()
            if write_handle is not read_handle:
                write_handle.close()
        except Exception:  # pragma: no cover - closing is cleanup, not the decision
            pass

    if typed == expected:
        log_event(hook=hook, decision="confirmed", reason=reason, call=call)
        sys.exit(0)

    deny(hook=hook, reason=f"{reason} [confirmation code did not match -- denied]", call=call)


def allow() -> None:
    """Explicitly say nothing and get out of the way. This is the common case
    (an ordinary command) and must be cheap and silent."""
    sys.exit(0)


def run_hook(hook_name: str, classify) -> None:
    """Boilerplate every hook script shares: read stdin, run `classify`, and
    guarantee that *any* exception between here and a decision becomes a
    safe outcome rather than an uncaught crash (which Claude Code would not
    treat as blocking -- a bare Python traceback exits 1, not 2).
    `classify(call) -> tuple[str, str] | None` returns
    ("ask"|"deny"|"confirm", reason) or None for "this call is fine".

    A crash while *classifying* becomes `ask` -- found and fixed live: this
    was the only exception boundary here until `confirm()` was added, and
    `confirm()` is real I/O (spawning a console process on Windows,
    threading on POSIX), not pure pattern-matching, so it can fail in ways
    `ask`/`deny` cannot. A crash while *acting on* a `confirm` decision now
    escalates to `deny`, not `ask`: `classify` already judged this call
    risky enough to require a human-typed code, so if the mechanism meant
    to collect that code breaks, falling back to `ask` -- proven elsewhere
    in this project not to reliably stop anything unattended -- would be a
    silent downgrade of a decision already made, not a neutral fallback."""
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
    try:
        if decision == "deny":
            deny(hook=hook_name, reason=reason, call=call)
        elif decision == "confirm":
            action_text = call.command() or call.file_path() or "(no command text captured)"
            confirm(hook=hook_name, reason=reason, call=call, action_text=action_text)
        else:
            ask(hook=hook_name, reason=reason, call=call)
    except Exception:
        # deny()/ask()/confirm() all end in sys.exit(), which raises
        # SystemExit -- a BaseException this `except Exception` does not
        # catch, so reaching here means one of them crashed before exiting.
        deny(
            hook=hook_name,
            reason=f"{reason} [hook crashed while acting on its own {decision!r} decision ({traceback.format_exc(limit=2).strip().splitlines()[-1]}); failing to the strictest option, deny]",
            call=call,
        )
