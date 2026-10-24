<a name="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Windows][windows-shield]][windows-url]
[![Android][android-shield]][android-url]
[![TypeScript][typescript-shield]][typescript-url]
[![Node.js][node-shield]][node-url]
[![Vue.js][vue-shield]][vue-url]
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
        <li><a href="#-codex-setup">Codex Setup</a></li>
        <li><a href="#-gemini-antigravity-setup">Gemini Antigravity Setup</a></li>
        <li><a href="#-claude-code-setup">Claude Code Setup</a></li>
      </ul>
    </li>
    <li>
      <a href="#-daily-usage">Daily Usage</a>
      <ul>
        <li><a href="#-windows-system-tray-nexusexe">Windows System Tray (Nexus.exe)</a></li>
        <li><a href="#-mobile--web-app-controls">Mobile & Web App Controls</a></li>
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

**Nexus** is a private standalone daemon (`Nexus.exe` + WSL backend) and mobile/web application (Nuxt 4 + Capacitor Android) that turns a smartphone or browser into a real-time remote control for local coding agents (**OpenAI Codex**, **Google Gemini Antigravity**, **Anthropic Claude Code**, and **Nexus Brain**).

The goal is simple: keep the real development environment on the workstation while allowing safe, responsive, voice-enabled remote interaction from a smartphone or desktop browser.

`Nexus.exe` runs silently in the Windows System Tray, manages the WSL `nexus-daemon` process (`dist/daemon.js`) on port `4040`, serves the static Web PWA, streams real-time WebSocket events, and orchestrates local coding agents against your repositories.

Typical use case:

```text
📱 Android App (APK) / Web PWA
    ↓  (HTTP REST + WebSocket /ws + FCM Push)
🖥️ Nexus.exe (Windows Tray) ──► 🛡️ Nexus Unified Daemon (WSL :4040)
    ↓
🧠 Nexus Brain  |  🤖 OpenAI Codex  |  ✨ Gemini Antigravity  |  🟣 Claude Code
    ↓
📁 Active Git / Code Workspace
    ↓
🔄 Real-Time Streaming + Diff Inspector + Instant Approvals + Voice (TTS/STT)
    ↓
📱 Android App / Web PWA
```

Nexus is not intended to replace your IDE, Git, Codex, Antigravity, or Claude Code. It acts as a unified, low-latency bridge between them and your mobile device.

---

## ⚡ Core Features

- 🖥️ **Native Windows System Tray (`Nexus.exe`)**
  - Single-click native C# launcher (`windows/NexusTray.cs`) managing the WSL background daemon in `tmux`.
  - Health monitoring (`/health`), one-click browser launch, Tailscale/LAN URL copy, and "Start with Windows" shortcut.

- 🔀 **Multi-Agent Support (Brain, Codex, Antigravity & Claude Code)**
  - Seamlessly switch between **Nexus Brain**, **OpenAI Codex**, **Google Gemini Antigravity (`agy`)**, and **Anthropic Claude Code (`claude`)**.
  - Unified [`AgentService`](src/runtime/agent-service.ts) contract across all coding backends: session lifecycle, model & reasoning-effort discovery, token telemetry, turn timeouts, and cancellation.
  - One-tap **Brain → Code Handoff**: brainstorm an architectural solution with Brain, then forward the actionable proposal directly to Codex, Antigravity, or Claude Code.

- 🧠 **Nexus Brain (Cloud Providers & Local Fallback)**
  - Dedicated conversational intelligence for brainstorming, architectural discussions, and codebase exploration.
  - Routes through configured Cerebras, Groq, Gemini, and free OpenRouter models, then local Ollama. See [cloud setup](docs/brain-cloud.md).
  - Zero token consumption from paid coding agent quotas during planning phases.
  - Persistent persona, project preferences, and project memory synchronized locally and via Upstash Redis.

