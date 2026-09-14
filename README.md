<a name="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![VS Code][vscode-shield]][vscode-url]
[![TypeScript][typescript-shield]][typescript-url]
[![Node.js][node-shield]][node-url]
[![License][license-shield]][license-url]

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#-about-the-project">About The Project</a>
      <ul>
        <li><a href="#ℹ️-description">Description</a></li>
        <li><a href="#-core-features">Core Features</a></li>
        <li><a href="#️-architecture">Architecture</a></li>
        <li><a href="#️-built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#-getting-started">Getting Started</a>
      <ul>
        <li><a href="#-requirements">Requirements</a></li>
        <li><a href="#-development-installation">Development Installation</a></li>
        <li><a href="#-telegram-setup">Telegram Setup</a></li>
        <li><a href="#-codex-setup">Codex Setup</a></li>
      </ul>
    </li>
    <li>
      <a href="#-daily-usage">Daily Usage</a>
      <ul>
        <li><a href="#-vscode-commands">VS Code Commands</a></li>
        <li><a href="#-telegram-commands">Telegram Commands</a></li>
      </ul>
    </li>
    <li>
      <a href="#-security-model">Security Model</a>
    </li>
    <li>
      <a href="#-private-packaging--installation">Private Packaging & Installation</a>
    </li>
    <li>
      <a href="#-testing--validation">Testing & Validation</a>
    </li>
    <li>
      <a href="#-development-commands">Development Commands</a>
    </li>
    <li>
      <a href="#-roadmap">Roadmap</a>
    </li>
    <li><a href="#-license">License</a></li>
  </ol>
</details>

---

# 🧠 About The Project

### ℹ️ Description

**Nexus** is a private VS Code extension that turns Telegram into a remote control for local coding agents.

The goal is simple: keep the real development environment on the workstation while allowing safe remote interaction from a smartphone.

Nexus runs inside the VS Code workspace, listens to a private Telegram bot, and forwards authorized instructions to local agent backends such as Codex.

Typical use case:

```text
📱 Telegram
    ↓
🧩 Nexus VS Code Extension
    ↓
🤖 Codex App Server
    ↓
📁 Current VS Code Workspace
    ↓
🤖 Response
    ↓
📱 Telegram
```

Nexus is not intended to replace VS Code, Git, Codex, or other coding agents. It acts as a secure bridge between them.

---

## ⚡ Core Features

- 📱 **Telegram Remote Control**
  - Send instructions from a smartphone.
  - Receive Codex responses directly in Telegram.
  - Long-polling transport: no inbound port needs to be exposed.

- 🔐 **Secure Telegram Pairing**
  - Pairing code generated from VS Code.
  - Only the paired Telegram user/chat is authorized.
  - Private chats only.
  - Bot token stored with VS Code `SecretStorage`.

- 🤖 **Codex Integration**
  - Starts Codex through `codex app-server --stdio`.
  - Uses JSON-RPC over stdio.
  - Creates and reuses workspace-bound Codex sessions.
  - Streams agent responses.
  - Handles RPC and turn timeouts.

- ✅ **Remote Approvals**
  - Codex approval requests can be surfaced through Telegram.
  - Unknown or expired approvals fail closed.
  - No implicit auto-approval.

- 🧭 **Workspace Awareness**
  - Nexus always works against the currently opened VS Code workspace.
  - Workspace and Git safety checks protect against accidental operations in the wrong project.

- 💬 **Telegram UX**
  - `/status` reports Nexus activity, the session model, token usage, context usage and Codex account quotas.
  - `/model` opens a paginated model picker with reasoning-effort selection; the choice is saved per workspace.
  - `/stop` stops the current Codex turn.
  - Session commands allow creating or resuming Codex sessions.
  - Long Codex responses are formatted and split safely for Telegram.

- 💾 **Session Persistence**
  - Nexus can restore persisted Codex session information after restart.
  - Session lifecycle is explicitly managed to avoid duplicate threads.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## 🏗️ Architecture

```text
src/
├── extension.ts
├── telegram/
│   ├── client.ts
│   ├── service.ts
│   └── types.ts
└── codex/
    ├── client.ts
    ├── service.ts
    └── types.ts
```

Responsibilities:

```text
extension.ts
└── VS Code lifecycle, commands, status bar, service wiring

TelegramService
└── polling, pairing, authorization, Telegram command routing

TelegramClient
└── Telegram Bot API transport

CodexService
└── Codex session and turn lifecycle

CodexClient
└── Codex App Server process + JSON-RPC transport
```

### Runtime Flow

