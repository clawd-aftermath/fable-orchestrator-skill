#!/usr/bin/env node
/**
 * fable-advisor-mcp-server
 *
 * Gives an executor agent (OpenAI Codex CLI) an `advisor` tool backed by
 * Claude Fable 5 — a client-side port of Anthropic's server-side advisor
 * tool pattern (executor model consults a higher-intelligence advisor
 * mid-task for strategic guidance).
 *
 * Default backend shells out to Claude Code headless mode (`claude -p`),
 * so advisor calls run on the user's existing Claude plan login — no API
 * key. Set FABLE_ADVISOR_BACKEND=api + ANTHROPIC_API_KEY to bill the
 * Anthropic API directly instead.
 *
 * Unlike the native API feature, the executor's transcript is NOT
 * auto-forwarded: the executor must pass its task, progress, and question
 * explicitly. The tool description and ~/.codex/AGENTS.md guidance steer
 * Codex to do that.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const ADVISOR_MODEL = process.env.FABLE_ADVISOR_MODEL ?? "claude-fable-5";
const ADVISOR_BACKEND = process.env.FABLE_ADVISOR_BACKEND ?? "claude-cli";
// API backend only: cap covers thinking + text. Fable thinks on every call
// and its tokenizer runs ~30% heavier than Opus-tier, so this sits well
// above the 2048 the native advisor tool recommends.
const ADVISOR_MAX_TOKENS = Number(process.env.FABLE_ADVISOR_MAX_TOKENS ?? 8192);
const ADVISOR_EFFORT = process.env.FABLE_ADVISOR_EFFORT as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | undefined;
// Keep under Codex's tool_timeout_sec (600) so we return a readable error
// instead of Codex killing the call.
const ADVISOR_TIMEOUT_MS = Number(process.env.FABLE_ADVISOR_TIMEOUT_MS ?? 570_000);

// advisor_verify: read-only tools the grounded advisor may use.
const VERIFY_TOOLS = "Read,Grep,Glob";

// Consult log + review-cadence state live outside any project repo so they
// never show up as untracked files in governance-audited checkouts.
const GOVERNANCE_DIR =
  process.env.FABLE_ADVISOR_LOG_DIR ?? join(homedir(), ".fable-advisor");
const CONSULT_LOG_PATH = join(GOVERNANCE_DIR, "consults.jsonl");
const GOVERNANCE_STATE_PATH = join(GOVERNANCE_DIR, "state.json");
// Past either threshold, every response carries a standing notice that a
// consolidated full-repo adversarial review is overdue. An orchestrator
// session resets state.json when it performs one.
const REVIEW_CONSULT_THRESHOLD = Number(
  process.env.FABLE_ADVISOR_REVIEW_CONSULTS ?? 15,
);
const REVIEW_AGE_DAYS_THRESHOLD = Number(
  process.env.FABLE_ADVISOR_REVIEW_DAYS ?? 5,
);

// Optional standing project brief (goal, current stage, known red flags)
// prepended to the system prompt. Read at call time so orchestrator edits
// apply without a server restart.
const BRIEF_PATH = process.env.FABLE_ADVISOR_BRIEF;

const SHARED_RULES = `Produce a plan or course correction, not the implementation:
- If the executor asked a specific question, answer it directly first — but if the question presupposes a frame (e.g. "how do I make this gate pass?"), first assess whether the frame itself is sound (should this gate exist? is this the right experiment?). A well-executed step inside a wrong frame is still wrong.
- Identify the highest-leverage next steps and the failure modes the executor has not ruled out.
- Be concrete: name files, commands, APIs, invariants, and tests where the provided context allows.
- The executor's account may be incomplete or subtly wrong. Challenge assumptions its evidence does not support. Watch for inflated labels: a component's name in the executor's narrative (e.g. "CFR teacher", "independent evaluator") is a claim, not a fact.
- Keep guidance under roughly 300 words unless genuine complexity demands more. Give the shape of the solution and the tricky parts; never write the full implementation.
- End EVERY response with a section titled exactly "UNVERIFIED CLAIMS RELIED ON:" listing each load-bearing claim from the executor's context that you accepted without direct evidence (or "none"). Keep each item to one line. This section is mandatory — it marks the trust boundary for the executor and the human.`;

const ADVISOR_SYSTEM = `You are the advisor: a higher-intelligence model that a faster coding agent ("the executor" — OpenAI Codex) consults mid-task for strategic guidance. The executor sends you its task, a self-reported account of its progress (files read, commands run, results, errors), and optionally a specific question. Answer directly from the provided context; do not use tools.

${SHARED_RULES}`;

const ADVISOR_VERIFY_SYSTEM = `You are the grounded advisor: a higher-intelligence model that a faster coding agent ("the executor" — OpenAI Codex) consults mid-task, with read-only access (Read, Grep, Glob) to the project working directory. The executor sends you its task, a self-reported account of its progress, and optionally a specific question.

Before advising, VERIFY the load-bearing claims in the executor's account against the actual files. Do not accept the executor's labels for what a component is or does — open the file and check. Prioritize: (1) claims the advice would be built on, (2) names/labels of components ("X is a solver", "Y is independent", "Z is frozen"), (3) any metric, gate, or test the executor says passes — read the code that computes it and confirm it can actually fail. Cite file paths and line numbers for what you verified. Budget your reading: verify the few claims that matter, not everything.

${SHARED_RULES.replace(
  'that you accepted without direct evidence (or "none")',
  'that you could not verify with the available tools (or "none"); claims you did verify belong in the body with file:line citations',
)}`;

interface AdvisorInput {
  task: string;
  context: string;
  question?: string;
}

// ---------------------------------------------------------------------------
// Governance: project brief, consult log, review-cadence notice.
// ---------------------------------------------------------------------------

/** Prepend the standing project brief (if configured and readable). */
function withBrief(system: string): string {
  if (!BRIEF_PATH) return system;
  try {
    const brief = readFileSync(BRIEF_PATH, "utf8").trim();
    if (!brief) return system;
    return `# Standing project brief (maintained by the user's orchestrator — trust over the executor's narrative where they conflict)\n${brief}\n\n${system}`;
  } catch {
    return system; // Missing/unreadable brief must never break a consult.
  }
}

