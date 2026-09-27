<template>
  <div class="nexus-app">
    <!-- Top Header -->
    <header class="nexus-header">
      <div class="brand">
        <div class="brand-logo">
          <span class="logo-dot" :class="connectionStatus"></span>
          <span class="logo-icon">{{ activeTab === 'chat' ? '🧠' : '⚡' }}</span>
        </div>
        <div class="brand-text">
          <div class="title-row">
            <h1 class="brand-title">NEXUS</h1>
            <span class="version-tag">v0.4.1</span>
          </div>
          <span class="brand-sub">
            {{ activeTab === 'chat' ? 'Brain Conversation' : 'Mobile Bridge' }}
          </span>
        </div>
      </div>

      <!-- Header actions -->
      <div class="header-actions">
        <button
          v-if="activeTab === 'chat' && messages.length > 0"
          type="button"
          class="btn-icon"
          title="Effacer la conversation"
          aria-label="Effacer la conversation"
          @click="clearChat"
        >
          🗑️
        </button>
        <button
          type="button"
          class="btn-icon"
          :class="{ spinning: isRefreshing }"
          title="Rafraîchir"
          aria-label="Rafraîchir les informations"
          @click="fetchStatus"
        >
          🔄
        </button>
        <button
          type="button"
          class="btn-icon"
          :class="{ active: showSettings }"
          title="Paramètres de connexion"
          aria-label="Paramètres de connexion"
          @click="showSettings = !showSettings"
        >
          ⚙️
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="tab-nav">
      <button
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === 'chat' }"
        @click="activeTab = 'chat'"
      >
        <span class="tab-icon">💬</span>
        <span class="tab-label">Brain Chat</span>
        <span v-if="isSending" class="tab-badge-pulse"></span>
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === 'activity' }"
        @click="activeTab = 'activity'"
      >
        <span class="tab-icon">⚡</span>
        <span class="tab-label">Activité</span>
        <span v-if="runningTasksCount > 0" class="tab-badge-count">{{ runningTasksCount }}</span>
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === 'dashboard' }"
        @click="activeTab = 'dashboard'"
      >
        <span class="tab-icon">📊</span>
        <span class="tab-label">Nœud & Projets</span>
        <span
          class="tab-status-dot"
          :class="onlineNodes.length > 0 ? 'online' : 'offline'"
        ></span>
      </button>
    </nav>

    <!-- Settings Modal / Drawer -->
    <section v-if="showSettings" class="settings-card">
      <div class="settings-header">
        <h2>Configuration de connexion</h2>
        <button type="button" class="btn-close" @click="showSettings = false">✕</button>
      </div>
      <div class="form-group">
        <label for="core-url">URL Nexus Core :</label>
        <input
          id="core-url"
          v-model="coreUrlInput"
          type="text"
          placeholder="http://127.0.0.1:4040"
          class="input-field"
        />
        <small class="helper-text">
          L'URL HTTP de votre serveur Nexus Core (ex: IP locale sur Wi-Fi).
        </small>
      </div>
      <div class="form-group">
        <label for="core-token">Jeton d'authentification (optionnel) :</label>
        <input
          id="core-token"
          v-model="authTokenInput"
          type="password"
          placeholder="NEXUS_CORE_AUTH_TOKENS"
          class="input-field"
        />
      </div>
      <div class="settings-actions">
        <button type="button" class="btn-primary" @click="saveSettings">
          Enregistrer & Reconnecter
        </button>
        <button type="button" class="btn-secondary" @click="resetSettings">
          Réinitialiser par défaut
        </button>
      </div>
    </section>

    <!-- Error Banner (if disconnected) -->
    <div v-if="errorMessage && !showSettings" class="error-banner">
      <span>⚠️ {{ errorMessage }}</span>
      <button type="button" class="btn-retry" @click="fetchStatus">Réessayer</button>
    </div>

    <!-- TAB 1: BRAIN CHAT -->
    <main v-if="activeTab === 'chat'" class="chat-container">
      <!-- Chat Sub-header (Context Bar) -->
      <div class="chat-context-bar">
        <div class="context-item">
          <span class="context-label">Nœud :</span>
          <span class="context-value" :class="primaryNode ? 'online' : 'offline'">
            {{ primaryNode ? `💻 ${primaryNode.nodeName}` : '❌ Déconnecté' }}
          </span>
        </div>
        <div class="context-item">
          <span class="context-label">Projet :</span>
          <span class="context-value project-pill">
            📁 {{ activeProjectName }}
          </span>
        </div>
        <div class="context-item backend-selector">
          <span class="context-label">Agent :</span>
          <select v-model="selectedBackend" class="select-backend">
            <option value="brain">🧠 Brain</option>
            <option value="codex">⚡ Codex</option>
            <option value="antigravity">✨ Antigravity</option>
          </select>
        </div>
      </div>

      <!-- Messages Stream -->
      <div ref="messagesScrollRef" class="messages-stream">
        <!-- Empty State with suggestions -->
        <div v-if="messages.length === 0" class="chat-welcome">
          <div class="welcome-icon">🧠</div>
          <h3>Nexus Brain</h3>
          <p>
            Posez vos questions ou décrivez une tâche. Le Brain analyse l'état de votre projet
            directement sur votre poste <strong>{{ primaryNode?.nodeName || 'Desktop' }}</strong>.
          </p>

          <div class="suggestions-grid">
            <button
              v-for="chip in quickChips"
              :key="chip"
              type="button"
              class="chip-btn"
              :disabled="!isNodeReady || isSending"
              @click="sendPrompt(chip)"
            >
              {{ chip }}
            </button>
          </div>
        </div>

        <!-- Message Bubbles -->
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message-wrapper"
          :class="msg.role"
        >
          <div class="message-bubble" :class="{ 'is-error': msg.error }">
            <div class="message-meta">
              <span class="sender-name">
                {{ msg.role === 'user' ? 'Vous' : selectedBackendLabel(msg.backend) }}
              </span>
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            </div>

            <!-- Message Body formatted -->
            <div class="message-content" v-html="renderMarkdown(msg.text)"></div>

            <!-- Optional file summary -->
            <div v-if="msg.fileSummary" class="file-summary-box">
              <span class="summary-icon">📝</span>
              <span>{{ msg.fileSummary }}</span>
            </div>
          </div>
        </div>

        <!-- Typing / Progress Indicator -->
        <div v-if="isSending" class="message-wrapper assistant">
          <div class="message-bubble typing-bubble">
            <div class="typing-top-row">
              <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <button
                v-if="currentInFlightTaskId"
                type="button"
                class="btn-cancel-in-flight"
                title="Arrêter la tâche en cours"
                @click="cancelTask(currentInFlightTaskId)"
              >
                ⏹ Arrêter
              </button>
            </div>
            <span class="typing-text">
              {{ currentProgressMessage || 'Brain réfléchit et analyse le code...' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Offline Warning Bar (if Desktop Node offline) -->
      <div v-if="!isNodeReady" class="node-offline-alert">
        <span>⚠️ Desktop Node déconnecté. Lancez <code>npm run desktop -- start</code> sur votre PC.</span>
      </div>

      <!-- Chat Input Area -->
      <div class="chat-input-bar">
        <textarea
          ref="chatTextareaRef"
          v-model="inputPrompt"
          rows="1"
          placeholder="Message au Brain (ex: 'Quel est l’état du projet ?')..."
          class="chat-textarea"
          :disabled="!isNodeReady || isSending"
          @keydown.enter.exact.prevent="submitMessage"
        ></textarea>
        <button
          type="button"
          class="btn-send"
          :disabled="!canSend"
          aria-label="Envoyer"
          @click="submitMessage"
        >
          <span v-if="!isSending">🚀</span>
          <span v-else class="spinning">⏳</span>
        </button>
      </div>
    </main>

    <!-- TAB 3: ACTIVITY (Tasks tracking & cancellation) -->
    <main v-if="activeTab === 'activity'" class="nexus-main activity-view">
      <div class="activity-top-bar">
        <div class="activity-title-group">
          <h2 class="section-title">Activité des Tâches</h2>
          <span class="activity-badge" :class="runningTasksCount > 0 ? 'badge-running' : 'badge-idle'">
            {{ runningTasksCount > 0 ?  : 'Aucune tâche active' }}
          </span>
        </div>
        <button
          type="button"
          class="btn-icon btn-refresh-activity"
          :class="{ spinning: isRefreshingTasks }"
          title="Rafraîchir les tâches"
          aria-label="Rafraîchir les tâches"
          @click="fetchTasks"
        >
          🔄
        </button>
      </div>

      <!-- Filters -->
      <div class="task-filter-bar">
        <button
          v-for="filter in taskFilterTabs"
          :key="filter.key"
          type="button"
          class="filter-pill"
          :class="{ active: activeTaskFilter === filter.key }"
          @click="activeTaskFilter = filter.key"
        >
          {{ filter.label }}
          <span class="filter-count">({{ filter.count }})</span>
        </button>
      </div>

      <!-- Live Running Task Highlight (if any) -->
      <section v-if="activeRunningTask" class="active-task-hero">
        <div class="hero-header">
          <div class="hero-status">
            <span class="pulse-dot"></span>
            <span class="hero-badge">TÂCHE EN COURS</span>
            <span class="backend-tag" :class="activeRunningTask.backend">{{ activeRunningTask.backend }}</span>
          </div>
          <button
            type="button"
            class="btn-stop-hero"
            @click="cancelTask(activeRunningTask.taskId)"
          >
            ⏹ Arrêter la tâche
          </button>
        </div>
        <p class="hero-prompt">"{{ activeRunningTask.prompt }}"</p>
        <div class="hero-progress">
          <span class="progress-spinner spinning">⏳</span>
          <span class="progress-label">
            {{ activeRunningTask.progressMessage || (activeRunningTask.stage ?  : 'Exécution en cours sur le Desktop Node...') }}
          </span>
        </div>
        <div class="hero-footer">
          <span class="hero-time">⏱️ Début : {{ formatTime(activeRunningTask.createdAt) }}</span>
          <span class="hero-node">Nœud : {{ activeRunningTask.nodeId.slice(0, 8) }}...</span>
        </div>
      </section>

      <!-- Task List Cards -->
      <div class="tasks-scroll-list">
        <div v-if="filteredTasks.length === 0" class="card-empty">
          <span class="empty-icon">📋</span>
          <p>Aucune tâche pour ce filtre.</p>
        </div>
        <div
          v-for="task in filteredTasks"
          :key="task.taskId"
          class="card task-item-card"
          :class="task.status"
        >
          <div class="task-item-header">
            <div class="task-item-badges">
              <span class="task-status-pill" :class="task.status">
                <span v-if="task.status === 'running'" class="pulse-dot-small"></span>
                {{ formatTaskStatus(task.status) }}
              </span>
              <span class="backend-tag" :class="task.backend">{{ task.backend }}</span>
              <span v-if="task.projectId" class="project-tag">{{ task.projectId }}</span>
            </div>
            <div class="task-header-right">
              <span class="task-date">{{ formatRelativeTime(task.createdAt) }}</span>
              <button
                v-if="task.status === 'running' || task.status === 'pending'"
                type="button"
                class="btn-stop-item"
                title="Arrêter cette tâche"
                @click="cancelTask(task.taskId)"
              >
                ⏹ Stop
              </button>
            </div>
          </div>

          <p class="task-prompt-text">{{ task.prompt }}</p>

          <!-- Result or Error preview -->
          <div v-if="task.result?.text" class="task-result-box">
            <span class="result-header">Résultat :</span>
            <p class="result-preview">{{ task.result.text }}</p>
            <div v-if="task.result.fileSummary" class="file-summary-badge">
              📝 {{ task.result.fileSummary }}
            </div>
          </div>

          <div v-if="task.error" class="task-error-box">
            <span class="error-badge">Erreur ({{ task.error.code }})</span>
            <p class="error-desc">{{ task.error.message }}</p>
          </div>

          <div class="task-item-footer">
            <span class="task-id-tag">#{{ task.taskId.slice(0, 8) }}</span>
            <span v-if="task.completedAt" class="task-duration">
              Durée : {{ (((task.completedAt - (task.startedAt || task.createdAt)) / 1000)).toFixed(1) }}s
            </span>
          </div>
        </div>
      </div>
    </main>

    <!-- TAB 2: DASHBOARD (Nœud, Projets & Core Telemetry) -->
    <main v-if="activeTab === 'dashboard'" class="nexus-main">
      <!-- Status Banner -->
      <section class="status-banner" :class="connectionStatus">
        <div class="status-indicator">
          <span class="status-pulse" :class="connectionStatus"></span>
          <span class="status-text">
            {{ connectionStatusText }}
          </span>
        </div>
        <div class="status-meta">
          <span v-if="lastUpdated">Mis à jour {{ lastUpdatedText }}</span>
          <span v-if="coreStatus?.uptimeSeconds !== undefined" class="uptime-badge">
            Uptime {{ formatUptime(coreStatus.uptimeSeconds) }}
          </span>
        </div>
      </section>

      <!-- Desktop Node Section -->
      <section class="section-container">
        <div class="section-title-row">
          <h2 class="section-title">Nœud Desktop</h2>
          <span class="badge" :class="onlineNodes.length > 0 ? 'badge-success' : 'badge-warning'">
            {{ onlineNodes.length > 0 ? `${onlineNodes.length} en ligne` : 'Déconnecté' }}
          </span>
        </div>

        <!-- Node Online Cards -->
        <div v-if="onlineNodes.length > 0" class="nodes-list">
          <div v-for="node in onlineNodes" :key="node.nodeId" class="card node-card">
            <div class="node-header">
              <div class="node-identity">
                <span class="node-avatar">💻</span>
                <div>
                  <h3 class="node-name">{{ node.nodeName }}</h3>
                  <span class="node-id">{{ node.nodeId.slice(0, 8) }}...</span>
                </div>
              </div>
              <span class="node-state-pill" :class="node.state">
                <span class="dot"></span>
                {{ formatState(node.state) }}
                <button
                  v-if="node.state === 'busy' && node.activeTaskId"
                  type="button"
                  class="btn-stop-node"
                  title="Arrêter la tâche en cours sur ce nœud"
                  @click.stop="cancelTask(node.activeTaskId)"
                >
                  ⏹ Stop
                </button>
              </span>
            </div>

            <!-- Active Project for Node -->
            <div v-if="node.activeProject" class="node-project-box">
              <div class="project-headline">
                <span class="project-tag">Projet Actif</span>
                <span class="branch-pill">
                  <span class="branch-icon">🌿</span>
                  {{ node.activeProject.currentBranch || 'staging' }}
                </span>
              </div>
              <h4 class="project-name">{{ node.activeProject.name }}</h4>
              <p class="project-path">{{ node.activeProject.path }}</p>
            </div>
            <div v-else class="node-project-box no-project">
              <p>Aucun projet actif sur ce nœud</p>
            </div>

            <!-- Node Details -->
            <div class="node-meta-grid">
              <div class="meta-item">
                <span class="meta-label">Système</span>
                <span class="meta-val">Linux / Desktop</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Agents supportés</span>
                <span class="meta-val">Codex, Antigravity, Brain</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Dernière activité</span>
                <span class="meta-val">{{ formatRelativeTime(node.lastHeartbeat) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Node Offline Card -->
        <div v-else class="card node-card node-offline">
          <div class="offline-hero">
            <span class="offline-icon">🔌</span>
            <h3>Aucun Desktop Node connecté</h3>
            <p>
              Pour lancer des tâches autonomes ou converser avec le Brain, démarrez votre nœud local
              sur votre machine de travail :
            </p>
            <div class="code-box">
              <code>npm run desktop -- start</code>
              <button
                type="button"
                class="btn-copy"
                @click="copyCommand('npm run desktop -- start')"
              >
                {{ copied ? 'Copié !' : 'Copier' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Projects Section -->
      <section class="section-container">
        <div class="section-title-row">
          <h2 class="section-title">Projets Détectés</h2>
          <span class="badge badge-neutral">{{ projectsList.length }} projet(s)</span>
        </div>

        <div v-if="projectsList.length > 0" class="projects-list">
          <div
            v-for="project in projectsList"
            :key="project.id || project.path"
            class="card project-card"
            :class="{ active: isProjectActive(project) }"
          >
            <div class="project-header">
              <div class="project-title-area">
                <span class="folder-icon">📁</span>
                <div>
                  <h3 class="project-title">{{ project.name }}</h3>
                  <p class="project-path-text">{{ project.path }}</p>
                </div>
              </div>
              <span v-if="isProjectActive(project)" class="badge badge-active">Actif</span>
            </div>

            <div class="project-footer">
              <div class="branch-pill">
                <span class="branch-icon">🌿</span>
                {{ project.currentBranch || 'staging' }}
              </div>
              <span class="timestamp">{{ formatRelativeTime(project.lastActive) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="card card-empty">
          <p>Aucun projet détecté via les nœuds connectés.</p>
        </div>
      </section>

      <!-- Telemetry Counters -->
      <section class="section-container">
        <h2 class="section-title">Activité Core</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-number">{{ coreStatus?.onlineNodes ?? 0 }}</span>
            <span class="stat-label">Nœuds en ligne</span>
          </div>
          <div class="stat-card stat-interactive" title="Voir l'activité des tâches" @click="activeTab = 'activity'">
            <span class="stat-number">{{ coreStatus?.activeTasks ?? 0 }}</span>
            <span class="stat-label">Tâches en cours ›</span>
          </div>
          <div class="stat-card">
            <span class="stat-number">{{ coreStatus?.pendingApprovals ?? 0 }}</span>
            <span class="stat-label">Approbations</span>
          </div>
        </div>
      </section>

      <!-- PWA Install Prompt Banner -->
      <section v-if="deferredPrompt" class="card install-banner">
        <div class="install-info">
          <span class="install-icon">📱</span>
          <div>
            <h4>Installer Nexus sur l'écran d'accueil</h4>
            <p>Accès plein écran instantané comme une application native.</p>
          </div>
        </div>
        <button type="button" class="btn-primary btn-install" @click="installPwa">
          Installer
        </button>
      </section>
    </main>

    <!-- Bottom Status Bar -->
    <footer class="nexus-footer">
      <div class="footer-status">
        <span class="core-ping-dot" :class="connectionStatus"></span>
        <span>{{ coreUrlDisplay }}</span>
      </div>
      <div class="footer-refresh-rate">
        <span>Auto-sync 3s</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

interface ConnectedNodeInfo {
  nodeId: string;
  nodeName: string;
  online: boolean;
  state: 'idle' | 'busy' | 'offline';
  lastHeartbeat?: number;
  activeProject?: {
    id?: string;
    name: string;
    path: string;
    currentBranch?: string;
  };
}

interface ProjectInfo {
  id?: string;
  name: string;
  path: string;
  currentBranch?: string;
  lastActive?: number;
}

interface CoreStatusData {
  uptimeSeconds: number;
  totalNodes: number;
  onlineNodes: number;
  nodes: ConnectedNodeInfo[];
  projects: ProjectInfo[];
  activeTasks?: number;
  pendingApprovals?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  backend: 'brain' | 'codex' | 'antigravity';
  text: string;
  timestamp: number;
  fileSummary?: string;
  error?: boolean;
}

// Navigation & Tab state
const activeTab = ref<'chat' | 'dashboard'>('chat');
const selectedBackend = ref<'brain' | 'codex' | 'antigravity'>('brain');

// Core Connection state
const coreUrl = ref<string>('');
const coreUrlInput = ref<string>('');
const authToken = ref<string>('');
const authTokenInput = ref<string>('');
const showSettings = ref<boolean>(false);
const isRefreshing = ref<boolean>(false);
const connectionStatus = ref<'connecting' | 'connected' | 'error'>('connecting');
const errorMessage = ref<string>('');
const lastUpdated = ref<number | null>(null);
const now = ref<number>(Date.now());
const copied = ref<boolean>(false);
const deferredPrompt = ref<any>(null);

const coreStatus = ref<CoreStatusData | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

// Chat State
const inputPrompt = ref<string>('');
const isSending = ref<boolean>(false);
const currentProgressMessage = ref<string>('');
const messages = ref<ChatMessage[]>([]);
const messagesScrollRef = ref<HTMLElement | null>(null);
const chatTextareaRef = ref<HTMLTextAreaElement | null>(null);

const quickChips = [
  'Quel est le statut du projet ?',
  'Sur quelle branche Git sommes-nous ?',
  'Résume les derniers commits sur staging',
  'Quels fichiers ont été modifiés récemment ?',
];

// Lifecycle
onMounted(() => {
  if (typeof window !== 'undefined') {
    const savedUrl = localStorage.getItem('nexus_core_url');
    const savedToken = localStorage.getItem('nexus_auth_token') || '';
    const savedTab = localStorage.getItem('nexus_active_tab') as 'chat' | 'dashboard' | null;

    if (savedUrl) {
      coreUrl.value = savedUrl;
    } else if (window.location.port === '4040' || window.location.pathname.startsWith('/')) {
      coreUrl.value = window.location.origin;
    } else {
      coreUrl.value = 'http://127.0.0.1:4040';
    }

    coreUrlInput.value = coreUrl.value;
    authToken.value = savedToken;
    authTokenInput.value = savedToken;
    if (savedTab) activeTab.value = savedTab;

    // Load persisted chat messages
    loadPersistedMessages();

    // Listen for PWA install prompt
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      deferredPrompt.value = e;
    });
  }

  fetchStatus();

  pollTimer = setInterval(() => {
    fetchStatus(true);
  }, 3000);

  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (clockTimer) clearInterval(clockTimer);
});

// Computed properties
const connectionStatusText = computed(() => {
  if (connectionStatus.value === 'connected') return 'Nexus Core connecté';
  if (connectionStatus.value === 'connecting') return 'Connexion à Nexus Core...';
  return 'Déconnecté de Nexus Core';
});

const coreUrlDisplay = computed(() => {
  try {
    const url = new URL(coreUrl.value);
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return coreUrl.value;
  }
});

const onlineNodes = computed(() => {
  return (coreStatus.value?.nodes || []).filter((n) => n.online);
});

const primaryNode = computed(() => {
  return onlineNodes.value[0] || null;
});

const isNodeReady = computed(() => {
  return onlineNodes.value.length > 0;
});

const activeProjectName = computed(() => {
  return primaryNode.value?.activeProject?.name || coreStatus.value?.projects[0]?.name || 'nexus';
});

const projectsList = computed(() => {
  return coreStatus.value?.projects || [];
});

const canSend = computed(() => {
  return inputPrompt.value.trim().length > 0 && isNodeReady.value && !isSending.value;
});

const lastUpdatedText = computed(() => {
  if (!lastUpdated.value) return '';
  const diffSec = Math.floor((now.value - lastUpdated.value) / 1000);
  if (diffSec < 2) return "à l'instant";
  return `il y a ${diffSec}s`;
});

// Actions
async function fetchStatus(background = false) {
  if (!background) isRefreshing.value = true;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, '')}/status`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (authToken.value) {
      headers['Authorization'] = `Bearer ${authToken.value}`;
    }

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    coreStatus.value = data;
    connectionStatus.value = 'connected';
    errorMessage.value = '';
    lastUpdated.value = Date.now();
  } catch (err: any) {
    connectionStatus.value = 'error';
    errorMessage.value = err?.message || 'Erreur réseau lors de la communication avec Core.';
  } finally {
    if (!background) isRefreshing.value = false;
  }
}

async function submitMessage() {
  if (!canSend.value) return;
  const promptText = inputPrompt.value.trim();
  inputPrompt.value = '';
  await sendPrompt(promptText);
}

async function sendPrompt(promptText: string) {
  if (!promptText || isSending.value) return;

  const userMsgId = `user-${Date.now()}`;
  const userMsg: ChatMessage = {
    id: userMsgId,
    role: 'user',
    backend: selectedBackend.value,
    text: promptText,
    timestamp: Date.now(),
  };

  messages.value.push(userMsg);
  saveMessages();
  scrollToBottom();

  isSending.value = true;
  currentProgressMessage.value = `Envoi au ${selectedBackendLabel(selectedBackend.value)}...`;

  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, '')}/api/tasks`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (authToken.value) {
      headers['Authorization'] = `Bearer ${authToken.value}`;
    }

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        backend: selectedBackend.value,
        prompt: promptText,
        projectId: primaryNode.value?.activeProject?.id || activeProjectName.value,
        wait: true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }

    // Add Assistant response
    const assistantMsg: ChatMessage = {
      id: `asst-${Date.now()}`,
      role: 'assistant',
      backend: selectedBackend.value,
      text: data.text || 'Tâche terminée sans sortie textuelle.',
      timestamp: Date.now(),
      fileSummary: data.fileSummary,
    };

    messages.value.push(assistantMsg);
    saveMessages();
  } catch (err: any) {
    const errorMsg: ChatMessage = {
      id: `err-${Date.now()}`,
      role: 'assistant',
      backend: selectedBackend.value,
      text: `❌ Erreur : ${err?.message || 'Échec de la tâche'}`,
      timestamp: Date.now(),
      error: true,
    };
    messages.value.push(errorMsg);
    saveMessages();
  } finally {
    isSending.value = false;
    currentProgressMessage.value = '';
    scrollToBottom();
  }
}

function clearChat() {
  if (confirm('Voulez-vous effacer l’historique de conversation ?')) {
    messages.value = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem('nexus_brain_messages');
    }
  }
}

function loadPersistedMessages() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('nexus_brain_messages');
    if (raw) {
      messages.value = JSON.parse(raw);
      scrollToBottom();
    }
  } catch {
    messages.value = [];
  }
}

