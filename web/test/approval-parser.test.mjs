import assert from "node:assert/strict";
import test from "node:test";
import { cleanShellCommand, parseApprovalDetails } from "../app/utils/approval-parser.mjs";

test("unwraps bash -lc shell wrappers and array commands cleanly", () => {
  assert.equal(cleanShellCommand("/bin/bash -lc 'ping -c 1 8.8.8.8'"), "ping -c 1 8.8.8.8");
  assert.equal(cleanShellCommand(["/bin/zsh", "-lc", "git status -s"]), "git status -s");
  assert.equal(cleanShellCommand("npm run test"), "npm run test");
});

test("parses verbose Codex commandExecution approval JSON into human-readable French reason without RPC noise", () => {
  const verboseCodexJson = JSON.stringify({
    threadId: "thread_abc123456",
    turnId: "turn_def789012",
    itemId: "item_cmd_001",
    availableDecisions: ["accept", "decline"],
    command: ["/bin/bash", "-lc", "ping -c 1 8.8.8.8"],
    cwd: "/home/kaox/code/bricolage/nexus",
    action: {
      id: "item_cmd_001",
      type: "commandExecution",
      command: "/bin/bash -lc 'ping -c 1 8.8.8.8'",
      status: "inProgress",
      commandActions: [{ type: "unknown", command: "ping -c 1 8.8.8.8" }],
    },
  });

  const parsed = parseApprovalDetails({
    agentName: "Codex",
    kind: "command",
    details: verboseCodexJson,
  });

  assert.equal(parsed.command, "ping -c 1 8.8.8.8");
  assert.equal(parsed.toolLabel, "Commande");
  assert.match(parsed.reason, /Je souhaite lancer un test réseau « ping -c 1 8\.8\.8\.8 » — pouvez-vous valider \?/);
  assert.doesNotMatch(parsed.reason, /threadId|turnId|availableDecisions/);
  assert.equal(parsed.cwd, "/home/kaox/code/bricolage/nexus");
});

test("parses Codex fileChange approval JSON with changes array", () => {
  const codexFileJson = JSON.stringify({
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "item_file_1",
    action: {
      id: "item_file_1",
      type: "fileChange",
      changes: [
        { path: "src/daemon/daemon-server.ts", kind: { type: "update" } },
        { path: "web/app/app.vue", kind: "update" },
      ],
    },
  });

  const parsed = parseApprovalDetails({
    agentName: "Codex",
    kind: "fileChange",
    details: codexFileJson,
  });

  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].path, "src/daemon/daemon-server.ts");
  assert.match(parsed.reason, /Je souhaite modifier 2 fichiers.*pouvez-vous valider \?/);
});

test("uses explicit reason/description when provided by Antigravity or Codex", () => {
  const agyJson = JSON.stringify({
    tool: "run_command",
    CommandLine: "ping -c 2 1.1.1.1",
    Description: "Vérifier la connectivité DNS externe",
  });

  const parsed = parseApprovalDetails({
    agentName: "Antigravity",
    kind: "command",
    details: agyJson,
  });

  assert.equal(parsed.command, "ping -c 2 1.1.1.1");
  assert.equal(
    parsed.reason,
    "Vérifier la connectivité DNS externe (ping -c 2 1.1.1.1) — pouvez-vous valider ?"
  );
});
