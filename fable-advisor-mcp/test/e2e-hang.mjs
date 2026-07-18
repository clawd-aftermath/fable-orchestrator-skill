#!/usr/bin/env node
// Regression test for a deadlock: a claude child that exits but
// leaves a grandchild holding its inherited stdio pipes must NOT hang the
// advisor call. Drives the real server over MCP stdio with a fake claude bin.
//
// Pass: advisor returns the fake advice in well under 10s.
// Fail (old bug): the call blocks until the grandchild dies (60s) — the 30s
// watchdog below fires first and exits 1.
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  // The fake claude fixture requires bash, so run this regression on POSIX.
  console.log("SKIP: e2e-hang is a POSIX-only regression test (bash fake-claude)");
  process.exit(0);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const fakeDir = mkdtempSync(join(tmpdir(), "fable-advisor-test-"));
const logDir = mkdtempSync(join(tmpdir(), "fable-advisor-test-log-"));
const fakeClaude = join(fakeDir, "fake-claude");
writeFileSync(
  fakeClaude,
  `#!/bin/bash
cat > /dev/null
sleep 60 &
echo "TEST ADVICE FROM FAKE CLAUDE"
exit 0
`,
);
chmodSync(fakeClaude, 0o755);

const server = spawn("node", [join(repoRoot, "dist", "index.js")], {
  env: {
    ...process.env,
    FABLE_ADVISOR_CLAUDE_BIN: fakeClaude,
    FABLE_ADVISOR_LOG_DIR: logDir,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const started = Date.now();
let buf = "";
server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  for (const line of buf.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== 2) continue;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const text = msg.result?.content?.[0]?.text ?? "";
    const pass = text.includes("TEST ADVICE") && Date.now() - started < 10_000;
    console.log(`${pass ? "PASS" : "FAIL"}: advisor returned in ${secs}s: ${text.slice(0, 80)}`);
    server.kill();
    process.exit(pass ? 0 : 1);
  }
});

const send = (obj) => server.stdin.write(JSON.stringify(obj) + "\n");
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-hang-test", version: "0" } },
});
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized" }), 200);
setTimeout(
  () => send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "advisor", arguments: { task: "t", context: "c" } } }),
  400,
);
setTimeout(() => {
  console.log("FAIL: advisor call still hung after 30s (close-event deadlock is back)");
  server.kill();
  process.exit(1);
}, 30_000);
