# Limited secret scan — 2026-11-02

MAS-203 repeats the public-repository check before presentation changes.

| Scope | Result |
| --- | --- |
| Base | `0502e460ae3699305240a4b59b023c43f038f83b` |
| Local reachable history (`git log --all -p`) | 353 commits; 0 matching lines |
| Current tracked files (`git ls-files`) | 269 files; 0 matching files |
| `.env` history | 0 entries; currently ignored |
| Tracked `.claude/` files | 14 shared skills, command and hook files |
| Tracked local settings or confirmation-code file | 0 |

Patterns cover Anthropic and OpenAI keys (including project/service-account
forms), Atlassian tokens, AWS access-key IDs, GitHub tokens (including fine
grained tokens), Slack tokens and PEM private-key headers. Only counts and
file/line locations were reported; credential values were never printed.

A path/email inspection of the tracked agent files found one repository-path
example in `.claude/hooks/block_history_rewrite.py:96`. It explains Git Bash
path conversion; it is not a user-home path or a credential. The ignore rules
explicitly retain shared tools while excluding local settings, hook logs and
`.confirm_code`.

This scan cannot establish absence of secrets. It excludes unreachable Git
objects, remote refs not fetched locally, untracked files and secrets with
unrecognised formats. Generic passwords and sensitive document contents need
separate review. Existing local developer configuration was not published.

The README's compact repeat command covers fewer token formats than this run.
Repeat a full scan on the final release commit; do not reuse this result as
evidence for future commits.