function saveMessages() {
  if (typeof window === 'undefined') return;
  try {
    // Keep last 50 messages to preserve memory
    const trimmed = messages.value.slice(-50);
    localStorage.setItem('nexus_brain_messages', JSON.stringify(trimmed));
  } catch {}
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesScrollRef.value) {
      messagesScrollRef.value.scrollTop = messagesScrollRef.value.scrollHeight;
    }
  });
}

function selectedBackendLabel(b?: string): string {
  if (b === 'brain') return 'Nexus Brain';
  if (b === 'codex') return 'Codex';
  if (b === 'antigravity') return 'Antigravity';
  return 'Agent';
}

function renderMarkdown(raw: string): string {
  if (!raw) return '';
  let html = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang ... ```
  html = html.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function saveSettings() {
  let cleaned = coreUrlInput.value.trim().replace(/\/+$/, '');
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `http://${cleaned}`;
  }
  coreUrl.value = cleaned;
  authToken.value = authTokenInput.value.trim();

  if (typeof window !== 'undefined') {
    localStorage.setItem('nexus_core_url', coreUrl.value);
    localStorage.setItem('nexus_auth_token', authToken.value);
  }

  showSettings.value = false;
  fetchStatus();
}

function resetSettings() {
  if (typeof window !== 'undefined') {
    coreUrlInput.value = window.location.origin;
    authTokenInput.value = '';
    saveSettings();
  }
}