- 🤖 **OpenAI Codex Integration**
  - Starts Codex through `codex app-server --stdio` over JSON-RPC.
  - Creates and reuses workspace-bound Codex sessions with streaming deltas, diff capture, and interactive approvals.

- ✨ **Google Gemini Antigravity Integration**
  - Headless persistent process execution via `agy` CLI with NDJSON streaming (`stream-json`).
  - Automated session tracking, workspace binding, Git branch synchronization, and token/quota telemetry.

- 🟣 **Anthropic Claude Code Integration**
  - Headless execution via `claude` CLI (`--output-format stream-json --verbose`) with session continuation (`--resume`), model/effort selection, and live tool/file progress tracking.

- ⚡ **Instant Remote Approvals & Push Notifications**
  - Tool execution and file/command approvals pop up modally in real time over WebSocket with haptic feedback.
  - Native Android notifications and **Firebase Cloud Messaging (FCM)** wake-up push alerts when the phone screen is off or the app is in the background.
  - Fail-closed posture: unknown or expired approvals are rejected automatically.

- 🔍 **Visual Git Diff Inspector**
  - Per-message collapsible unified diff viewer with file stats (`+additions` / `-deletions`) and syntax-highlighted hunks.

- 🗣️ **Voice Dictation (STT) & Vocal Responses (TTS)**
  - Inline native Android speech recognition (`popup: false`) and fallback audio recording with local Whisper (`faster-whisper`) transcription.
  - High-quality neural vocal synthesis via **Fish Audio** with automatic fallback to native Android / Web SpeechSynthesis voices.

- 📊 **Live Usage & Quota Dashboard**
  - Real-time visibility into Brain provider rate limits, active agent sessions, context window utilization, and account quota reset timers.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## 🏗️ Architecture

```text
nexus/
├── src/
│   ├── daemon/
│   │   ├── cli.ts                  # Unified daemon CLI entrypoint (dist/daemon.js)
│   │   ├── daemon-server.ts        # HTTP REST API, static PWA server & WebSocket hub
│   │   └── ws-connection.ts        # RFC 6455 WebSocket frame parser & sender
│   ├── runtime/
│   │   ├── nexus-runtime.ts        # Headless multi-agent orchestrator
│   │   ├── agent-service.ts        # Unified AgentService interface & shared helpers
│   │   ├── model-preferences.ts    # Shared per-workspace model preference store
│   │   ├── session-persistence.ts  # Shared per-workspace session store
│   │   ├── project-registry.ts     # Workspace discovery & registration
│   │   ├── usage-dashboard.ts      # Agent & Brain quota/telemetry aggregator
│   │   ├── workspace.ts            # Standalone WorkspaceGuard
│   │   └── storage.ts              # Key-value storage abstraction
│   ├── conversational/             # Nexus Brain (Cloud providers + Ollama + read-only tools)
│   ├── codex/                      # OpenAI Codex App Server JSON-RPC client & service
│   ├── antigravity/                # Google Gemini Antigravity (agy) NDJSON client & service
│   ├── claude/                     # Anthropic Claude Code CLI streaming client & service
│   ├── memory/                     # Local file & Upstash Redis HybridStorage
│   ├── notifications/              # Firebase Cloud Messaging (FCM HTTP v1) push service
│   ├── security/                   # Token authentication & IP rate-limiting
│   ├── speech/                     # Local STT worker bridge & Fish Audio TTS service
│   └── workspace/                  # Git & filesystem safety preflight checks
├── web/
│   ├── app/
│   │   ├── app.vue                 # Main workspace & HUD shell
│   │   ├── components/             # Modular Vue 3 components (Diff, Approvals, Picker, Quota, etc.)
│   │   ├── composables/            # Vue composables (Speech, Voice, Notifications, Agent, Chat, Diff)
│   │   ├── types/                  # Shared frontend TypeScript definitions
│   │   └── utils/                  # Tested pure logic (diff parser, markdown, speech, handoff)
│   └── android/                    # Capacitor Android native project (ForegroundService + FCM)
└── windows/
    ├── NexusTray.cs                # Native Windows System Tray application source
    └── build-exe.bat               # One-click csc.exe compiler for Nexus.exe
```

