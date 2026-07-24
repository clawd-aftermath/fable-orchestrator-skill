#!/usr/bin/env node
// Deterministic V3 architecture regression test. It proves ordinary advice is
// fresh and tool-less, project_state is bounded and rendered before evidence,
// routine completion is not coerced into verification, audits are fresh, and
// tool/token telemetry is durable in consults.jsonl.
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("SKIP: e2e-v3 uses a bash fake-claude fixture");
  process.exit(0);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fakeDir = mkdtempSync(join(tmpdir(), "fable-advisor-v3-"));
const captureDir = mkdtempSync(join(tmpdir(), "fable-advisor-v3-capture-"));
const logDir = mkdtempSync(join(tmpdir(), "fable-advisor-v3-log-"));
const fakeClaude = join(fakeDir, "fake-claude");
writeFileSync(
  fakeClaude,
  `#!/bin/bash
counter_file="$FABLE_TEST_CAPTURE/counter"
if [ -f "$counter_file" ]; then n=$(cat "$counter_file"); else n=0; fi
n=$((n + 1))
echo "$n" > "$counter_file"
printf '%s\n' "$@" > "$FABLE_TEST_CAPTURE/args-$n.txt"
cat > "$FABLE_TEST_CAPTURE/prompt-$n.txt"
if grep -q 'BARE_COMPLETION_CASE' "$FABLE_TEST_CAPTURE/prompt-$n.txt"; then
  printf '%s\n' 'VERDICT: revise' 'Paste the missing test output and diff evidence.' '' 'UNVERIFIED CLAIMS RELIED ON:' '- completion claim'
  exit 0
fi
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"duration_ms":25,"total_cost_usd":0.01,"result":"VERDICT: proceed\\n\\nTEST ADVICE FROM FAKE CLAUDE\\n\\nUNVERIFIED CLAIMS RELIED ON:\\n- none","usage":{"input_tokens":101,"cache_creation_input_tokens":7,"cache_read_input_tokens":11,"output_tokens":13}}'
exit 0
`,
);
chmodSync(fakeClaude, 0o755);

const server = spawn("node", [join(repoRoot, "dist", "index.js")], {
  env: {
    ...process.env,
    FABLE_ADVISOR_CLAUDE_BIN: fakeClaude,
    FABLE_ADVISOR_LOG_DIR: logDir,
    FABLE_TEST_CAPTURE: captureDir,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let nextId = 1;
let buf = "";
server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  server.kill();
  process.exit(1);
}

function readArgs(callNumber) {
  return readFileSync(join(captureDir, `args-${callNumber}.txt`), "utf8").split("\n");
}

const watchdog = setTimeout(() => fail("test exceeded 30s"), 30_000);
await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e-v3", version: "0" },
});
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const listed = await rpc("tools/list", {});
const advisorTool = listed.result?.tools?.find((tool) => tool.name === "advisor");
const advisorDescription = advisorTool?.description ?? "";
if (!advisorDescription.includes("before committing"))
  fail("advisor description is missing the post-implementation pre-commit gate");
if (!advisorDescription.includes("Call advisor before implementation only when"))
  fail("advisor description is missing the risk-triggered pre-work boundary");
if (advisorDescription.includes("Call advisor BEFORE substantive work"))
  fail("advisor description still contains the blanket pre-work mandate");
console.log("PASS 0: advisor timing policy is post-write by default and risk-triggered pre-work");

// 1. Routine completion stays on fresh, tool-less plain advice.
const projectState = "S".repeat(12_000);
const plain = await rpc("tools/call", {
  name: "advisor",
  arguments: {
    task: "The routine implementation is complete and all tests pass.",
    project_state: projectState,
    context: "Direct evidence: unit test output PASS. Interpretation: the reversible edit is ready.",
    question: "Any missing routine check?",
  },
});
const plainText = plain.result?.content?.[0]?.text ?? "";
if (!plainText.includes("VERDICT: proceed")) fail("plain advice did not return");
if (plainText.includes("[advisor-policy]")) fail("routine completion was policy-stamped");
const args1 = readArgs(1);
const toolsAt = args1.indexOf("--tools");
if (toolsAt < 0 || args1[toolsAt + 1] !== "") fail("plain call did not use --tools empty");
if (!args1.includes("--no-session-persistence")) fail("plain call persisted a session");
if (args1.includes("--resume")) fail("plain call resumed history");
const prompt1 = readFileSync(join(captureDir, "prompt-1.txt"), "utf8");
const stateAt = prompt1.indexOf("# Compact project state");
const evidenceAt = prompt1.indexOf("# Direct evidence, progress, and current interpretation");
if (stateAt < 0 || evidenceAt <= stateAt) fail("project_state was not rendered before context");
if (!prompt1.includes(projectState)) fail("12,000-character project_state was not preserved");
console.log("PASS 1: ordinary completion is fresh, tool-less, and unstamped");