function isProjectActive(project: ProjectInfo): boolean {
  return onlineNodes.value.some(
    (n) => n.activeProject?.name === project.name || n.activeProject?.path === project.path
  );
}

function formatState(state: string): string {
  if (state === 'idle') return 'Prêt (idle)';
  if (state === 'busy') return 'En tâche (busy)';
  return state;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'inconnu';
  const diffSec = Math.floor((now.value - timestamp) / 1000);
  if (diffSec <= 1) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin}m`;
  return `il y a ${Math.floor(diffMin / 60)}h`;
}

async function copyCommand(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {}
}

async function installPwa() {
  if (!deferredPrompt.value) return;
  deferredPrompt.value.prompt();
  const choice = await deferredPrompt.value.userChoice;
  if (choice.outcome === 'accepted') {
    deferredPrompt.value = null;
  }
}
</script>

<style>
/* CSS Reset & Design System Variables */
:root {
  --bg-primary: #07090e;
  --bg-secondary: #0d121d;
  --bg-card: #131b2e;
  --bg-card-hover: #17223b;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-accent: rgba(56, 189, 248, 0.35);

  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  --color-brand: #38bdf8;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;

  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  user-select: none;
  min-height: 100vh;
}

/* App Shell */
.nexus-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 600px;
  margin: 0 auto;
  position: relative;
  background-color: var(--bg-primary);
  overflow: hidden;
}

/* Header */
.nexus-header {
  padding: calc(var(--safe-top) + 10px) 16px 10px;
  background: rgba(13, 18, 29, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: 50;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  position: relative;
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.logo-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--bg-primary);
}

.logo-dot.connected { background-color: var(--color-success); box-shadow: 0 0 6px var(--color-success); }
.logo-dot.connecting { background-color: var(--color-warning); }
.logo-dot.error { background-color: var(--color-danger); }

.brand-text { display: flex; flex-direction: column; }
.title-row { display: flex; align-items: center; gap: 6px; }

.brand-title {
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #fff;
}

.version-tag {
  font-size: 0.65rem;
  background: rgba(56, 189, 248, 0.15);
  color: var(--color-brand);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.brand-sub {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:active, .btn-icon.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: var(--color-brand);
}

.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Tab Navigation Bar */
.tab-nav {
  display: flex;
  background: rgba(13, 18, 29, 0.8);
  border-bottom: 1px solid var(--border-color);
  padding: 4px 8px;
  gap: 8px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border-bottom: 2px solid var(--color-brand);
}

.tab-icon { font-size: 1rem; }

.tab-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.tab-status-dot.online { background-color: var(--color-success); }
.tab-status-dot.offline { background-color: var(--color-danger); }

.tab-badge-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-brand);
  animation: pulse-glow 1s infinite alternate;
}

@keyframes pulse-glow {
  from { opacity: 0.4; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1.1); }
}

/* Error Banner */
.error-banner {
  background: rgba(239, 68, 68, 0.15);
  border-bottom: 1px solid rgba(239, 68, 68, 0.3);
  padding: 8px 16px;
  font-size: 0.78rem;
  color: #fca5a5;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-retry {
  background: rgba(239, 68, 68, 0.3);
  border: 1px solid #ef4444;
  color: #fff;
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}

/* ======================================================== */
/* CHAT TAB STYLES                                          */
/* ======================================================== */
.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: rgba(19, 27, 46, 0.6);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.75rem;
  flex-shrink: 0;
}

.context-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.context-label { color: var(--text-muted); }
.context-value { font-weight: 600; }
.context-value.online { color: var(--color-success); }
.context-value.offline { color: var(--color-danger); }

.project-pill {
  background: rgba(56, 189, 248, 0.1);
  color: var(--color-brand);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.select-backend {
  background: #090d16;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 0.74rem;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}

/* Messages Stream */
.messages-stream {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin: auto 0;
  padding: 24px 12px;
  gap: 12px;
}

.welcome-icon { font-size: 3rem; }
.chat-welcome h3 { font-size: 1.25rem; font-weight: 800; color: #fff; }
.chat-welcome p {
  font-size: 0.85rem;
  color: var(--text-secondary);
  max-width: 420px;
  line-height: 1.4;
}

.suggestions-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 380px;
  margin-top: 10px;
}

.chip-btn {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--color-brand);
  font-size: 0.82rem;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.chip-btn:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--border-accent);
}

.chip-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Message Wrappers */
.message-wrapper {
  display: flex;
  flex-direction: column;
  max-width: 85%;
}

.message-wrapper.user {
  align-self: flex-end;
}

.message-wrapper.assistant {
  align-self: flex-start;
}

.message-bubble {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 0.88rem;
  line-height: 1.45;
  user-select: text;
  word-break: break-word;
}

.message-wrapper.user .message-bubble {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message-wrapper.assistant .message-bubble {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

.message-bubble.is-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
}

.message-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
  font-size: 0.68rem;
  opacity: 0.75;
}

.sender-name { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }

.message-content {
  line-height: 1.5;
}

.file-summary-box {
  margin-top: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-accent);
  border-radius: 4px;
  font-size: 0.74rem;
  color: var(--color-brand);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Typing Indicator */
.typing-bubble {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(19, 27, 46, 0.8) !important;
}

.typing-indicator {
  display: flex;
  gap: 4px;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background-color: var(--color-brand);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) { animation-delay: 0s; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1.1); opacity: 1; }
}

.typing-text {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.node-offline-alert {
  padding: 6px 14px;
  background: rgba(245, 158, 11, 0.12);
  border-top: 1px solid rgba(245, 158, 11, 0.25);
  font-size: 0.75rem;
  color: #fde68a;
  text-align: center;
}

.node-offline-alert code {
  font-family: monospace;
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
}

/* Chat Input Bar */
.chat-input-bar {
  padding: 10px 14px calc(var(--safe-bottom) + 38px);
  background: rgba(13, 18, 29, 0.95);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.chat-textarea {
  flex: 1;
  background: #07090e;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  color: #fff;
  font-size: 0.9rem;
  font-family: inherit;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  outline: none;
  transition: border-color 0.2s ease;
}

.chat-textarea:focus { border-color: var(--color-brand); }
.chat-textarea:disabled { opacity: 0.5; }

.btn-send {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  border: none;
  color: #040914;
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.btn-send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: var(--bg-card);
  color: var(--text-muted);
}

/* Code Markdown Styling */
.code-block {
  background: #05070c;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 8px 0;
  font-family: monospace;
  font-size: 0.78rem;
  overflow-x: auto;
  color: #38bdf8;
}

.inline-code {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-brand);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.82rem;
}

/* ======================================================== */
/* DASHBOARD TAB STYLES                                     */
/* ======================================================== */
.nexus-main {
  flex: 1;
  padding: 14px 16px calc(var(--safe-bottom) + 50px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-banner {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  border: 1px solid transparent;
}

.status-banner.connected {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
  color: #a7f3d0;
}

.status-banner.connecting {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.25);
  color: #fde68a;
}

.status-banner.error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.status-indicator { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.status-pulse { width: 8px; height: 8px; border-radius: 50%; }
.status-pulse.connected { background-color: var(--color-success); box-shadow: 0 0 8px var(--color-success); }
.status-pulse.connecting { background-color: var(--color-warning); animation: blink 1s infinite alternate; }
.status-pulse.error { background-color: var(--color-danger); }
@keyframes blink { from { opacity: 0.4; } to { opacity: 1; } }

.status-meta { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-muted); }
.uptime-badge { background: rgba(255, 255, 255, 0.06); padding: 2px 6px; border-radius: 4px; }

.section-container { display: flex; flex-direction: column; gap: 10px; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; }
.section-title { font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.badge { font-size: 0.72rem; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
.badge-success { background: rgba(16, 185, 129, 0.15); color: var(--color-success); }
.badge-warning { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
.badge-neutral { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); }
.badge-active { background: rgba(56, 189, 248, 0.18); color: var(--color-brand); }

/* Node Card */
.node-card { display: flex; flex-direction: column; gap: 14px; }
.node-header { display: flex; align-items: center; justify-content: space-between; }
.node-identity { display: flex; align-items: center; gap: 12px; }
.node-avatar { font-size: 1.5rem; }
.node-name { font-size: 1.1rem; font-weight: 700; color: #fff; }
.node-id { font-size: 0.72rem; color: var(--text-muted); font-family: monospace; }

.node-state-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}
.node-state-pill .dot { width: 6px; height: 6px; border-radius: 50%; }
.node-state-pill.idle { background: rgba(16, 185, 129, 0.15); color: var(--color-success); }
.node-state-pill.idle .dot { background: var(--color-success); }
.node-state-pill.busy { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
.node-state-pill.busy .dot { background: var(--color-warning); }

.node-project-box {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: var(--radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.node-project-box.no-project { color: var(--text-muted); font-size: 0.85rem; text-align: center; }
.project-headline { display: flex; align-items: center; justify-content: space-between; }
.project-tag { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-brand); font-weight: 700; }
.branch-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 4px;
  color: var(--text-primary);
  font-family: monospace;
}
.branch-icon { font-size: 0.75rem; }
.project-name { font-size: 1rem; font-weight: 700; color: #fff; }
.project-path { font-size: 0.75rem; color: var(--text-muted); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.node-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}
.meta-item { display: flex; flex-direction: column; }
.meta-label { font-size: 0.68rem; color: var(--text-muted); }
.meta-val { font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); }

/* Node Offline State */
.node-offline .offline-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 12px 6px;
  gap: 10px;
}
.offline-icon { font-size: 2.2rem; opacity: 0.8; }
.offline-hero h3 { font-size: 1.05rem; font-weight: 700; color: #fff; }
.offline-hero p { font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4; max-width: 400px; }

.code-box {
  background: #05070b;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  width: 100%;
  max-width: 360px;
}
.code-box code { flex: 1; font-family: monospace; font-size: 0.8rem; color: var(--color-brand); text-align: left; }
.btn-copy { background: rgba(255, 255, 255, 0.08); border: none; color: var(--text-primary); font-size: 0.7rem; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
.btn-copy:active { background: var(--color-brand); color: #000; }

/* Projects List */
.projects-list { display: flex; flex-direction: column; gap: 10px; }
.project-card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.project-card.active { border-color: var(--border-accent); background: linear-gradient(135deg, rgba(56, 189, 248, 0.04), var(--bg-card)); }
.project-header { display: flex; align-items: flex-start; justify-content: space-between; }
.project-title-area { display: flex; align-items: center; gap: 10px; }
.folder-icon { font-size: 1.3rem; }
.project-title { font-size: 0.95rem; font-weight: 700; color: #fff; }
.project-path-text { font-size: 0.72rem; color: var(--text-muted); font-family: monospace; }
.project-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.timestamp { font-size: 0.7rem; color: var(--text-muted); }
.card-empty { text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 24px; }

/* Telemetry Grid */
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
}
.stat-number { font-size: 1.5rem; font-weight: 800; color: #fff; }
.stat-label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

/* Settings Card */
.settings-card {
  position: absolute;
  top: 90px;
  left: 16px;
  right: 16px;
  background: #0f1627;
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  z-index: 100;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.settings-header { display: flex; align-items: center; justify-content: space-between; }
.settings-header h2 { font-size: 1rem; font-weight: 700; color: #fff; }
.btn-close { background: transparent; border: none; color: var(--text-muted); font-size: 1.2rem; cursor: pointer; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
.input-field { background: #070a12; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 10px 12px; color: #fff; font-size: 0.9rem; font-family: monospace; }
.input-field:focus { outline: none; border-color: var(--color-brand); }
.helper-text { font-size: 0.72rem; color: var(--text-muted); }
.settings-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }

.btn-primary { background: var(--color-brand); color: #040914; font-weight: 700; font-size: 0.9rem; border: none; border-radius: var(--radius-sm); padding: 10px 16px; cursor: pointer; }
.btn-secondary { background: rgba(255, 255, 255, 0.06); color: var(--text-primary); font-size: 0.85rem; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 8px 14px; cursor: pointer; }

/* Install Banner */
.install-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-color: rgba(56, 189, 248, 0.35);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), var(--bg-card));
}
.install-info { display: flex; align-items: center; gap: 12px; }
.install-icon { font-size: 1.6rem; }
.install-info h4 { font-size: 0.88rem; font-weight: 700; color: #fff; }
.install-info p { font-size: 0.74rem; color: var(--text-secondary); }
.btn-install { white-space: nowrap; padding: 8px 14px; font-size: 0.82rem; }

/* Footer */
.nexus-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 600px;
  margin: 0 auto;
  padding: 4px 16px calc(var(--safe-bottom) + 2px);
  background: rgba(7, 9, 14, 0.95);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--text-muted);
  z-index: 40;
}
.footer-status { display: flex; align-items: center; gap: 6px; font-family: monospace; }
.core-ping-dot { width: 6px; height: 6px; border-radius: 50%; }
.core-ping-dot.connected { background: var(--color-success); }
.core-ping-dot.connecting { background: var(--color-warning); }
.core-ping-dot.error { background: var(--color-danger); }
</style>
