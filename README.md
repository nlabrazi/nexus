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

**Nexus** is a private VS Code extension that turns Telegram into a remote control for local coding agents (**OpenAI Codex** and **Gemini Antigravity**).

The goal is simple: keep the real development environment on the workstation while allowing safe remote interaction from a smartphone.

Nexus runs inside the VS Code workspace, listens to a private Telegram bot, and forwards authorized instructions to local agent backends such as Codex or Gemini Antigravity (`agy`).

Typical use case:

```text
📱 Telegram
    ↓
🧩 Nexus VS Code Extension (Multi-Backend: Codex / Antigravity)
    ↓
🤖 Codex App Server  OR  ✨ Gemini Antigravity CLI
    ↓
📁 Current VS Code Workspace
    ↓
🤖 / ✨ Agent Response
    ↓
📱 Telegram
```

Nexus is not intended to replace VS Code, Git, Codex, or Antigravity. It acts as a secure bridge between them.

---

## ⚡ Core Features

- 📱 **Telegram Remote Control**
  - Send instructions from a smartphone.
  - Receive Codex and Gemini Antigravity responses directly in Telegram.
  - Long-polling transport: no inbound port needs to be exposed.

- 🔀 **Dual-Backend Support (Codex & Antigravity)**
  - Seamlessly switch between OpenAI Codex and Google Gemini Antigravity (`/backend [codex|antigravity]`).
  - Direct execution aliases: `/codex <prompt>`, `/antigravity <prompt>`, `/agy <prompt>`, `/gemini <prompt>`.
  - Symmetric session management, model selection, and token telemetry across both backends.

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

- ✨ **Gemini Antigravity Integration**
  - Headless persistent process execution via `agy` CLI with NDJSON streaming (`stream-json`).
  - Automated session tracking, workspace binding, and Git branch synchronization.
  - Full telemetry: token consumption (input, cached, output, thinking), reasoning effort, and turn monitoring.
  - Sandboxed execution (`--sandbox`) by default with fail-closed safety.

- ✅ **Remote Approvals**
  - Codex approval requests can be surfaced through Telegram.
  - Unknown or expired approvals fail closed.
  - No implicit auto-approval.

- 🧭 **Workspace Awareness**
  - Nexus always works against the currently opened VS Code workspace.
  - Workspace and Git safety checks protect against accidental operations in the wrong project.

- 💬 **Telegram UX**
  - `/status` reports Nexus activity, active backend, sessions, models, token usage, context usage, and quotas.
  - `/model` opens an interactive paginated model picker with reasoning-effort selection for the active backend.
  - `/stop` cancels the currently running agent turn (Codex or Antigravity).
  - Session commands (`/new`, `/resume <id>`) allow creating or resuming conversations in the active backend.
  - Long responses are formatted and split safely for Telegram with code fence preservation.

- 💾 **Session Persistence**
  - Nexus restores persisted session information (Codex and Antigravity) after reload or restart.
  - Session lifecycle is isolated per workspace to prevent cross-project contamination.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## 🏗️ Architecture

```text
src/
├── extension.ts
├── telegram/
│   ├── client.ts
│   ├── service.ts
│   ├── models.ts
│   ├── status.ts
│   └── types.ts
├── codex/
│   ├── client.ts
│   ├── service.ts
│   ├── persistence.ts
│   ├── model-preferences.ts
│   └── types.ts
└── antigravity/
    ├── client.ts
    ├── service.ts
    ├── persistence.ts
    ├── model-preferences.ts
    ├── telemetry.ts
    ├── errors.ts
    └── types.ts
```

Responsibilities:

```text
extension.ts
└── VS Code lifecycle, commands, status bar, backend service wiring

TelegramService
└── polling, pairing, authorization, multi-backend routing (/backend, /codex, /antigravity)

TelegramClient
└── Telegram Bot API transport

CodexService / AntigravityService
└── Agent session, turn lifecycle, workspace isolation, model preferences

CodexClient
└── Codex App Server process + JSON-RPC transport

AntigravityClient
└── Headless persistent agy process + NDJSON stream transport
```

### Runtime Flow

```text
Telegram message (/codex, /antigravity, /new, /resume, /model, /backend)
      ↓
TelegramService
      ↓
authorization checks & active backend routing
      ↓
CodexService  OR  AntigravityService
      ↓
CodexClient (JSON-RPC)  OR  AntigravityClient (NDJSON stream)
      ↓
codex app-server  OR  agy CLI
      ↓
workspace files / tools
      ↓
Formatted response + file summary
      ↓
Telegram
```

---

## 🛠️ Built With

- [![VS Code][vscode-shield]][vscode-url]
- [![TypeScript][typescript-shield]][typescript-url]
- [![Node.js][node-shield]][node-url]
- OpenAI Codex CLI / App Server
- Google Gemini Antigravity CLI (`agy`)
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

For more details, see [Codex setup](docs/codex-sessions.md).

---

## ✨ Gemini Antigravity Setup

Install the Google Gemini Antigravity CLI (`agy`) and ensure your Google Cloud or Gemini API access is configured.

Example checks:

```bash
agy --version
which agy
agy models
```

