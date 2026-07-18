#!/usr/bin/env node
// Live end-to-end test: drives the built server over MCP stdio against the
// REAL claude CLI (fast model), validating v2.0.0 behavior:
//   1. advisor        → returns advice ending with the mandatory
//                       "UNVERIFIED CLAIMS RELIED ON:" section.
//   2. advisor_verify → with read-only tools + project_dir, correctly reports
//                       a planted fact from a file the executor "mislabeled".
//   3. governance     → consults.jsonl and state.json written to the log dir.
//
// Requires a logged-in claude CLI (or FABLE_ADVISOR_CLAUDE_BIN). Slower than
// unit tests (~1-2 min); run manually or in CI with credentials.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_MODEL = process.env.FABLE_ADVISOR_TEST_MODEL ?? "claude-haiku-4-5-20251001";

// Isolated governance dir so test runs don't pollute real consult history.
const logDir = mkdtempSync(join(tmpdir(), "fable-advisor-live-"));

// Planted project: a file whose contents contradict the executor's label.
const projectDir = mkdtempSync(join(tmpdir(), "fable-advisor-proj-"));
writeFileSync(
  join(projectDir, "gate.py"),
  "def fallback_gate(x):\n    # supposed safety gate\n    delta = x.mean() - x.mean()\n    return delta <= 0\n",
);

const server = spawn("node", [join(repoRoot, "dist", "index.js")], {
  env: {
    ...process.env,
    FABLE_ADVISOR_MODEL: TEST_MODEL,
    FABLE_ADVISOR_LOG_DIR: logDir,
    FABLE_ADVISOR_BRIEF: "", // ensure no brief interference
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

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  server.kill();
  process.exit(1);
}

const watchdog = setTimeout(() => fail("test exceeded 240s watchdog"), 240_000);

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e-live", version: "0" },
});
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

// --- 1. plain advisor: trailer must be present -----------------------------
const r1 = await rpc("tools/call", {
  name: "advisor",
  arguments: {
    task: "Decide whether to ship a change.",
    context:
      "I refactored the payment retry loop. Our integration suite passed. The suite covers retries per Jenkins job payments-ci.",
    question: "Ship it?",
  },
});
const t1 = r1.result?.content?.[0]?.text ?? "";
if (t1.startsWith("Advisor error")) fail(`advisor errored: ${t1.slice(0, 200)}`);
if (!t1.includes("UNVERIFIED CLAIMS RELIED ON:"))
  fail(`advisor response missing trailer: ...${t1.slice(-200)}`);
console.log("PASS 1: advisor returned advice with UNVERIFIED CLAIMS trailer");

// --- 2. advisor_verify: must catch the planted vacuous gate ----------------
const r2 = await rpc("tools/call", {
  name: "advisor_verify",
  arguments: {
    task: "Confirm our fallback safety gate is sound before we launch.",
    context:
      "gate.py implements fallback_gate, our fallback-regression safety gate. It compares fallback regret against the original safe policy and passes only when fallback does not regress. I believe it is correct.",
    question: "Is the gate implementation actually able to fail?",
    project_dir: projectDir,
  },
});
const t2 = r2.result?.content?.[0]?.text ?? "";
if (t2.startsWith("Advisor error")) fail(`advisor_verify errored: ${t2.slice(0, 200)}`);
const caught = /always\s+(?:be\s+)?(?:zero|0|true|pass)|identically zero|mean\(\)\s*-\s*x?\.?mean\(\)|cannot fail|vacuous|never fail/i.test(
  t2,
);
if (!caught) fail(`advisor_verify did not flag the vacuous gate: ${t2.slice(0, 400)}`);
console.log("PASS 2: advisor_verify read gate.py and flagged the vacuous gate");

// --- 3. governance artifacts ------------------------------------------------
const logPath = join(logDir, "consults.jsonl");
const statePath = join(logDir, "state.json");
if (!existsSync(logPath) || !existsSync(statePath)) fail("governance files not written");
const entries = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (entries.length !== 2) fail(`expected 2 log entries, got ${entries.length}`);
if (entries[1].tool !== "advisor_verify" || entries[1].projectDir !== projectDir)
  fail("second log entry malformed");
// Consult 1 ("Ship it?") is routine; consult 2 asks about a safety GATE →
// significant. Weighted counting must count exactly the second one.
if (entries[0].significant !== false || entries[1].significant !== true)
  fail(`significance flags wrong: ${entries[0].significant}, ${entries[1].significant}`);
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (state.consultsSinceReview !== 1)
  fail(`state count ${state.consultsSinceReview} != 1 (only significant consults count)`);
console.log("PASS 3: consult log + weighted governance counting correct");

clearTimeout(watchdog);
server.kill();
console.log("ALL PASS");
process.exit(0);
