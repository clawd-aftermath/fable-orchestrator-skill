# fable-advisor-mcp-server

Gives OpenAI Codex CLI an `advisor` tool backed by **Claude Fable 5** — a client-side port of Anthropic's [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) pattern: a fast executor model consults a higher-intelligence advisor mid-task for strategic guidance.

The native API feature is Claude-to-Claude only, so this MCP server recreates it for a Codex executor. One difference: the executor's transcript is **not** auto-forwarded — Codex passes `task`, `context`, and an optional `question` explicitly. Guidance in `~/.codex/AGENTS.md` steers Codex on when to call it and what to include.

## Auth: runs on your Claude plan, no API key

The default backend shells out to Claude Code headless mode (`claude -p --model claude-fable-5 --tools ""`), so advisor calls use whatever login the `claude` CLI already has (Pro/Max/Enterprise seat). No key, no plaintext secrets. The advisor runs tool-less, mirroring the native advisor's sub-inference.

Optional: set `FABLE_ADVISOR_BACKEND=api` + `ANTHROPIC_API_KEY` to bill the Anthropic API directly instead (per-token at Fable rates).

## Setup

```bash
pnpm install && pnpm build
codex mcp add fable_advisor -- node /path/to/fable-advisor-mcp/dist/index.js
```

Recommended in `~/.codex/config.toml` under the server block: `startup_timeout_sec = 20`, `tool_timeout_sec = 600` (advisor turns can run minutes).

## v2.0.0: grounded verification + governance

Lessons from a project audit (a per-call, no-tools advisor structurally cannot catch mislabeled components, vacuous gates, or whole-program drift) are now built in:

- **`advisor_verify` tool** — same reviewer with read-only tools (`Read`, `Grep`, `Glob`) and a required `project_dir`; it verifies the executor's load-bearing claims against actual files before advising, citing `file:line`. Prefer it for spec reviews, go/no-go calls, and any "X is a solver/independent/frozen/validated" claim. (claude-cli backend only.)
- **`UNVERIFIED CLAIMS RELIED ON:` trailer** — every response ends by listing what the advisor accepted on faith from the executor's self-report, making the trust boundary explicit.
- **Frame-challenge rule** — the advisor first assesses whether a question's frame is sound ("should this gate exist?") before answering within it.
- **Consult log** — every consult appends to `<log dir>/consults.jsonl` (task/question previews, full advice, project dir) for orchestrator review.
- **Review-cadence notice** — past `FABLE_ADVISOR_REVIEW_CONSULTS` consults (default 15) or `FABLE_ADVISOR_REVIEW_DAYS` days (default 5) since the last consolidated review, every response is prefixed with an `[advisor-governance]` notice telling the executor to surface that a full-repo adversarial review is overdue. An orchestrator resets `<log dir>/state.json` (`{"consultsSinceReview": 0, "lastReviewISO": "<now>"}`) when it performs one.
- **Standing project brief** — set `FABLE_ADVISOR_BRIEF` to a markdown file (goal, current stage, red flags); it is prepended to the system prompt on every call and re-read each time, so orchestrator edits apply without a server restart.

## Config env vars

| Var | Default | Purpose |
|---|---|---|
| `FABLE_ADVISOR_MODEL` | `claude-fable-5` | Advisor model id |
| `FABLE_ADVISOR_BACKEND` | `claude-cli` | `claude-cli` (plan login) or `api` (ANTHROPIC_API_KEY) |
| `FABLE_ADVISOR_CLAUDE_BIN` | `~/.local/bin/claude(.exe)`, then PATH | Claude binary location |
| `FABLE_ADVISOR_EFFORT` | unset (session default) | `low`–`max` effort for the advisor |
| `FABLE_ADVISOR_TIMEOUT_MS` | `570000` | Kill advisor call after this (keep < Codex tool_timeout_sec) |
| `FABLE_ADVISOR_MAX_TOKENS` | `8192` | API backend only: advisor output cap (thinking + text) |
| `FABLE_ADVISOR_BRIEF` | unset | Path to standing project brief prepended to the system prompt |
| `FABLE_ADVISOR_LOG_DIR` | `~/.fable-advisor` | Consult log + review-cadence state location |
| `FABLE_ADVISOR_REVIEW_CONSULTS` | `15` | Consults before the governance notice fires |
| `FABLE_ADVISOR_REVIEW_DAYS` | `5` | Days since last review before the notice fires |

## Behavior notes

- Advisor errors (CLI missing, auth, timeout, rate limit, refusal) return as `Advisor error (...)` text so the executor continues without advice — mirroring the native tool's error semantics.
- API backend tags truncated advice `[Advisor output truncated at max_tokens=N.]`, matching the native tool.
- Governance bookkeeping failures never fail a consult (log to stderr only).
- Per-call diagnostics go to stderr.

## Tests

- `pnpm test` (`test/e2e-hang.mjs`) — POSIX-only pipe-deadlock regression; skips on Windows.
- `node test/e2e-live.mjs` — live round-trip against the real claude CLI (fast model): trailer presence, `advisor_verify` catching a planted vacuous gate, and governance artifacts. Requires a logged-in CLI.