```text
Telegram message
      ↓
TelegramService
      ↓
authorization checks
      ↓
CodexService
      ↓
CodexClient
      ↓
codex app-server
      ↓
workspace files / tools
      ↓
Codex response
      ↓
Telegram
```

---

## 🛠️ Built With

- [![VS Code][vscode-shield]][vscode-url]
- [![TypeScript][typescript-shield]][typescript-url]
- [![Node.js][node-shield]][node-url]
- Codex CLI / App Server
- Telegram Bot API
- esbuild

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# ✅ Getting Started

## 📋 Requirements

Nexus currently expects:

- VS Code
- WSL/Linux workspace environment
- Node.js + npm
- Codex CLI installed and authenticated
- `bubblewrap` available on Linux for Codex sandboxing
- A private Telegram bot
- Nexus installed in the same VS Code/WSL environment as the target workspace

Example Codex checks:

```bash
codex --version
which codex
codex login status
```

Example sandbox prerequisite:

```bash
sudo apt update
sudo apt install bubblewrap
```

---

## 💻 Development Installation

Clone the repository:

```bash
git clone <your-nexus-repository>
cd nexus
npm install
```

Validate the project:

```bash
npm run check-types
npm run lint
npm run package
```

Run Nexus in development mode with:

```text
F5
```

VS Code opens an **Extension Development Host**.

For development-specific instructions, see:

- [Development guide](docs/development.md)

---

## 📱 Telegram Setup

1. Create a bot with **@BotFather**.
2. Launch Nexus in VS Code.
3. Run:

```text
Nexus: Configure Telegram
```

4. Paste the bot token.
5. Run:

```text
Nexus: Pair Telegram
```

6. Send the generated pairing command to the bot:

```text
/pair 123456
```

7. Nexus confirms the pairing in Telegram.

The Telegram token is stored in VS Code `SecretStorage`. It should never be committed to the repository.

---

## 🤖 Codex Setup

Install and authenticate the Codex CLI in the same environment where Nexus runs.

Example checks:

```bash
codex --version
which codex
codex login status
```

Nexus communicates with Codex through:

```bash
codex app-server --stdio
```

The VS Code extension remains the user-facing controller; Codex App Server is used only as the programmable backend for remote sessions.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🛋️ Daily Usage

Nexus is designed to run automatically when VS Code starts.

Typical daily setup:

```text
1. Start the workstation.
2. Open VS Code in WSL.
3. Open the root folder of the project you want to control.
4. Nexus starts automatically.
5. Leave VS Code running.
6. Use Telegram from the phone.
```

Important:

> Nexus operates on the currently opened workspace. Always open the real project root, not a nested folder such as `src/`.

Example:

```text
✅ /home/user/code/sentinel
❌ /home/user/code/sentinel/src
```

---

## 🧩 VS Code Commands

Depending on the current version, Nexus exposes commands such as:

```text
Nexus: Status
Nexus: Configure Telegram
Nexus: Test Telegram Connection
Nexus: Pair Telegram
Nexus: Test Codex Connection
Nexus: Start Codex Session
Nexus: Switch Branch
```

---

## 📲 Telegram Commands

The current V1 includes remote commands such as:

```text
/help
/status
/model
/codex <instruction>
/stop
/new
/resume <session-id>
/branches
/switch <branch>
```

Send `/help` for a formatted command reference in French, grouped by usage with examples. Help remains available while Codex is working and is restricted to the paired private chat.

Send `/model`, tap a model, then choose its reasoning effort. The catalog comes from the installed Codex app server. The choice applies to the next explicit prompt and survives extension reloads for that workspace; it does not modify the global Codex configuration. Model changes are refused during Codex work or a Nexus branch change. Menus expire after two minutes and include pagination and cancellation.

`/status` displays the configuration acknowledged by Codex separately from the model selected for the next prompt. Token totals come from session usage events (including cached input and reasoning output); context occupancy is the last reported measurement. Account quotas are refreshed when the Codex process is connected, with reset times displayed in Europe/Paris. Missing data is shown as unavailable, not zero. The command does not start a process, session or prompt, and Telegram remains responsive while quotas are being fetched.

These values describe the session controlled by Nexus. They do not mirror an unrelated Codex CLI conversation. After an extension reload, token measurements are unavailable until Codex reports them again.

Examples:

```text
/status
```

```text
/codex Analyse pourquoi le dernier test échoue. Ne modifie rien.
```

```text
/stop
```

Detailed documentation:

- [Git branch selection](docs/workspace-safety.md#changer-de-branche)
- [Telegram status](docs/telegram-status.md)
- [Telegram model selection](docs/telegram-models.md)
- [Telegram stop](docs/telegram-stop.md)
- [Telegram approvals](docs/telegram-approvals.md)
- [Telegram formatting](docs/telegram-formatting.md)
- [Codex sessions](docs/codex-sessions.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🔐 Security Model

Nexus indirectly grants access to a development workstation, so the default posture is **fail closed**.

### Telegram

- Only the paired Telegram user and chat are authorized.
- Private chats only.
- Unknown users are ignored.
- Bot token is stored in VS Code `SecretStorage`.
- Nexus uses Telegram long polling and exposes no inbound HTTP port.

### Codex

- Codex runs with workspace-scoped sandboxing.
- Remote approvals are explicit.
- Unsupported approval requests are rejected by default.
- Approval requests expire.
- Approval actions are bound to the corresponding Codex request/turn.
- Nexus does not provide a generic remote shell command.

### Workspace / Git

Before allowing sensitive remote actions, Nexus performs workspace and Git safety checks.

The detailed model is documented in:

- [Workspace safety](docs/workspace-safety.md)
- [Codex errors & timeouts](docs/codex-errors.md)
- [Regression tests](docs/regression-tests.md)

### Sensitive Data

Do not intentionally send the following through Telegram:

```text
.env
API keys
private SSH keys
tokens
cookies
credentials
production secrets
```

Telegram is used as a remote command and response channel, not as a secrets vault.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 📦 Private Packaging & Installation

For private usage, Nexus can be packaged as a `.vsix`.

Validate first:

```bash
npm run check-types
npm run lint
npm run package
```

Inspect the files that will be included:

```bash
npx @vscode/vsce ls
```

Package the extension:

```bash
npx @vscode/vsce package
```

Example output:

```text
nexus-0.0.1.vsix
```

Install it from a VS Code window connected to WSL:

```bash
code --install-extension ./nexus-0.0.1.vsix
```

Or use:

```text
Extensions: Install from VSIX...
```

After the first installation, configure Telegram once:

```text
Nexus: Configure Telegram
Nexus: Pair Telegram
```

For an update:

1. Increment the extension version in `package.json`.
2. Rebuild the VSIX.
3. Reinstall with `--force`.

Example:

```bash
code --install-extension ./nexus-0.0.2.vsix --force
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🧪 Testing & Validation

Nexus focuses on practical regression tests rather than tests added only for coverage.

Current validation areas include:

- Telegram polling restart
- Telegram pairing and authorization
- Telegram 409 conflict prevention
- Codex process startup
- Codex RPC timeout
- Codex turn timeout
- Workspace-bound session reuse
- Remote approvals
- Approval expiration
- Codex process crash
- Workspace/Git safety
- Session persistence
- Telegram `/stop`
- Interactive model selection, workspace model preferences and usage telemetry
- Response formatting

Detailed test documentation:

- [Regression tests](docs/regression-tests.md)
- [Session persistence](docs/session-persistence.md)
- [Codex errors](docs/codex-errors.md)
- [Workspace safety](docs/workspace-safety.md)
- [Telegram approvals](docs/telegram-approvals.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🧪 Development Commands

```bash
# TypeScript validation
npm run check-types

# ESLint
npm run lint

# Production build
npm run package

# Development watch mode
npm run watch

# Extension tests
npm test

# Package VSIX
npx @vscode/vsce package

# List files included in VSIX
npx @vscode/vsce ls
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🗺️ Roadmap

### V1

- [x] VS Code extension bootstrap
- [x] Telegram secure pairing
- [x] Telegram long polling
- [x] Codex App Server integration
- [x] Workspace-bound Codex sessions
- [x] Telegram → Codex → Telegram
- [x] Remote approvals
- [x] Session management
- [x] Workspace/Git safety
- [x] Error handling and timeouts
- [x] Private VSIX packaging

### Later

- [ ] Antigravity backend integration
- [ ] Multi-workspace / project selection
- [ ] Better multi-instance coordination
- [ ] Optional standalone Nexus daemon
- [ ] Public Marketplace publication if the project becomes suitable for general use

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 📄 License

Nexus is proprietary software. All rights reserved.
See [LICENSE](LICENSE) for the terms.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- MARKDOWN LINKS & IMAGES -->

[vscode-shield]: https://img.shields.io/badge/VS%20Code-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white
[vscode-url]: https://code.visualstudio.com/

[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/

[node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/

[license-shield]: https://img.shields.io/badge/license-private-lightgrey?style=for-the-badge
[license-url]: LICENSE
