# fable-advisor-mcp-server

Gives OpenAI Codex CLI an `advisor` tool backed by **Claude Fable 5** — a client-side port of Anthropic's [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) pattern: a fast executor model consults a higher-intelligence advisor mid-task for strategic guidance.

The native API feature is Claude-to-Claude only, so this MCP server recreates it for a Codex executor. One difference: the executor's transcript is **not** auto-forwarded — Codex passes `task`, optional compact `project_state`, direct-evidence `context`, and an optional `question` explicitly. Guidance in `~/.codex/AGENTS.md` steers Codex on when to call it and what to include.

## Auth: runs on your Claude plan, no API key

The default backend shells out to Claude Code headless mode (`claude -p --model claude-fable-5 --tools ""`), so advisor calls use whatever login the `claude` CLI already has (Pro/Max/Enterprise seat). No key, no plaintext secrets. The advisor runs tool-less, mirroring the native advisor's sub-inference.

Optional: set `FABLE_ADVISOR_BACKEND=api` + `ANTHROPIC_API_KEY` to bill the Anthropic API directly instead (per-token at Fable rates).

## Setup

```bash
pnpm install && pnpm build
codex mcp add fable_advisor -- node /path/to/fable-advisor-mcp/dist/index.js
```

Recommended in `~/.codex/config.toml` under the server block: `startup_timeout_sec = 20`, `tool_timeout_sec = 600` (advisor turns can run minutes).

## v3.0.0: fresh rich advice, exceptional audits

V3 separates strategic advice from independent repository verification:

- **Fresh plain advice is normal.** Codex compiles compact project state plus the controlling excerpts, diffs, outputs, contradictory evidence, uncertainties, and current plan. Plain calls use `--tools ""` and `--no-session-persistence`; no hidden transcript or resumed history accumulates.
- **`project_state` is bounded.** The optional field is limited to 12,000 characters and rendered separately before the direct-evidence `context`, whose safety ceiling remains 400,000 characters.
- **Audits are exceptional and scoped.** Use one fresh `advisor_verify` only for an explicit user audit request, a specific factual dispute that cannot be packaged credibly, or a genuinely costly-to-undo/irreversible authorization decision. Routine completion, ordinary tests/gates, and plan negotiation stay plain.
- **One semantic safeguard, no regex coercion.** Fable may withhold `proceed` when a high-impact authorization lacks independent evidence, but the server no longer stamps keyword-matched completion text or automatically forces verification.
- **Economics are observable.** Each consult log records the tool, project-state size/hash, backend, input/cache/output tokens, turns, duration, and reported cost when available.

## v2.0.0: grounded verification + governance

Lessons from a project audit (a per-call, no-tools advisor structurally cannot catch mislabeled components, vacuous gates, or whole-program drift) are built in:

- **`advisor_verify` tool** — same reviewer with read-only tools (`Read`, `Grep`, `Glob`) and a required `project_dir`; it independently verifies one scoped set of claims against actual files, citing `file:line`. This is an exceptional audit path on the CLI backend, not the default review tool.
- **`UNVERIFIED CLAIMS RELIED ON:` trailer** — every response ends by listing what the advisor accepted on faith from the executor's self-report, making the trust boundary explicit.
- **Frame-challenge rule** — the advisor first assesses whether a question's frame is sound ("should this gate exist?") before answering within it.
- **Consult log** — every consult appends to `<log dir>/consults.jsonl` (task/question previews, full advice, project dir) for orchestrator review.
- **Review-cadence notice (manual-first as of v2.3.1)** — the `[advisor-governance]` notice appears when the user requests a review via `{"reviewRequested": true}` in `<log dir>/state.json`; it then prefixes every response until an orchestrator completes the review and resets the file (`{"consultsSinceReview": 0, "lastReviewISO": "<now>", "reviewRequested": false}`). Significant consults are still counted (only `depth: "deep"` calls, or tasks/questions with decision-class language: freeze/seal/launch/authorize/approve/promote/go-no-go/preregister/sign-off) so `consultsSinceReview` remains a signal for deciding when to trigger one. Automatic nagging is opt-in: set `FABLE_ADVISOR_REVIEW_CONSULTS` and/or `FABLE_ADVISOR_REVIEW_DAYS` to fire the notice on count/age thresholds.
- **Standing project brief** — set `FABLE_ADVISOR_BRIEF` to a markdown file (goal, current stage, red flags); it is re-read on every call as background, not direct evidence. Current quoted evidence wins when they conflict.

