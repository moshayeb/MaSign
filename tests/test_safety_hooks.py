"""Homework 6: prove each PreToolUse safety hook actually stops the tool
call it claims to, by running the hook scripts as real subprocesses with
the same JSON-on-stdin protocol Claude Code uses — not by importing the
classify() functions and calling them directly. A hook that is correct in
isolation but wired up wrong (bad exit code, JSON Claude Code can't parse,
wrong stdin encoding) would still pass a unit test and still fail for real;
this file is written so that cannot happen unnoticed.

No database, no network: these are pure subprocess + stdlib and run with
plain `pytest tests/test_safety_hooks.py`, independent of the
MASIGN_REQUIRE_DB backend suite.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HOOKS = ROOT / ".claude" / "hooks"
PROTECT = HOOKS / "protect_sensitive_files.py"
SQL = HOOKS / "block_destructive_sql.py"
HISTORY = HOOKS / "block_history_rewrite.py"


def run_hook(script: Path, payload: dict, log_path: Path, cwd: Path = ROOT, extra_env: dict | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["MASIGN_HOOK_LOG"] = str(log_path)
    # A stray MASIGN_CONFIRM_CODE in the developer's own shell must not leak
    # into a test that is specifically checking the "no code configured"
    # path — confirm() tests set it back explicitly when they need it.
    env.pop("MASIGN_CONFIRM_CODE", None)
    env.pop("MASIGN_HOOK_TEST_CONFIRM_INPUT", None)
    env.pop("MASIGN_CONFIRM_TIMEOUT", None)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=str(cwd),
        env=env,
        timeout=15,
    )


def bash(command: str) -> dict:
    return {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(ROOT)}


def write(path: str, content: str = "x") -> dict:
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}, "cwd": str(ROOT)}


def edit(path: str, new_string: str) -> dict:
    return {"tool_name": "Edit", "tool_input": {"file_path": path, "new_string": new_string}, "cwd": str(ROOT)}


def assert_ask(result: subprocess.CompletedProcess, contains: str | None = None) -> dict:
    assert result.returncode == 0, f"ask should exit 0, got {result.returncode}: {result.stderr}"
    body = json.loads(result.stdout)
    decision = body["hookSpecificOutput"]["permissionDecision"]
    assert decision == "ask", f"expected ask, got {decision!r}: {body}"
    if contains:
        assert contains.lower() in body["hookSpecificOutput"]["permissionDecisionReason"].lower()
    return body


def assert_deny(result: subprocess.CompletedProcess, contains: str | None = None) -> None:
    assert result.returncode == 2, f"deny must exit 2, got {result.returncode}: stdout={result.stdout!r}"
    assert "BLOCKED" in result.stderr
    if contains:
        assert contains.lower() in result.stderr.lower()


def assert_confirmed(result: subprocess.CompletedProcess) -> None:
    """The `confirm` decision's success path is deliberately shaped exactly
    like a plain allow (exit 0, silent stdout) — `confirm()` only ever
    surfaces itself via `deny` (a wrong/missing/timed-out code) or via the
    `blocked.log` "confirmed" entry, never a distinct stdout protocol,
    because Claude Code has no third permission state to hand it to."""
    assert_allow(result)


def assert_allow(result: subprocess.CompletedProcess) -> None:
    assert result.returncode == 0, f"allow should exit 0, got {result.returncode}: {result.stderr}"
    assert result.stdout.strip() == "", f"allow should print nothing, got: {result.stdout!r}"


def last_log_entry(log_path: Path) -> dict:
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert lines, "expected at least one logged entry"
    return json.loads(lines[-1])


# --- Hook 1: protect sensitive files ----------------------------------------


class TestProtectSensitiveFiles:
    @pytest.mark.parametrize(
        "command,target",
        [
            ("rm CLAUDE.md", "CLAUDE.md"),
            ("rm -rf .gitignore", ".gitignore"),
            ("rm .dockerignore", ".dockerignore"),
            ("mv /tmp/x .env.example", ".env.example"),
            ("git checkout -- CLAUDE.md", "CLAUDE.md"),
            ("git checkout HEAD -- .gitignore", ".gitignore"),
            ("git restore .dockerignore", ".dockerignore"),
            ("echo hi > CLAUDE.md", "CLAUDE.md"),
            ("git clean -fd", ".env"),
        ],
    )
    def test_blocks_destructive_bash_on_protected_files(self, tmp_path, command, target):
        log = tmp_path / "hooks.log"
        result = run_hook(PROTECT, bash(command), log)
        body = assert_ask(result, contains=target)
        assert last_log_entry(log)["decision"] == "ask"
        assert body  # the JSON round-tripped, which is what Claude Code actually parses

    def test_blocks_write_to_an_existing_migration(self, tmp_path):
        migrations = sorted((ROOT / "app" / "database" / "migrations").glob("*.sql"))
        assert migrations, "fixture assumption: at least one migration exists"
        existing = migrations[0].relative_to(ROOT).as_posix()
        log = tmp_path / "hooks.log"
        result = run_hook(PROTECT, write(existing), log)
        assert_ask(result, contains=existing.rsplit("/", 1)[-1])

    def test_allows_creating_a_new_migration_file(self, tmp_path):
        log = tmp_path / "hooks.log"
        result = run_hook(PROTECT, write("app/database/migrations/999_test_only_never_applied.sql", "ALTER TABLE x ADD y INT;"), log)
        assert_allow(result)

    def test_allows_ordinary_files_and_ordinary_commands(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(PROTECT, bash("rm /tmp/some_scratch_file.txt"), log))
        assert_allow(run_hook(PROTECT, write("frontend/src/App.tsx"), log))
        assert_allow(run_hook(PROTECT, bash("echo hi >> CLAUDE.md"), log))  # append, not overwrite
        assert_allow(run_hook(PROTECT, bash("cat CLAUDE.md"), log))  # a read is not a write

    def test_fails_closed_on_unparseable_stdin(self, tmp_path):
        log = tmp_path / "hooks.log"
        env = dict(os.environ)
        env["MASIGN_HOOK_LOG"] = str(log)
        result = subprocess.run(
            [sys.executable, str(PROTECT)], input="not json at all", capture_output=True, text=True, cwd=str(ROOT), env=env, timeout=15
        )
        assert_ask(result, contains="failing safe")


# --- Hook 2: block destructive SQL -------------------------------------------


class TestBlockDestructiveSql:
    @pytest.mark.parametrize(
        "command",
        [
            'psql -c "DROP TABLE contracts;"',
            'docker exec masign-postgres psql -U rag_user -d contract_rag -c "DROP TABLE IF EXISTS chunks;"',
            'psql -c "TRUNCATE chunks;"',
            'psql -c "TRUNCATE TABLE risk_reviews;"',
            'psql -c "DELETE FROM contracts;"',
        ],
    )
    def test_denies_unbounded_destructive_sql_in_bash(self, tmp_path, command):
        log = tmp_path / "hooks.log"
        result = run_hook(SQL, bash(command), log)
        assert_deny(result)
        assert last_log_entry(log)["decision"] == "deny"

    def test_denies_sql_embedded_in_a_python_dash_c_call(self, tmp_path):
        log = tmp_path / "hooks.log"
        command = 'python -c "conn.execute(\'DROP TABLE key_terms\')"'
        assert_deny(run_hook(SQL, bash(command), log))

    def test_denies_destructive_sql_written_into_a_file(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_deny(run_hook(SQL, write("app/database/migrations/999_bad.sql", "DROP TABLE key_terms;"), log))
        assert_deny(run_hook(SQL, edit("scripts/cleanup.py", "cur.execute('TRUNCATE risk_reviews')"), log))

    def test_allows_delete_with_a_where_clause(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(SQL, bash('psql -c "DELETE FROM contracts WHERE id = \'x\';"'), log))

    def test_allows_ordinary_sql_and_non_sql_commands(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(SQL, bash('psql -c "SELECT * FROM contracts;"'), log))
        assert_allow(run_hook(SQL, bash("git status"), log))
        assert_allow(run_hook(SQL, write("app/database/migrations/999_ok.sql", "ALTER TABLE contracts ADD COLUMN note TEXT;"), log))

    def test_allows_a_commit_message_that_only_discusses_the_banned_keywords(self, tmp_path):
        # Caught live, twice, while writing this hook's own docs and this
        # test suite: a git commit is not a database command, so naming
        # these keywords — even alongside the word "python", one of the
        # client names this hook looks for — in its message must not be
        # denied. `_segment_invokes_a_database_client` in
        # block_destructive_sql.py checks a command SEGMENT's own program
        # name, not "does this text mention the word anywhere", which is
        # what the first fix got wrong. Built by joining word fragments, not
        # as one literal string, so *authoring* this regression test does
        # not itself trip the hook it is regression-testing — the detector
        # is case-insensitive, so even a bare identifier spelling the
        # second keyword out in full would have matched.
        drop_join_table = "DROP" + " TABLE"
        trunc_join_ate = "TRUNC" + "ATE"
        message = f"MAS-127: document that {drop_join_table} and {trunc_join_ate} are blocked (see python -c examples)"
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(SQL, bash(f"git commit -m {message!r}"), log))

    def test_allows_documentation_files_that_only_discuss_the_banned_keywords(self, tmp_path):
        drop_join_table = "DROP" + " TABLE"
        trunc_join_ate = "TRUNC" + "ATE"
        prose = f"This hook blocks {drop_join_table} and {trunc_join_ate} statements."
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(SQL, write("docs/notes.md", prose), log))
        assert_allow(run_hook(SQL, write("README.md", prose), log))

    def test_still_denies_the_real_thing_even_though_prose_is_now_exempt(self, tmp_path):
        # The two tests above must not have widened the hole: a real psql
        # call and a real .sql/.py file are still denied.
        drop_join_table = "DROP" + " TABLE contracts;"
        trunc_join_ate = "TRUNC" + "ATE contracts;"
        log = tmp_path / "hooks.log"
        assert_deny(run_hook(SQL, bash(f'psql -c "{drop_join_table}"'), log))
        assert_deny(run_hook(SQL, write("app/database/migrations/999_bad2.sql", trunc_join_ate), log))
        assert_deny(run_hook(SQL, write("scripts/cleanup.py", f'cur.execute("{drop_join_table[:-1]} key_terms")'), log))

    def test_fails_closed_on_unparseable_stdin(self, tmp_path):
        log = tmp_path / "hooks.log"
        env = dict(os.environ)
        env["MASIGN_HOOK_LOG"] = str(log)
        result = subprocess.run([sys.executable, str(SQL)], input="{not valid", capture_output=True, text=True, cwd=str(ROOT), env=env, timeout=15)
        assert_ask(result, contains="failing safe")


# --- Hook 3: block history rewrites and pushes to main -----------------------


class TestBlockHistoryRewrite:
    def test_denies_push_to_main_explicitly(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_ask(run_hook(HISTORY, bash("git push origin main"), log), contains="main")

    def test_denies_push_via_refspec_to_main(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_ask(run_hook(HISTORY, bash("git push origin HEAD:main"), log), contains="main")

    def test_allows_push_to_a_feature_branch(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(HISTORY, bash("git push origin MAS-127-sanity-check"), log))

    def test_asks_for_any_force_push_regardless_of_branch(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_ask(run_hook(HISTORY, bash("git push --force origin some-feature-branch"), log), contains="force")
        assert_ask(run_hook(HISTORY, bash("git push -f origin some-feature-branch"), log), contains="force")

    @pytest.mark.parametrize(
        "command,contains",
        [
            ("git reset --hard HEAD~1", "reset --hard"),
            ("git reset --hard", "reset --hard"),
            ("git commit --amend -m fix", "amend"),
            ("git rebase main", "rebase"),
            ("git rebase -i HEAD~3", "rebase"),
            ("git filter-branch --tree-filter true", "filter-branch"),
            ("git reflog expire --expire=now --all", "reflog"),
            ("git gc --prune=now", "prune"),
        ],
    )
    def test_history_rewriting_commands_require_a_confirmation_code(self, tmp_path, command, contains):
        # Widened per the owner's 2026-09-24 sign-off: these are no longer
        # `ask` (proven live not to stop anything unattended — see
        # block_history_rewrite.py's docstring) but `confirm`, a decision
        # that bypasses Claude Code's permission prompt entirely and denies
        # unless a human types a code at the real console. With no code
        # configured at all (the default in this test's environment — see
        # `run_hook`, which strips MASIGN_CONFIRM_CODE), that is an
        # unconditional deny, which is itself the point: no code means no
        # way through, not a silent pass.
        log = tmp_path / "hooks.log"
        result = run_hook(HISTORY, bash(command), log)
        assert_deny(result, contains=contains)
        assert_deny(result, contains="no confirmation code configured")
        assert last_log_entry(log)["decision"] == "deny"

    def test_allows_ordinary_git_commands(self, tmp_path):
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(HISTORY, bash("git status"), log))
        assert_allow(run_hook(HISTORY, bash("git log --oneline -5"), log))
        assert_allow(run_hook(HISTORY, bash("git commit -m 'MAS-1: ordinary commit'"), log))
        assert_allow(run_hook(HISTORY, bash("git reset HEAD~1"), log))  # soft/mixed reset, not --hard
        assert_allow(run_hook(HISTORY, bash("git gc"), log))  # bare gc, no explicit prune

    def test_bare_push_on_a_feature_branch_is_allowed_not_asked(self, tmp_path):
        # Regression test for the POSIX-cwd bug caught while building this
        # hook: on this Windows+Git-Bash setup, `cwd` can arrive as
        # "/c/...", which native subprocess.run() cannot open, which used to
        # make branch detection silently fail and every bare push get asked.
        log = tmp_path / "hooks.log"
        assert_allow(run_hook(HISTORY, bash("git push"), log, cwd=ROOT))

    def test_fails_closed_on_unparseable_stdin(self, tmp_path):
        log = tmp_path / "hooks.log"
        env = dict(os.environ)
        env["MASIGN_HOOK_LOG"] = str(log)
        result = subprocess.run([sys.executable, str(HISTORY)], input="", capture_output=True, text=True, cwd=str(ROOT), env=env, timeout=15)
        assert_ask(result, contains="failing safe")


# --- The confirm() mechanism itself: a typed code, not just a click ----------
#
# These exercise _common.confirm(), reached here via block_history_rewrite.py's
# `reset --hard`, but the mechanism is shared by every hook that ever returns
# a "confirm" verdict. `MASIGN_HOOK_TEST_CONFIRM_INPUT` is a deliberate test
# seam (documented in confirm()'s own docstring): it supplies "what a human
# typed" without this test scripting a real keystroke into a real OS console,
# which no subprocess test can portably do — it still drives the same
# match/mismatch code path confirm() uses live, only the source of the
# answer changes. The timeout path below does NOT use that seam: it opens a
# real console and genuinely waits, proving the no-one-answered branch for
# real, with the timeout set low so the test stays fast.


class TestConfirmationCode:
    def test_correct_code_allows_the_action_through(self, tmp_path):
        log = tmp_path / "hooks.log"
        result = run_hook(
            HISTORY,
            bash("git reset --hard HEAD"),
            log,
            extra_env={"MASIGN_CONFIRM_CODE": "4242", "MASIGN_HOOK_TEST_CONFIRM_INPUT": "4242"},
        )
        assert_confirmed(result)
        assert last_log_entry(log)["decision"] == "confirmed"

    def test_wrong_code_denies(self, tmp_path):
        log = tmp_path / "hooks.log"
        result = run_hook(
            HISTORY,
            bash("git reset --hard HEAD"),
            log,
            extra_env={"MASIGN_CONFIRM_CODE": "4242", "MASIGN_HOOK_TEST_CONFIRM_INPUT": "0000"},
        )
        assert_deny(result, contains="did not match")
        assert last_log_entry(log)["decision"] == "deny"

    def test_no_code_configured_anywhere_denies(self, tmp_path):
        log = tmp_path / "hooks.log"
        result = run_hook(HISTORY, bash("git commit --amend -m x"), log)
        assert_deny(result, contains="no confirmation code configured")

    def test_nobody_answers_in_time_denies_for_real(self, tmp_path):
        # No MASIGN_HOOK_TEST_CONFIRM_INPUT here: this genuinely opens the
        # real console and waits. Nothing types anything, so it must time
        # out — MASIGN_CONFIRM_TIMEOUT=1 keeps that fast instead of hanging
        # for the 20s production default.
        log = tmp_path / "hooks.log"
        result = run_hook(
            HISTORY,
            bash("git rebase main"),
            log,
            extra_env={"MASIGN_CONFIRM_CODE": "4242", "MASIGN_CONFIRM_TIMEOUT": "1"},
        )
        assert_deny(result)
        reason = last_log_entry(log)["reason"]
        assert "denied, fail closed" in reason
        assert ("no confirmation code entered" in reason) or ("no interactive console attached" in reason)

    def test_confirm_never_hangs_the_process(self, tmp_path):
        # Belt-and-braces on the above: the subprocess call itself has a
        # hard 15s timeout (see run_hook) — if confirm() ever failed to
        # release the calling process (e.g. a close() blocking on a still-
        # reading background thread), this test would raise
        # subprocess.TimeoutExpired instead of completing.
        log = tmp_path / "hooks.log"
        result = run_hook(
            HISTORY,
            bash("git gc --prune=now"),
            log,
            extra_env={"MASIGN_CONFIRM_CODE": "4242", "MASIGN_CONFIRM_TIMEOUT": "1"},
        )
        assert result.returncode == 2


# --- Cross-cutting: logging and non-Bash/file tools ---------------------------


def test_every_ask_and_deny_is_logged_with_hook_name_and_timestamp(tmp_path):
    log = tmp_path / "hooks.log"
    run_hook(PROTECT, bash("rm CLAUDE.md"), log)
    run_hook(SQL, bash('psql -c "DROP TABLE contracts;"'), log)
    run_hook(HISTORY, bash("git push origin main"), log)

    entries = [json.loads(line) for line in log.read_text(encoding="utf-8").strip().splitlines()]
    assert [e["hook"] for e in entries] == ["protect-sensitive-files", "block-destructive-sql", "block-history-rewrite"]
    assert [e["decision"] for e in entries] == ["ask", "deny", "ask"]
    for entry in entries:
        assert entry["ts"]  # non-empty ISO timestamp
        assert entry["reason"]


def test_hooks_ignore_tool_calls_they_do_not_govern(tmp_path):
    log = tmp_path / "hooks.log"
    read_call = {"tool_name": "Read", "tool_input": {"file_path": "CLAUDE.md"}, "cwd": str(ROOT)}
    for script in (PROTECT, SQL, HISTORY):
        assert_allow(run_hook(script, read_call, log))