interface GovernanceState {
  consultsSinceReview: number;
  lastReviewISO: string | null;
}

function readGovernanceState(): GovernanceState {
  try {
    const raw = JSON.parse(readFileSync(GOVERNANCE_STATE_PATH, "utf8"));
    return {
      consultsSinceReview: Number(raw.consultsSinceReview) || 0,
      lastReviewISO: typeof raw.lastReviewISO === "string" ? raw.lastReviewISO : null,
    };
  } catch {
    return { consultsSinceReview: 0, lastReviewISO: null };
  }
}

/**
 * Increment the consult counter and return the standing notice when a
 * consolidated review is overdue. State/log I/O must never fail a consult.
 */
function recordConsultAndGetNotice(entry: {
  tool: string;
  task: string;
  context: string;
  question?: string;
  projectDir?: string;
  advice: string;
}): string | null {
  try {
    mkdirSync(GOVERNANCE_DIR, { recursive: true });
    const state = readGovernanceState();
    state.consultsSinceReview += 1;
    if (!state.lastReviewISO) state.lastReviewISO = new Date().toISOString();
    writeFileSync(GOVERNANCE_STATE_PATH, JSON.stringify(state, null, 2) + "\n");

    appendFileSync(
      CONSULT_LOG_PATH,
      JSON.stringify({
        ts: new Date().toISOString(),
        tool: entry.tool,
        projectDir: entry.projectDir ?? null,
        taskPreview: entry.task.slice(0, 300),
        contextChars: entry.context.length,
        questionPreview: entry.question?.slice(0, 300) ?? null,
        advice: entry.advice,
        consultsSinceReview: state.consultsSinceReview,
        serverVersion: SERVER_VERSION,
      }) + "\n",
    );

    const ageDays =
      (Date.now() - Date.parse(state.lastReviewISO)) / 86_400_000;
    if (
      state.consultsSinceReview >= REVIEW_CONSULT_THRESHOLD ||
      ageDays >= REVIEW_AGE_DAYS_THRESHOLD
    ) {
      return (
        `[advisor-governance] ${state.consultsSinceReview} consults since the last consolidated review` +
        (state.lastReviewISO ? ` (last: ${state.lastReviewISO.slice(0, 10)})` : "") +
        ". A full-repo adversarial review is overdue — surface this notice to the user verbatim and recommend scheduling one before further frozen specs, seals, or launch approvals. Per-consult advice cannot catch whole-program drift."
      );
    }
    return null;
  } catch (error) {
    console.error("[fable-advisor] governance bookkeeping failed:", error);
    return null;
  }
}