## Config env vars

| Var | Default | Purpose |
|---|---|---|
| `FABLE_ADVISOR_MODEL` | `claude-fable-5` | Advisor model id |
| `FABLE_ADVISOR_BACKEND` | `claude-cli` | `claude-cli` (plan login) or `api` (ANTHROPIC_API_KEY) |
| `FABLE_ADVISOR_CLAUDE_BIN` | `~/.local/bin/claude`, then PATH | Claude binary location |
| `FABLE_ADVISOR_EFFORT` | unset (session default) | `low`–`max` effort for the advisor (no-depth calls) |
| `FABLE_ADVISOR_DEEP_EFFORT` | `xhigh` | Effort for `depth: "deep"` calls (`max` risks the timeout on big-repo verifies) |
| `FABLE_ADVISOR_TIMEOUT_MS` | `570000` | Kill advisor call after this (keep < Codex tool_timeout_sec) |
| `FABLE_ADVISOR_MAX_TOKENS` | `8192` | API backend only: advisor output cap (thinking + text) |
| `FABLE_ADVISOR_BRIEF` | unset | Path to standing project brief prepended to the system prompt |
| `FABLE_ADVISOR_LOG_DIR` | `~/.fable-advisor` | Consult log + review-cadence state location |
| `FABLE_ADVISOR_REVIEW_CONSULTS` | unset (off) | Opt-in: significant consults before the governance notice fires automatically |
| `FABLE_ADVISOR_REVIEW_DAYS` | unset (off) | Opt-in: days since last review before the notice fires automatically |

## v2.4.0: v1 economics, v2 context

Token-usage correction after real-world data (43 consults/day, 41 of them `advisor_verify` — each a full repo-reading Fable session on the user's Claude plan). The operating model inverts back to v1's shape, keeping v2's context quality:

- **Plain `advisor` is the default for every consult.** Codex supplies the context by pasting load-bearing excerpts (code, diffs, outputs) — the cheap direction, and better than v1's thin summaries.
- **`advisor_verify` is the reserved exception**: only when the user explicitly asks for a verified/grounded review, or for one final go/no-go on costly-to-undo work.

## v2.3.0: verdicts + token discipline

- **`VERDICT: proceed|revise|stop` opener** — mandatory first line of every advisor response; Codex branches on it cheaply and `consults.jsonl` records it (`verdict` field), so pushback frequency is greppable.
- **Pointers over excerpts** — `advisor_verify` guidance now tells the executor to pass claims + `file:line` pointers instead of pasted code (the advisor reads originals itself), and to pass its own session rollout dir via `additional_dirs` on `depth: "deep"` consults so the advisor audits the actual transcript, not the executor's account.
- **Steering de-duplicated** — tool descriptions no longer restate the input schema, and the AGENTS.md snippet carries only rules of engagement (mechanics live in the tool descriptions); roughly 40% less standing context in every Codex turn.
- **`depth: "deep"` maps to `xhigh`** (was `max`) so big-repo verifies stop dying at the timeout with nothing to show; `FABLE_ADVISOR_DEEP_EFFORT=max` restores the old behavior.
- **Tighter significance regex** — `spec`/`contract`/`gate` no longer count ordinary engineering talk toward review debt.

## Behavior notes

- Advisor errors (CLI missing, auth, timeout, rate limit, refusal) return as `Advisor error (...)` text so the executor continues without advice — mirroring the native tool's error semantics.
- API backend tags truncated advice `[Advisor output truncated at max_tokens=N.]`, matching the native tool.
- Governance bookkeeping failures never fail a consult (log to stderr only).
- Per-call diagnostics go to stderr.

## Tests

- `pnpm test` — pipe-deadlock regression plus deterministic V3 architecture checks (fresh/tool-less calls, state cap, scoped audit, and token/tool telemetry).
- `node test/e2e-live.mjs` — live round-trip against the real claude CLI (fast model): trailer presence, `advisor_verify` catching a planted vacuous gate, and governance artifacts. Requires a logged-in CLI.
