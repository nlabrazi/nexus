function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Unwraps shell wrappers like `/bin/bash -lc "ping -c 1 8.8.8.8"` or `["/bin/zsh", "-lc", "npm test"]`
 * into the underlying human-readable command.
 */
export function cleanShellCommand(rawCommand) {
  if (Array.isArray(rawCommand)) {
    const parts = rawCommand.map((item) => String(item ?? "").trim()).filter(Boolean);
    if (
      parts.length >= 3 &&
      /(?:^|\/)(?:ba|z|da|k)?sh$/i.test(parts[0]) &&
      /^-[a-z]*c[a-z]*$/i.test(parts[1])
    ) {
      return cleanShellCommand(parts.slice(2).join(" "));
    }
    return parts.join(" ");
  }

  if (typeof rawCommand !== "string") {
    return "";
  }

  let cmd = rawCommand.trim();
  const wrapperMatch = cmd.match(
    /^(?:\/usr\/bin\/env\s+)?(?:\/bin\/|\/usr\/bin\/)?(?:ba|z|da|k)?sh\s+-[a-z]*c[a-z]*\s+([\s\S]+)$/i
  );
  if (wrapperMatch) {
    cmd = wrapperMatch[1].trim();
    if (
      (cmd.startsWith("'") && cmd.endsWith("'")) ||
      (cmd.startsWith('"') && cmd.endsWith('"'))
    ) {
      cmd = cmd.slice(1, -1).trim();
      cmd = cmd.replace(/\\"/g, '"').replace(/'\\''/g, "'");
    }
  }
  return cmd;
}

function shortenText(text, maxLength = 90) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildCommandIntentSentence(command, explicitReason) {
  const shortCmd = shortenText(command, 72);
  if (explicitReason) {
    const cleanReason = explicitReason.replace(/[.!?]+$/, "").trim();
    return `${cleanReason} (${shortCmd}) — pouvez-vous valider ?`;
  }

  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (firstToken === "ping" || firstToken === "curl" || firstToken === "wget" || firstToken === "nc" || firstToken === "dig" || firstToken === "nslookup") {
    return `Je souhaite lancer un test réseau « ${shortCmd} » — pouvez-vous valider ?`;
  }
  if (firstToken === "git") {
    return `Je souhaite exécuter la commande Git « ${shortCmd} » — pouvez-vous valider ?`;
  }
  if (["npm", "pnpm", "yarn", "npx", "bun", "node"].includes(firstToken)) {
    return `Je souhaite lancer « ${shortCmd} » — pouvez-vous valider ?`;
  }
  if (["rm", "mv", "cp", "mkdir", "chmod", "chown"].includes(firstToken)) {
    return `Je souhaite effectuer une opération fichiers « ${shortCmd} » — pouvez-vous valider ?`;
  }
  if (["apt", "apt-get", "brew", "pip", "pip3", "cargo", "docker", "systemctl"].includes(firstToken)) {
    return `Je souhaite exécuter l'outil système « ${shortCmd} » — pouvez-vous valider ?`;
  }
  return `Je souhaite exécuter la commande « ${shortCmd} » — pouvez-vous valider ?`;
}

/**
 * Parses a raw approval item or details string (from Codex, Antigravity, or custom agents)
 * into concise, human-readable fields without noisy RPC metadata.
 */
