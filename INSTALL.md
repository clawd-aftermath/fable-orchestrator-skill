# Fable Orchestrator + Advisor — install on a new device

This bundle contains three pieces that work together:

1. **`fable-advisor-mcp/`** — MCP server that gives Codex CLI `advisor` and
   grounded `advisor_verify` tools backed by Claude Fable 5 (runs headless via
   `claude -p`, billed to your Claude plan — no API key needed).
2. **`codex/AGENTS.md`** — global guidance telling Codex when/how to call each
   advisor mode and how to handle verification trailers and governance notices
   (goes in `~/.codex/`).
3. **`claude/commands/orchestrate.md`** — the `/orchestrate` skill for Claude
   Code (Fable plans/reviews, Codex implements).

## Prerequisites

- Node.js >= 18 and pnpm (`npm i -g pnpm`)
- Claude Code CLI installed and logged in (`claude` on PATH) — the advisor
  spawns `claude -p --model claude-fable-5`
- Codex CLI installed and logged in
- The `codex-plugin-cc` plugin installed in Claude Code (the `/orchestrate`
  skill dispatches through `/codex:rescue`)

## 1. Install the MCP server

```bash
mkdir -p ~/projects
cp -R fable-advisor-mcp ~/projects/fable-advisor-mcp
cd ~/projects/fable-advisor-mcp
pnpm install
pnpm build
npm test          # deadlock + V3 routing/telemetry regressions
```

## 2. Register it with Codex

Append the block in `codex/config-snippet.toml` to `~/.codex/config.toml`,
replacing `<PATH-TO>` with the real path (e.g.
`~/projects/fable-advisor-mcp`).

## 3. Install the advisor guidance for Codex

If `~/.codex/AGENTS.md` doesn't exist:

```bash
cp codex/AGENTS.md ~/.codex/AGENTS.md
```

If it already exists, append the "Fable Advisor" section from this bundle's
`codex/AGENTS.md` to it.

## 4. Install the /orchestrate skill for Claude Code

```bash
mkdir -p ~/.claude/commands
cp claude/commands/orchestrate.md ~/.claude/commands/orchestrate.md
```

Copy the reusable Codex skills referenced by the guidance:

```bash
mkdir -p ~/.agents/skills
cp -R fable-advisor-mcp/setup/skills/adversarial-engineering ~/.agents/skills/
cp -R fable-advisor-mcp/setup/skills/plan-negotiation ~/.agents/skills/
```

See `fable-advisor-mcp/setup/SETUP.md` for the standing project brief and
review-cadence state setup.

## 5. Verify

- From `fable-advisor-mcp/`, run `pnpm test`; expect the deadlock regression
  and all four deterministic V3 checks to pass. Optionally run
  `node test/e2e-live.mjs` with a logged-in Claude CLI.
- New Codex thread → confirm both `advisor` and `advisor_verify` are present.
  A plain response should accept `project_state`, end with
  `UNVERIFIED CLAIMS RELIED ON:`, and run without tools or resumed history.
  The grounded tool should be reserved for a scoped audit and cite files
  beneath its `project_dir`.
- New Claude Code session → `/orchestrate <some small task>` should plan,
  dispatch to Codex, and review.

## Gotchas (learned the hard way)

- **Stale server processes:** long-running MCP server processes keep old code
  until respawned. After any rebuild, run `npm run flush-stale` and restart
  the ChatGPT app if its embedded `codex app-server` hosts threads — those
  can hold stale MCP processes for days.
- Advisor calls self-kill at 570s (config tool timeout is 600s).
- Every call is fresh. The advisor sees ONLY what Codex passes in
  task/project_state/context/question — the transcript is not auto-forwarded
  or resumed (AGENTS.md covers this).
- Optional API fallback: `FABLE_ADVISOR_BACKEND=api` + `ANTHROPIC_API_KEY`,
  but plan-based `claude -p` is the intended default.