### Runtime Flow

```text
Mobile App (Android APK) / Web Browser
      ↓  HTTP /api/* + WebSocket /ws
NexusDaemonServer (src/daemon/daemon-server.ts)
      ↓
NexusRuntime (src/runtime/nexus-runtime.ts)
      ↓
WorkspaceGuard (Git & directory preflight)
      ↓
ConversationalService (Brain) | CodexService | AntigravityService | ClaudeService
      ↓
Cloud/Ollama API | codex app-server | agy CLI | claude CLI
      ↓
Real-time WebSocket chunks, tool progress, diffs & approval modals
      ↓
Mobile App / Web Browser (+ FCM Push & Fish Audio / Native TTS)
```

---

## 🛠️ Built With

- [![Windows][windows-shield]][windows-url]
- [![Android][android-shield]][android-url]
- [![TypeScript][typescript-shield]][typescript-url]
- [![Node.js][node-shield]][node-url]
- [![Vue.js][vue-shield]][vue-url]
- Nuxt 4 & Capacitor 7 (Android)
- OpenAI Codex CLI (`codex app-server`)
- Google Gemini Antigravity CLI (`agy`)
- Anthropic Claude Code CLI (`claude`)
- Biome & esbuild

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# ✅ Getting Started

## 📋 Requirements

Nexus expects:

- Windows 10/11 with WSL2 (Ubuntu/Linux environment)
- Node.js 20+ & npm in WSL
- `tmux` installed in WSL (used by `Nexus.exe` to supervise the background daemon)
- At least one coding agent CLI installed and authenticated in WSL (`codex`, `agy`, or `claude`)
- Optional: JDK 21 + Android SDK Platform 35 (for building the Android APK locally)

Example environment checks in WSL:

```bash
node --version
tmux -V
codex --version
agy --version
claude --version
```

---

## 💻 Development Installation

Clone the repository and install dependencies (root and web):

```bash
git clone https://github.com/nlabrazi/nexus.git
cd nexus
npm install
cd web && npm install && cd ..
```

Validate and build the daemon and static web client:

```bash
npm run check-types
npm run lint
npm run package
npm run web:build
```

For development-specific instructions, see:

- [Development guide](docs/development.md)

---

## 🤖 Codex Setup

Install and authenticate the Codex CLI in your WSL environment:

```bash
codex --version
which codex
codex login status
```

Nexus communicates with Codex through `codex app-server --stdio`. See [Codex sessions](docs/codex-sessions.md).

---

## ✨ Gemini Antigravity Setup

Install the Google Gemini Antigravity CLI (`agy`) and verify model availability:

```bash
agy --version
which agy
agy models
```

Nexus executes Antigravity in headless streaming mode (`--input-format stream-json --output-format stream-json --sandbox`). See [Antigravity setup](docs/antigravity-setup.md).

---

## 🟣 Claude Code Setup

Install and authenticate Anthropic's `claude` CLI in WSL:

```bash
claude --version
which claude
```

Nexus executes Claude Code in non-interactive streaming JSON mode and preserves conversation continuity across turns.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🛋️ Daily Usage

## 🖥️ Windows System Tray (`Nexus.exe`)

1. Launch `Nexus.exe` on Windows (or enable **Démarrer avec Windows** from its tray menu).
2. `Nexus.exe` automatically starts `dist/daemon.js` inside a detached WSL `tmux` session (`nexus-daemon`) on port `4040`.
3. Right-click the Nexus tray icon near the Windows clock to:
   - Check daemon health (`[OK] En ligne (Port 4040)`).
   - Open the Web application (`http://localhost:4040`).
   - Copy the mobile URL (automatically prefers your Tailscale `100.x.y.z` or LAN IP).
   - Restart or stop the daemon.