export function parseApprovalDetails(input) {
  const rawDetails = typeof input === "string" ? input : input?.details ?? "";
  const kind = (typeof input === "object" && input?.kind) || "command";
  const agentName = (typeof input === "object" && input?.agentName) || "Agent";

  let parsed = null;
  if (typeof rawDetails === "string") {
    const trimmed = rawDetails.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
  } else if (isRecord(rawDetails)) {
    parsed = rawDetails;
  }

  if (!isRecord(parsed)) {
    const fallbackText = shortenText(rawDetails || "Une action requiert votre validation", 140);
    return {
      agentName,
      kind,
      toolLabel: kind === "fileChange" ? "Fichier" : "Commande",
      reason: `${fallbackText} — pouvez-vous valider ?`,
      command: kind === "command" ? String(rawDetails || "").trim() : "",
      files: [],
      cwd: "",
      network: null,
      questions: [],
      notificationTitle: `Nexus · Validation requise`,
      notificationBody: `${fallbackText} — pouvez-vous valider ?`,
    };
  }

  const action = isRecord(parsed.action) ? parsed.action : null;
  const networkCtx = isRecord(parsed.networkApprovalContext)
    ? parsed.networkApprovalContext
    : null;

  // 1. Extract explicit human reason/description if provided by the model/tool
  const explicitReasonCandidates = [
    parsed.reason,
    parsed.justification,
    parsed.Description,
    parsed.description,
    parsed.Instruction,
    parsed.toolSummary,
    parsed.toolAction,
    parsed.summary,
    parsed.message,
    action?.reason,
    action?.description,
    action?.summary,
  ];
  const explicitReason =
    explicitReasonCandidates
      .map((val) => (typeof val === "string" ? val.trim() : ""))
      .find((val) => val.length > 0) || "";

  // 2. Extract shell command (Codex uses `command` or `action.command` or `parsedCmd`; AGY uses `CommandLine`)
  const rawCommand =
    parsed.CommandLine ??
    parsed.command ??
    action?.command ??
    parsed.cmd ??
    action?.cmd ??
    parsed.parsedCmd ??
    "";
  const command = cleanShellCommand(rawCommand);

  // 3. Extract working directory
  const cwd =
    (typeof parsed.Cwd === "string" && parsed.Cwd.trim()) ||
    (typeof parsed.cwd === "string" && parsed.cwd.trim()) ||
    (typeof action?.cwd === "string" && action.cwd.trim()) ||
    "";

  // 4. Extract target files (AGY uses `TargetFile` / `file_path`; Codex uses `changes` / `action.changes`)
  const files = [];
  const singleFile =
    parsed.TargetFile ?? parsed.file_path ?? parsed.filePath ?? parsed.path ?? action?.path;
  if (typeof singleFile === "string" && singleFile.trim()) {
    files.push({ path: singleFile.trim(), kind: "modify" });
  }
  const rawChanges = Array.isArray(parsed.changes)
    ? parsed.changes
    : Array.isArray(action?.changes)
      ? action.changes
      : [];
  for (const change of rawChanges) {
    if (isRecord(change) && typeof change.path === "string" && change.path.trim()) {
      const changeKind =
        typeof change.kind === "string"
          ? change.kind
          : isRecord(change.kind) && typeof change.kind.type === "string"
            ? change.kind.type
            : "modify";
      if (!files.some((f) => f.path === change.path.trim())) {
        files.push({ path: change.path.trim(), kind: changeKind });
      }
    }
  }

  // 5. Extract network approval context if present
  const network =
    networkCtx && typeof networkCtx.host === "string" && networkCtx.host.trim()
      ? {
          host: networkCtx.host.trim(),
          protocol:
            typeof networkCtx.protocol === "string" ? networkCtx.protocol.trim() : "",
        }
      : null;

  // 6. Extract interactive questions if present
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q) => isRecord(q) && typeof q.question === "string")
    : typeof parsed.question === "string" && parsed.question.trim()
      ? [{ question: parsed.question.trim(), options: Array.isArray(parsed.options) ? parsed.options : [] }]
      : [];

  // 7. Determine clean tool label
  const rawToolName =
    (typeof parsed.toolName === "string" && parsed.toolName.trim()) ||
    (typeof parsed.tool === "string" && parsed.tool.trim()) ||
    (typeof input === "object" && typeof input?.toolName === "string" && input.toolName.trim()) ||
    "";

  let toolLabel = "Commande";
  if (questions.length > 0 || rawToolName === "ask_question") {
    toolLabel = "Question";
  } else if (network && !command) {
    toolLabel = "Accès réseau";
  } else if (files.length > 0 || kind === "fileChange") {
    toolLabel = files.length > 1 ? "Fichiers" : "Fichier";
  } else if (command) {
    toolLabel = "Commande";
  } else if (rawToolName) {
    toolLabel = rawToolName;
  }

  // 8. Build concise human-readable reason sentence
  let reason = "";
  if (questions.length > 0) {
    reason = questions[0].question;
  } else if (command && network) {
    const netTarget = `${network.protocol ? `${network.protocol}://` : ""}${network.host}`;
    reason = explicitReason
      ? `${explicitReason} (${shortenText(command, 56)} → ${netTarget}) — pouvez-vous valider ?`
      : `Je souhaite exécuter « ${shortenText(command, 56)} » avec accès réseau vers ${netTarget} — pouvez-vous valider ?`;
  } else if (command) {
    reason = buildCommandIntentSentence(command, explicitReason);
  } else if (network) {
    const netTarget = `${network.protocol ? `${network.protocol}://` : ""}${network.host}`;
    reason = explicitReason
      ? `${explicitReason} (${netTarget}) — pouvez-vous valider ?`
      : `Je souhaite autoriser la connexion réseau vers ${netTarget} — pouvez-vous valider ?`;
  } else if (files.length > 0) {
    const firstFile = files[0].path.split("/").slice(-2).join("/");
    const fileDesc =
      files.length === 1
        ? `le fichier « ${firstFile} »`
        : `${files.length} fichiers (dont « ${firstFile} »)`;
    reason = explicitReason
      ? `${explicitReason} (${fileDesc}) — pouvez-vous valider ?`
      : `Je souhaite modifier ${fileDesc} — pouvez-vous valider ?`;
  } else if (explicitReason) {
    reason = `${explicitReason.replace(/[.!?]+$/, "")} — pouvez-vous valider ?`;
  } else {
    reason = "Une action de l'agent requiert votre accord — pouvez-vous valider ?";
  }

  const notificationTitle = `Nexus · Approbation (${toolLabel})`;
  const notificationBody = shortenText(reason, 160);

  return {
    agentName,
    kind,
    toolLabel,
    reason,
    explicitReason,
    command,
    files,
    cwd,
    network,
    questions,
    notificationTitle,
    notificationBody,
  };
}