function buildAdvisorPrompt(params: AdvisorInput): string {
  const sections = [
    "# Task the executor is working on",
    params.task,
    "",
    "# Executor's self-reported progress and context",
    params.context,
  ];
  if (params.question) {
    sections.push("", "# Specific question for you", params.question);
  }
  sections.push(
    "",
    "(Advisor: keep your guidance focused — a plan and the tricky parts, not a comprehensive essay.)",
  );
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Backend 1 (default): Claude Code headless mode — runs on the user's plan.
// ---------------------------------------------------------------------------

function resolveClaudeBin(): string {
  if (process.env.FABLE_ADVISOR_CLAUDE_BIN) {
    return process.env.FABLE_ADVISOR_CLAUDE_BIN;
  }
  // Codex may spawn this server with a PATH that misses user bin dirs.
  const wellKnown = join(homedir(), ".local", "bin", "claude");
  for (const candidate of process.platform === "win32"
    ? [`${wellKnown}.exe`, `${wellKnown}.cmd`, wellKnown]
    : [wellKnown]) {
    if (existsSync(candidate)) return candidate;
  }
  return "claude";
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(
  bin: string,
  args: string[],
  input: string,
  timeoutMs: number,
  cwd?: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let flushTimer: NodeJS.Timeout | undefined;

    // Liveness invariant: this promise MUST settle exactly once no matter
    // which combination of 'exit'/'close'/'error'/timeout fires. Resolving
    // only on 'close' deadlocks when the child leaves behind a grandchild
    // that inherited its stdio pipes: the child exits, 'close' never fires,
    // and (observed 2026-07-10) the advisor call hangs past its own timeout.
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (flushTimer) clearTimeout(flushTimer);
      resolve({ code, stdout, stderr, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // Don't wait for 'close' after the kill — if the pipes are held open
      // elsewhere it never comes. Give the streams a beat, then settle.
      setTimeout(() => settle(null), 2_000);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    // If the child dies before reading stdin, the write EPIPEs; an unhandled
    // stream error would crash the whole server. Swallow it — the exit/close
    // handlers still report the child's exit code.
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    // Preferred path: 'close' means stdio fully drained — settle immediately.
    child.on("close", (code) => settle(code));
    // Fallback: 'exit' always fires when the process ends. Allow 1.5s for
    // any remaining stdout to drain toward 'close'; if 'close' never comes
    // (orphaned grandchild holding the pipe), settle with what we have.
    child.on("exit", (code) => {
      flushTimer = setTimeout(() => settle(code), 1_500);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

interface CliConsultOptions {
  system: string;
  tools: string;
  cwd?: string;
}

async function consultViaClaudeCli(
  params: AdvisorInput,
  opts: CliConsultOptions,
): Promise<string> {
  const bin = resolveClaudeBin();
  const args = [
    "-p",
    "--model",
    ADVISOR_MODEL,
    "--system-prompt",
    opts.system,
    "--tools",
    opts.tools,
    "--strict-mcp-config",
    "--output-format",
    "text",
  ];
  if (ADVISOR_EFFORT) {
    args.push("--effort", ADVISOR_EFFORT);
  }

  let result: ProcessResult;
  try {
    result = await runProcess(
      bin,
      args,
      buildAdvisorPrompt(params),
      ADVISOR_TIMEOUT_MS,
      opts.cwd,
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return (
        `Advisor error (claude_cli_not_found): '${bin}' is not on this server's PATH. ` +
        "Tell the user to set FABLE_ADVISOR_CLAUDE_BIN to the claude binary path. " +
        "Continue the task without advice."
      );
    }
    throw error;
  }

  if (result.timedOut) {
    return `Advisor error (execution_time_exceeded): the advisor call exceeded ${Math.round(ADVISOR_TIMEOUT_MS / 1000)}s and was killed. Continue the task without advice.`;
  }
  const advice = result.stdout.trim();
  if (result.code !== 0 || !advice) {
    const detail = (result.stderr.trim() || advice || "no output").slice(0, 500);
    return (
      `Advisor error (claude_cli_exit_${result.code ?? "unknown"}): ${detail}. ` +
      "If this mentions authentication or login, tell the user to run `claude` once " +
      "interactively to sign in. Continue the task without advice."
    );
  }
  console.error(`[fable-advisor] claude-cli ${ADVISOR_MODEL} ok (${advice.length} chars)`);
  return advice;
}

// ---------------------------------------------------------------------------
// Backend 2 (opt-in): direct Anthropic API with ANTHROPIC_API_KEY.
// ---------------------------------------------------------------------------

function apiErrorText(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Advisor error (authentication): the Anthropic API key was rejected. Tell the user to check ANTHROPIC_API_KEY for this MCP server. Continue the task without advice.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Advisor error (too_many_requests): the advisor call was rate-limited. Continue without advice; retry on the next natural checkpoint.";
  }
  if (error instanceof Anthropic.APIError && error.status === 529) {
    return "Advisor error (overloaded): the advisor hit capacity limits. Continue without advice; retry on the next natural checkpoint.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Advisor error (${error.status ?? "unknown"}): ${error.message}. Continue the task without advice.`;
  }
  return `Advisor error (unavailable): ${error instanceof Error ? error.message : String(error)}. Continue the task without advice.`;
}

async function consultViaApi(
  params: AdvisorInput,
  system: string,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Advisor error (no_api_key): FABLE_ADVISOR_BACKEND=api requires ANTHROPIC_API_KEY. Continue the task without advice.";
  }
  const client = new Anthropic();
  // Fable 5: thinking is always on — omit the `thinking` param entirely.
  // Streaming keeps long advisor turns inside HTTP timeouts.
  const stream = client.messages.stream({
    model: ADVISOR_MODEL,
    max_tokens: ADVISOR_MAX_TOKENS,
    ...(ADVISOR_EFFORT ? { output_config: { effort: ADVISOR_EFFORT } } : {}),
    system,
    messages: [{ role: "user", content: buildAdvisorPrompt(params) }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    return "Advisor error (refusal): the advisor declined this request for safety reasons. Continue the task without advice.";
  }

  let advice = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!advice) {
    return "Advisor error (empty_response): the advisor returned no text. Continue the task without advice.";
  }
  if (message.stop_reason === "max_tokens") {
    advice += `\n\n[Advisor output truncated at max_tokens=${ADVISOR_MAX_TOKENS}.]`;
  }

  console.error(
    `[fable-advisor] api ${ADVISOR_MODEL} in=${message.usage.input_tokens} out=${message.usage.output_tokens} stop=${message.stop_reason}`,
  );
  return advice;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

// Bump on behavior changes: printed at startup so `ps` + codex logs can tell
// a stale long-lived server process from one running current code.
const SERVER_VERSION = "2.0.0";

const server = new McpServer({
  name: "fable-advisor-mcp-server",
  version: SERVER_VERSION,
});

const COMMON_INPUT_SCHEMA = {
  task: z
    .string()
    .min(1, "task is required")
    .max(50_000)
    .describe("The user's task/request, verbatim or faithfully summarized"),
  context: z
    .string()
    .min(1, "context is required — the advisor sees nothing else")
    .max(400_000)
    .describe(
      "Self-reported progress: files read, commands run, outputs, errors, code excerpts, current plan",
    ),
  question: z
    .string()
    .max(10_000)
    .optional()
    .describe("Specific decision or question to resolve (optional)"),
};

const COMMON_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Shared consult path: backend call, then governance bookkeeping. */
async function runConsult(
  tool: string,
  params: AdvisorInput,
  cli: CliConsultOptions,
  projectDir?: string,
): Promise<string> {
  let advice: string;
  try {
    advice =
      ADVISOR_BACKEND === "api"
        ? await consultViaApi(params, withBrief(cli.system))
        : await consultViaClaudeCli(params, { ...cli, system: withBrief(cli.system) });
  } catch (error) {
    advice =
      ADVISOR_BACKEND === "api"
        ? apiErrorText(error)
        : `Advisor error (unavailable): ${error instanceof Error ? error.message : String(error)}. Continue the task without advice.`;
  }
  const notice = recordConsultAndGetNotice({
    tool,
    task: params.task,
    context: params.context,
    question: params.question,
    projectDir,
    advice,
  });
  return notice ? `${notice}\n\n${advice}` : advice;
}

server.registerTool(
  "advisor",
  {
    title: "Consult Fable Advisor",
    description: `Consult a stronger reviewer model (Claude Fable 5) for strategic guidance mid-task. It sees ONLY what you pass in — nothing is auto-forwarded — so include the full picture: the task verbatim, everything relevant you have done and observed (files read, commands run, key excerpts, errors, results), and your current plan or the decision you face.

Call advisor BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, reading, listing) is not substantive work; do that first so your context is rich, then call advisor. Also call it when you believe the task is complete (after making the deliverable durable), when stuck, or when considering a change of approach.

For decisions that rest on claims about what code/configs actually contain or do (component labels, gate semantics, "X is frozen/independent/validated"), prefer advisor_verify — it can read the repository and check instead of trusting your summary.

Args:
  - task (string): The user's task/request, verbatim or faithfully summarized.
  - context (string): Your progress so far — files touched, commands and outputs, key code excerpts, errors, current plan. More context = better advice.
  - question (string, optional): The specific decision or question you want resolved.

Returns: The advisor's guidance as plain text, ending with an "UNVERIFIED CLAIMS RELIED ON:" section marking what it took on faith — relay that section to the user when the decision is significant. May begin with an [advisor-governance] notice; surface that to the user verbatim. If the advisor is unavailable, returns a line starting with "Advisor error" — continue the task without advice in that case.`,
    inputSchema: COMMON_INPUT_SCHEMA,
    annotations: COMMON_ANNOTATIONS,
  },
  async (params: AdvisorInput) => {
    const text = await runConsult("advisor", params, {
      system: ADVISOR_SYSTEM,
      tools: "",
    });
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "advisor_verify",
  {
    title: "Consult Fable Advisor (grounded, reads the repo)",
    description: `Like advisor, but the reviewer model gets read-only access (Read/Grep/Glob) to the project directory and verifies your load-bearing claims against the actual files before advising — citing file:line for what it checked.

Use this instead of advisor whenever the decision rests on what code, configs, or docs actually contain or do: reviewing a frozen spec before launch, confirming a component is what its name claims (a "solver", an "independent teacher", a "validated gate"), checking that a metric or gate can actually fail, or any go/no-go recommendation. Slower than advisor (it reads files); worth it for anything that would be expensive to get wrong.

Args:
  - task, context, question: same as advisor. Still pass rich context — it directs the verification.
  - project_dir (string): Absolute path to the repository/project root the advisor should read.

Returns: Grounded guidance with file:line citations, ending with an "UNVERIFIED CLAIMS RELIED ON:" section for anything it could not check. May begin with an [advisor-governance] notice; surface that to the user verbatim.`,
    inputSchema: {
      ...COMMON_INPUT_SCHEMA,
      project_dir: z
        .string()
        .min(1)
        .max(1_000)
        .describe("Absolute path to the project root the advisor may read"),
    },
    annotations: COMMON_ANNOTATIONS,
  },
  async (params: AdvisorInput & { project_dir: string }) => {
    if (!existsSync(params.project_dir)) {
      return {
        content: [
          {
            type: "text",
            text: `Advisor error (bad_project_dir): '${params.project_dir}' does not exist. Pass the absolute path to the project root, or use the plain advisor tool.`,
          },
        ],
      };
    }
    if (ADVISOR_BACKEND === "api") {
      return {
        content: [
          {
            type: "text",
            text: "Advisor error (verify_unsupported_on_api_backend): advisor_verify requires the claude-cli backend (tool use is not wired for the direct API backend). Use the plain advisor tool, or unset FABLE_ADVISOR_BACKEND.",
          },
        ],
      };
    }
    const text = await runConsult(
      "advisor_verify",
      params,
      { system: ADVISOR_VERIFY_SYSTEM, tools: VERIFY_TOOLS, cwd: params.project_dir },
      params.project_dir,
    );
    return { content: [{ type: "text", text }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[fable-advisor] MCP server v${SERVER_VERSION} pid=${process.pid} running via stdio (backend: ${ADVISOR_BACKEND}, advisor model: ${ADVISOR_MODEL})`,
  );
}

main().catch((error) => {
  console.error("[fable-advisor] fatal:", error);
  process.exit(1);
});
