# Fable Orchestrator Skill Bundle

This repository packages a local orchestration workflow where Codex compiles focused evidence for a stronger Claude Fable advisor during substantial work. Normal consultations are fresh and tool-less; independent repository verification is a rare, scoped audit. Claude Code can use an `/orchestrate` command to plan, dispatch, and review implementation tasks.

The bundle contains:

- `fable-advisor-mcp/`: the V3 MCP server exposing `advisor` and `advisor_verify` tools for Codex, plus the setup kit and reusable skills.
- `codex/AGENTS.md`: guidance for when and how Codex should call the two advisor modes and handle governance notices.
- `codex/config-snippet.toml`: a Codex MCP configuration snippet.
- `claude/commands/orchestrate.md`: a Claude Code command for Fable-led orchestration.
- `INSTALL.md`: device setup and verification notes.

## Install

Prerequisites:

- Node.js 18 or newer.
- `pnpm`.
- Claude Code CLI installed and logged in.
- Codex CLI installed and logged in.

Build and test the MCP server:

```bash
cd fable-advisor-mcp
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Register the MCP server with Codex by copying `codex/config-snippet.toml` into your Codex configuration and replacing `<PATH-TO>` with the local path where this repository lives.

Install the Codex guidance by copying or merging `codex/AGENTS.md` into your Codex global guidance file.

Install the Claude Code command:

```bash
mkdir -p ~/.claude/commands
cp claude/commands/orchestrate.md ~/.claude/commands/orchestrate.md
```

## Verify

After building the MCP server, start a fresh Codex session and confirm both `advisor` and `advisor_verify` appear. The plain advisor should accept `project_state`, use a fresh tool-less call, and return advice ending with an `UNVERIFIED CLAIMS RELIED ON:` section. Reserve `advisor_verify` for a scoped independent audit; it should cite files beneath its required `project_dir`. Either tool may return a clear `Advisor error (...)` message that lets the executor continue.

For the authenticated live verification suite, run `node test/e2e-live.mjs` from `fable-advisor-mcp/`. It checks the response trailer, grounded file verification, and governance artifacts.

For the Claude Code command, start a fresh Claude Code session and run `/orchestrate <task>` against a small local task. Confirm that it plans, dispatches implementation work, and reviews the result.

## License

License is TBD. Add a license before publishing if distribution rights need to be explicit.
