# Fable Advisor MCP v2.0.0 — setup kit for a new machine

Everything needed to give OpenAI Codex CLI the `advisor` + `advisor_verify`
tools backed by Claude Fable 5, with the governance features (unverified-claims
trailer, consult log, review-cadence notice, standing project brief).

## Prerequisites on the target machine

- Node.js >= 18 (`node --version`)
- pnpm (`npm i -g pnpm`) — or plain npm works too
- Claude Code CLI installed AND logged in (run `claude` once interactively)
- OpenAI Codex CLI installed

## 1. Get the code

You are reading this inside the repo — `git clone` already done. All setup
materials referenced below live in this `setup/` folder.

## 2. Build

```bash
pnpm install
pnpm build        # -> dist/index.js
```

## 3. Register with Codex

Either `codex mcp add fable_advisor -- node <ABS_PATH>/dist/index.js`, or add
the block from `setup/config-toml-snippet.toml` to `~/.codex/config.toml`,
fixing the three absolute paths for the new machine:

- `args` → path to `dist/index.js`
- `FABLE_ADVISOR_CLAUDE_BIN` → path to the claude binary
  (optional — the server also probes common user-local locations and `PATH`)
- `FABLE_ADVISOR_BRIEF` → path to your standing project brief (optional but
  recommended; see step 5)

## 4. Codex guidance

Append `setup/agents-md-snippet.md` to `~/.codex/AGENTS.md` (create the
file if missing). It teaches Codex when to call `advisor` vs `advisor_verify`,
to act on the UNVERIFIED CLAIMS trailer, and to surface `[advisor-governance]`
notices verbatim.

Also copy `setup/skills/adversarial-engineering/` and
`setup/skills/plan-negotiation/` to `~/.agents/skills/` — the snippet's later
sections (expensive-work rules; Claude-authored plan negotiation) reference
them.

## 5. Standing project brief (recommended)

Copy `setup/ADVISOR_BRIEF.template.md` somewhere stable (e.g. the workspace root),
fill it in for whatever project that machine works on, and point
`FABLE_ADVISOR_BRIEF` at it. The server re-reads it on every call, so keep it
updated as the project moves — no restart needed.

## 6. Seed governance state (recommended)

So the review-cadence clock starts from a known point:

```bash
mkdir -p ~/.fable-advisor
printf '{\n  "consultsSinceReview": 0,\n  "lastReviewISO": "%s"\n}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.fable-advisor/state.json
```

The orchestrator (Claude) resets this file the same way whenever it completes
a consolidated adversarial review. The consult history accumulates next to it
in `~/.fable-advisor/consults.jsonl`.

## 7. Verify

```bash
node test/e2e-live.mjs
```

Expect `PASS 1/2/3` then `ALL PASS` (~1–2 min; uses a fast model against the
logged-in claude CLI). Then restart Codex so it picks up the server, and check
its tool list shows both `advisor` and `advisor_verify`.

## Operating notes

- The running MCP server holds loaded code in memory: after any rebuild,
  restart Codex to activate changes.
- Governance thresholds are tunable via `FABLE_ADVISOR_REVIEW_CONSULTS`
  (default 15) and `FABLE_ADVISOR_REVIEW_DAYS` (default 5).
- `advisor_verify` requires the claude-cli backend (the default). The `api`
  backend supports only the plain `advisor` tool.
- Full docs: README.md in the repo.