// 2. The 12,000-character state ceiling is enforced before spawning Claude.
const oversized = await rpc("tools/call", {
  name: "advisor",
  arguments: {
    task: "Check state validation.",
    project_state: "X".repeat(12_001),
    context: "Evidence packet.",
  },
});
if (!oversized.result?.isError) fail("oversized project_state was accepted");
if (readFileSync(join(captureDir, "counter"), "utf8").trim() !== "1")
  fail("oversized project_state spawned Claude");
console.log("PASS 2: project_state hard ceiling enforced at 12,000 characters");

// 3. An unsupported completion claim stays plain but must request evidence.
const bare = await rpc("tools/call", {
  name: "advisor",
  arguments: {
    task: "BARE_COMPLETION_CASE: The ordinary final task is complete.",
    project_state: "A reversible implementation is awaiting evidence review.",
    context: "No direct evidence excerpts were supplied.",
    question: "May this ordinary completion claim proceed?",
  },
});
const bareText = bare.result?.content?.[0]?.text ?? "";
if (!bareText.includes("VERDICT: revise") || !bareText.includes("missing test output and diff evidence"))
  fail("bare completion did not request direct evidence");
if (bareText.includes("[advisor-policy]")) fail("bare completion was policy-stamped");
const args2 = readArgs(2);
if (!args2.includes("--no-session-persistence") || args2.includes("--resume"))
  fail("bare-completion advice was not fresh");
if (
  !args2.includes("--system-prompt") ||
  !args2.join("\n").includes("A bare completion claim without direct excerpts")
)
  fail("semantic evidence requirement is missing from the advisor system prompt");
console.log("PASS 3: unsupported completion stays plain and requests direct evidence");

// 4. A scoped audit is also fresh, and telemetry makes tool mix/cost visible.
const audited = await rpc("tools/call", {
  name: "advisor_verify",
  arguments: {
    task: "Independently audit one costly-to-undo authorization decision.",
    project_state: "One scoped claim remains unresolved.",
    context: "Claim: package version is declared in package.json:3. Verify only that claim.",
    project_dir: repoRoot,
    question: "Does the named file support the claim?",
  },
});
if (!(audited.result?.content?.[0]?.text ?? "").includes("VERDICT: proceed"))
  fail("scoped audit did not return");
const args3 = readArgs(3);
const auditToolsAt = args3.indexOf("--tools");
if (auditToolsAt < 0 || args3[auditToolsAt + 1] !== "Read,Grep,Glob")
  fail("audit tool scope changed unexpectedly");
if (!args3.includes("--no-session-persistence") || args3.includes("--resume"))
  fail("audit was not fresh");

const entries = readFileSync(join(logDir, "consults.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
if (entries.length !== 3) fail(`expected 3 consult logs, got ${entries.length}`);
if (
  entries[0].tool !== "advisor" ||
  entries[1].tool !== "advisor" ||
  entries[2].tool !== "advisor_verify"
)
  fail("tool mix was not logged");
if (entries[0].projectStateChars !== 12_000 || !entries[0].projectStateHash)
  fail("project_state metadata missing from log");
if (
  entries[1].telemetry?.backend !== "claude-cli" ||
  Object.keys(entries[1].telemetry).length !== 1
)
  fail(`raw-output telemetry fallback malformed: ${JSON.stringify(entries[1].telemetry)}`);
for (const entry of [entries[0], entries[2]]) {
  const t = entry.telemetry;
  if (
    t?.backend !== "claude-cli" ||
    t.inputTokens !== 101 ||
    t.cacheCreationInputTokens !== 7 ||
    t.cacheReadInputTokens !== 11 ||
    t.outputTokens !== 13 ||
    t.numTurns !== 1
  )
    fail(`usage telemetry malformed: ${JSON.stringify(t)}`);
}
console.log("PASS 4: fresh audit and JSON/raw-output telemetry verified");

clearTimeout(watchdog);
server.kill();
console.log("ALL PASS");
process.exit(0);