Nexus executes Antigravity in headless streaming mode:

```bash
agy -p "" --input-format stream-json --output-format stream-json --sandbox --add-dir <workspace>
```

For detailed configuration (custom paths, sandbox flags), see [Antigravity setup](docs/antigravity-setup.md).

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

Nexus exposes commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

```text
Nexus: Status
Nexus: Select Active Backend
Nexus: Configure Telegram
Nexus: Test Telegram Connection
Nexus: Pair Telegram
Nexus: Switch Branch
Nexus: Test Local Speech-to-Text

# Codex commands
Nexus: Test Codex Connection
Nexus: Start Codex Session
Nexus: New Codex Session
Nexus: Resume Codex Session
Nexus: Test Codex Prompt

# Gemini Antigravity commands
Nexus: Test Antigravity Connection
Nexus: Start Antigravity Session
Nexus: New Antigravity Session
Nexus: Resume Antigravity Session
Nexus: Test Antigravity Prompt
```

---

## 📲 Telegram Commands

Nexus provides a rich set of Telegram commands:

```text
/help                        # Formatted command reference in French
/status                      # Full status report (project, backend, sessions, models, tokens, quotas)
/backend [codex|antigravity] # Query or toggle the active agent backend
/model                       # Interactive model and reasoning effort picker for the active backend
/codex <instruction>         # Send instruction directly to OpenAI Codex
/antigravity <instruction>   # Send instruction directly to Gemini Antigravity (aliases: /agy, /gemini)
/stop                        # Stop the current running turn (Codex or Antigravity)
/new                         # Create a new session in the active backend
/resume <session-id>         # Resume an existing session in the active backend
/branches                    # List Git branches and identify the current branch
/switch <branch>             # Safely switch Git branch (with tracking support)
```

Send `/help` for a formatted command reference in French, grouped by usage with examples. Help remains available while agents are working and is restricted to the paired private chat.

Send `/model`, tap a model, then choose its reasoning effort. The catalog comes from the active backend (`codex` or `antigravity`). The choice applies to the next explicit prompt and survives extension reloads for that workspace.

`/status` displays the active backend, current sessions, acknowledged configuration, token consumption, context usage, and account quotas.

Examples:

```text
/status
```

```text
/backend antigravity
/model
/antigravity Analyse l'architecture du projet et propose une refactorisation modulaire.
```

```text
/codex Analyse pourquoi le dernier test échoue. Ne modifie rien.
```

```text
/stop
```

Detailed documentation:

- [Local speech-to-text setup and test](docs/speech-local.md)
- [Telegram voice transcription](docs/telegram-voice.md)
- [Git branch selection](docs/workspace-safety.md#changer-de-branche)
- [Telegram status](docs/telegram-status.md)
- [Telegram model selection](docs/telegram-models.md)
- [Telegram stop](docs/telegram-stop.md)
- [Telegram approvals](docs/telegram-approvals.md)
- [Telegram formatting](docs/telegram-formatting.md)
- [Codex sessions](docs/codex-sessions.md)
- [Codex errors & recovery](docs/codex-errors.md)
- [Gemini Antigravity setup](docs/antigravity-setup.md)
- [Gemini Antigravity sessions](docs/antigravity-sessions.md)
- [Gemini Antigravity models](docs/antigravity-models.md)
- [Gemini Antigravity errors](docs/antigravity-errors.md)

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
- Codex process startup, RPC timeout, turn timeout, and crash recovery
- Antigravity headless process execution and NDJSON streaming
- Antigravity stream timeouts, turn timeouts, and crash recovery
- Workspace-bound session reuse (Codex & Antigravity)
- Remote approvals
- Approval expiration
- Workspace/Git safety
- Session persistence (Codex & Antigravity)
- Telegram `/stop` (cancelling Codex and Antigravity)
- Interactive model selection, workspace model preferences, and usage telemetry
- Multi-backend Telegram command routing (`/backend`, `/codex`, `/antigravity`, `/agy`, `/gemini`)
- Response formatting and file summary presentation

Detailed test documentation:

- [Regression tests](docs/regression-tests.md)
- [Session persistence](docs/session-persistence.md)
- [Codex sessions](docs/codex-sessions.md)
- [Codex errors](docs/codex-errors.md)
- [Gemini Antigravity setup](docs/antigravity-setup.md)
- [Gemini Antigravity sessions](docs/antigravity-sessions.md)
- [Gemini Antigravity models](docs/antigravity-models.md)
- [Gemini Antigravity errors](docs/antigravity-errors.md)
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

# Unit tests
npm run test:unit

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
- [x] Gemini Antigravity CLI streaming integration
- [x] Dual-backend routing (`/backend`, `/codex`, `/antigravity`)
- [x] Workspace-bound sessions (Codex & Antigravity)
- [x] Telegram ↔ Agent communication (streaming, formatted markdown, file summaries)
- [x] Remote approvals
- [x] Session management (`/new`, `/resume`, `/status`, `/stop`)
- [x] Model discovery and reasoning effort selection (`/model`)
- [x] Workspace/Git safety
- [x] Comprehensive error handling and timeouts
- [x] Private VSIX packaging

### Later

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