---

## 📱 Mobile & Web App Controls

From the Android app or Web browser:

- **Home Screen**: Switch between **Mode Réflexion (Nexus Brain)** and **Mode Code (Codex / Antigravity / Claude)**, browse projects, or open Settings.
- **Agent & Model Picker**: Tap the active agent pill in the top HUD to switch agents, select a specific model, or adjust reasoning effort (`low`, `medium`, `high`, `xhigh`).
- **Voice Input**: Tap the microphone button for inline speech recognition (or server-side transcription) with optional auto-send.
- **Brain → Code Handoff**: On any Brain response, tap **Transmettre au mode Code** to prefill the coding agent composer with an actionable implementation prompt.
- **Diff Inspector**: Tap the modified files badge under an assistant reply to inspect syntax-highlighted unified git diffs.
- **Approvals Modal**: Authorize or decline sensitive command/file operations in one tap.

Detailed documentation:

- [Nexus Brain cloud providers and API key setup](docs/brain-cloud.md)
- [Agent Memory and Context Augmentation](docs/agent-memory.md)
- [Local speech-to-text setup and test](docs/speech-local.md)
- [Vocal configuration (Fish Audio & native TTS)](docs/speech-voice.md)
- [Usage & Quota Dashboard](docs/usage-dashboard.md)
- [Workspace and Git safety](docs/workspace-safety.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🔐 Security Model

Nexus grants remote control over local coding agents, so the default posture is **fail closed**.

### Authentication & Network

- Token-based authentication (`Authorization: Bearer <token>`) with brute-force rate limiting (`AuthService`).
- Designed for private local networks or encrypted **Tailscale** mesh VPN (`100.x.y.z`).
- HTTP request body size limits enforced on all daemon endpoints.

### Agent Sandboxing & Approvals

- Coding agents run scoped to the active project workspace.
- Sensitive operations trigger explicit remote approval requests with automatic timeout expiration.
- Unknown or expired approval requests fail closed.

### Workspace / Git

Before allowing branch switches or sensitive workspace actions, Nexus performs Git and directory safety checks:

- [Workspace safety](docs/workspace-safety.md)
- [Codex errors & timeouts](docs/codex-errors.md)
- [Regression tests](docs/regression-tests.md)

### Sensitive Data

Never commit sensitive credentials to the repository (ignored via `.gitignore`):

```text
.env / .env.local
firebase-service-account.json
google-services.json
API keys & tokens
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 📦 Private Packaging & Installation

### 1. Build the Daemon & Web Bundle (WSL)

```bash
npm run package
npm run web:build
```

### 2. Build `Nexus.exe` (Windows)

From Windows CMD or PowerShell, run:

```bat
windows\build-exe.bat
```

This compiles [`windows/NexusTray.cs`](windows/NexusTray.cs) into `windows\Nexus.exe` (with the embedded version and icon) and copies `Nexus.exe` to your Windows Desktop.

### 3. Build the Android APK

```bash
# Build APK with current version (outputs nexus-v<version>-b<build>.apk and nexus-debug.apk)
npm run android:build

# Bump patch version, synchronize version across daemon/web/exe/gradle, and build APK
npm run android:release
```

Note: Binary artifacts (`*.exe`, `*.apk`) are intentionally excluded from Git via `.gitignore`, while their version metadata (`1.3.0`) is synchronized across `package.json`, `web/package.json`, `web/android/app/build.gradle`, `web/app/utils/app-version.mjs`, `src/daemon/`, and `windows/NexusTray.cs`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🧪 Testing & Validation

Nexus maintains comprehensive unit and regression suites across both the backend runtime and the frontend client:

- **Backend Unit Tests (`329 tests`)**:
  - `NexusRuntime` isolation, memory injection, and multi-backend cancellation
  - `CodexService`, `AntigravityService`, and `ClaudeService` session lifecycle, streaming, approvals, and turn timeouts
  - `ConversationalService` (Nexus Brain) provider fallback, cooldowns, and read-only workspace tools
  - `HybridStorage` (local file + Upstash Redis synchronization)
  - `ProjectRegistry` and `FcmService` (Firebase Cloud Messaging OAuth2 & push delivery)
  - `WorkspaceGuard` and Git preflight safety checks
  - Local Speech-to-Text (`SpeechService`) and Fish Audio / TTS error classification
- **Frontend Unit Tests (`53 tests`)**:
  - Approval payload parsing, unified diff hunk parsing, markdown sanitization, assistant state machine, Fish Audio & native Android TTS/STT playback, progress tracker, and quota dashboard formatting.

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🧪 Development Commands

```bash
# TypeScript type-checking
npm run check-types

# Biome linter & formatter check
npm run lint

# Build production daemon bundle (dist/daemon.js)
npm run package

# Run backend unit tests
npm run test:unit

# Run frontend unit tests
cd web && npm run test:unit

# Run Nexus Daemon directly in terminal
npm run daemon

# Web / Mobile client (Nuxt 4)
npm run web:dev         # Start Nuxt dev server (http://localhost:3000)
npm run web:build       # Generate static web bundle (web/.output/public)

# Android (Capacitor + Gradle)
npm run android:sync    # Build web bundle and sync Capacitor Android project
npm run android:build   # Build versioned Android APK
npm run android:release # Bump patch version across project and build APK
npm run android:open    # Open Android project in Android Studio
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# 🗺️ Roadmap

### V1 (Completed)

- [x] Unified standalone daemon (`dist/daemon.js`) with HTTP REST & WebSocket streaming
- [x] Native Windows System Tray launcher (`Nexus.exe`)
- [x] Nuxt 4 & Capacitor Android mobile client with ForegroundService
- [x] Multi-backend orchestration: Nexus Brain, OpenAI Codex, Gemini Antigravity, and Claude Code
- [x] Brain → Code one-tap handoff
- [x] Instant remote approval modals with FCM push notifications
- [x] Upstash Redis hybrid persistence for chat history, persona, and project memory
- [x] Fish Audio neural TTS + native Android TTS/STT voice pipeline
- [x] Collapsible unified Git diff inspector and live quota dashboard

### Later

- [ ] Multi-node remote workstation federation
- [ ] Custom voice wake-word on Android client
- [ ] Automated background test runner notifications

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

# Fiabilité, voix et diagnostic

- [Logs persistants et diagnostic](docs/logging.md) : journalisation structurée du daemon et suivi des tâches.
- [Configuration vocale](docs/speech-voice.md) : activation Fish Audio, voix système, vitesse et lecture automatique.
- [Audit et périmètre de fiabilité](docs/reliability-audit.md).
- [Tests et validations](docs/regression-tests.md#fiabilité-voix-et-interface).
- [Dashboard des agents, modèles et quotas](docs/usage-dashboard.md) : données mesurées, renouvellement des limites et actualisation dans les paramètres.

Le client affiche les états `READY`, `THINKING`, `CODING`, `SPEAKING`, `ERROR` et `OFFLINE`.
Les paramètres détaillés restent accessibles depuis les menus secondaires.

---

# 📄 License

Nexus is proprietary software. All rights reserved.
See [LICENSE](LICENSE) for the terms.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<!-- MARKDOWN LINKS & IMAGES -->

[windows-shield]: https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white
[windows-url]: https://www.microsoft.com/windows

[android-shield]: https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white
[android-url]: https://developer.android.com/

[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/

[node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/

[vue-shield]: https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white
[vue-url]: https://vuejs.org/

[license-shield]: https://img.shields.io/badge/license-private-lightgrey?style=for-the-badge
[license-url]: LICENSE
