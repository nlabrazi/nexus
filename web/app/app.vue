<template>
  <div class="nexus-app">
    <!-- Top Header -->
    <header class="nexus-header">
      <div class="brand">
        <div class="brand-logo">
          <span class="logo-dot" :class="connectionStatus"></span>
          <span class="logo-icon">⚡</span>
        </div>
        <div class="brand-text">
          <div class="title-row">
            <h1 class="brand-title">NEXUS</h1>
            <span class="version-tag">v0.4.1</span>
          </div>
          <span class="brand-sub">Mobile Bridge</span>
        </div>
      </div>

      <div class="header-actions">
        <button type="button" class="btn-icon" :class="{ spinning: isRefreshing }" @click="fetchStatus"
          title="Rafraîchir" aria-label="Rafraîchir les informations">
          🔄
        </button>
        <button type="button" class="btn-icon" @click="showSettings = !showSettings" title="Paramètres de connexion"
          aria-label="Paramètres de connexion">
          ⚙️
        </button>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="nexus-main">
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

      <!-- Settings Modal / Drawer -->
      <section v-if="showSettings" class="settings-card">
        <div class="settings-header">
          <h2>Configuration de connexion</h2>
          <button type="button" class="btn-close" @click="showSettings = false">✕</button>
        </div>
        <div class="form-group">
          <label for="core-url">URL Nexus Core :</label>
          <input id="core-url" v-model="coreUrlInput" type="text" placeholder="http://127.0.0.1:4040"
            class="input-field" />
          <small class="helper-text">
            L'URL HTTP de votre serveur Nexus Core (ex: IP de votre PC sur le Wi-Fi local).
          </small>
        </div>
        <div class="form-group">
          <label for="core-token">Jeton d'authentification (optionnel) :</label>
          <input id="core-token" v-model="authTokenInput" type="password" placeholder="NEXUS_CORE_AUTH_TOKENS"
            class="input-field" />
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

      <!-- Error Card (if any) -->
      <section v-if="errorMessage && !showSettings" class="card card-error">
        <div class="card-header">
          <span class="card-icon">⚠️</span>
          <h3>Impossible de joindre Nexus Core</h3>
        </div>
        <p class="error-detail">{{ errorMessage }}</p>
        <div class="card-footer">
          <button type="button" class="btn-small" @click="fetchStatus">
            Réessayer maintenant
          </button>
          <button type="button" class="btn-small btn-secondary" @click="showSettings = true">
            Modifier l'URL Core
          </button>
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

            <!-- Node Capabilities & Details -->
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
              Pour lancer des tâches autonomes ou piloter vos agents depuis ce smartphone,
              démarrez votre nœud local sur votre machine :
            </p>
            <div class="code-box">
              <code>npm run desktop -- start</code>
              <button type="button" class="btn-copy" @click="copyCommand('npm run desktop -- start')">
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
          <div v-for="project in projectsList" :key="project.id || project.path" class="card project-card"
            :class="{ active: isProjectActive(project) }">
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
          <div class="stat-card">
            <span class="stat-number">{{ coreStatus?.activeTasks ?? 0 }}</span>
            <span class="stat-label">Tâches en cours</span>
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
            <p>Accès ultra-rapide en plein écran comme une application native.</p>
          </div>
        </div>
        <button type="button" class="btn-primary btn-install" @click="installPwa">
          Installer
        </button>
      </section>
    </main>

    <!-- Bottom Navigation / Status Footer -->
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
import { ref, computed, onMounted, onUnmounted } from 'vue';

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

// State
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

// Lifecycle
onMounted(() => {
  // 1. Determine Core URL
  if (typeof window !== 'undefined') {
    const savedUrl = localStorage.getItem('nexus_core_url');
    const savedToken = localStorage.getItem('nexus_auth_token') || '';

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

    // Listen for PWA install prompt
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      deferredPrompt.value = e;
    });
  }

  // 2. Fetch status immediately
  fetchStatus();

  // 3. Set polling interval (every 3 seconds)
  pollTimer = setInterval(() => {
    fetchStatus(true);
  }, 3000);

  // 4. Update clock for relative timestamps (every 1 second)
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

const projectsList = computed(() => {
  return coreStatus.value?.projects || [];
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
      'Accept': 'application/json',
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
  } catch {
    // fallback
  }
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
/* CSS Reset & Variables */
:root {
  --bg-primary: #07090e;
  --bg-secondary: #0d121d;
  --bg-card: #131b2e;
  --bg-card-hover: #17223b;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-accent: rgba(56, 189, 248, 0.3);

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

/* App Container */
.nexus-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 600px;
  margin: 0 auto;
  position: relative;
  background-color: var(--bg-primary);
}

/* Header */
.nexus-header {
  padding: calc(var(--safe-top) + 12px) 16px 12px;
  background: rgba(13, 18, 29, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
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

.logo-dot.connected {
  background-color: var(--color-success);
  box-shadow: 0 0 6px var(--color-success);
}

.logo-dot.connecting {
  background-color: var(--color-warning);
}

.logo-dot.error {
  background-color: var(--color-danger);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

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
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:active {
  transform: scale(0.92);
  background: rgba(255, 255, 255, 0.1);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* Main Area */
.nexus-main {
  flex: 1;
  padding: 14px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Status Banner */
.status-banner {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  border: 1px solid transparent;
  transition: all 0.3s ease;
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

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.status-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-pulse.connected {
  background-color: var(--color-success);
  box-shadow: 0 0 8px var(--color-success);
}

.status-pulse.connecting {
  background-color: var(--color-warning);
  animation: blink 1s infinite alternate;
}

.status-pulse.error {
  background-color: var(--color-danger);
}

@keyframes blink {
  from {
    opacity: 0.4;
  }

  to {
    opacity: 1;
  }
}

.status-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.uptime-badge {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Cards & Sections */
.section-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
  border-color: rgba(16, 185, 129, 0.3);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
  border-color: rgba(245, 158, 11, 0.3);
}

.badge-neutral {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
}

.badge-active {
  background: rgba(56, 189, 248, 0.18);
  color: var(--color-brand);
  border-color: rgba(56, 189, 248, 0.35);
}

/* Node Card */
.node-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.node-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.node-avatar {
  font-size: 1.5rem;
}

.node-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
}

.node-id {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: monospace;
}

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

.node-state-pill .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.node-state-pill.idle {
  background: rgba(16, 185, 129, 0.15);
  color: var(--color-success);
}

.node-state-pill.idle .dot {
  background: var(--color-success);
}

.node-state-pill.busy {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
}

.node-state-pill.busy .dot {
  background: var(--color-warning);
}

/* Node Project Box */
.node-project-box {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: var(--radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.node-project-box.no-project {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
}

.project-headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.project-tag {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-brand);
  font-weight: 700;
}

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

.branch-icon {
  font-size: 0.75rem;
}

.project-name {
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
}

.project-path {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}

.meta-item {
  display: flex;
  flex-direction: column;
}

.meta-label {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.meta-val {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
}

/* Node Offline State */
.node-offline .offline-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 12px 6px;
  gap: 10px;
}

.offline-icon {
  font-size: 2.2rem;
  opacity: 0.8;
}

.offline-hero h3 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #fff;
}

.offline-hero p {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.4;
  max-width: 400px;
}

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

.code-box code {
  flex: 1;
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--color-brand);
  text-align: left;
}

.btn-copy {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: var(--text-primary);
  font-size: 0.7rem;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.btn-copy:active {
  background: var(--color-brand);
  color: #000;
}

/* Projects List */
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.project-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  transition: border-color 0.2s ease;
}

.project-card.active {
  border-color: var(--border-accent);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.04), var(--bg-card));
}

.project-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.project-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
}

.folder-icon {
  font-size: 1.3rem;
}

.project-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #fff;
}

.project-path-text {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: monospace;
}

.project-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.timestamp {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.card-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 24px;
}

/* Telemetry Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

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

.stat-number {
  font-size: 1.5rem;
  font-weight: 800;
  color: #fff;
}

.stat-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Settings Card */
.settings-card {
  background: #0f1627;
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-header h2 {
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  cursor: pointer;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.input-field {
  background: #070a12;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  color: #fff;
  font-size: 0.9rem;
  font-family: monospace;
}

.input-field:focus {
  outline: none;
  border-color: var(--color-brand);
}

.helper-text {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.settings-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}

.btn-primary {
  background: var(--color-brand);
  color: #040914;
  font-weight: 700;
  font-size: 0.9rem;
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.btn-primary:active {
  opacity: 0.8;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 0.85rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  cursor: pointer;
}

.btn-small {
  background: var(--color-brand);
  color: #040914;
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
}

.card-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.05);
}

.card-error .card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fca5a5;
  font-size: 0.9rem;
}

.error-detail {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 6px;
}

.card-footer {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

/* Install Banner */
.install-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-color: rgba(56, 189, 248, 0.35);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), var(--bg-card));
}

.install-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.install-icon {
  font-size: 1.6rem;
}

.install-info h4 {
  font-size: 0.88rem;
  font-weight: 700;
  color: #fff;
}

.install-info p {
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.btn-install {
  white-space: nowrap;
  padding: 8px 14px;
  font-size: 0.82rem;
}

/* Footer */
.nexus-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-width: 600px;
  margin: 0 auto;
  padding: 8px 16px calc(var(--safe-bottom) + 8px);
  background: rgba(7, 9, 14, 0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--text-muted);
  z-index: 40;
}

.footer-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: monospace;
}

.core-ping-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.core-ping-dot.connected {
  background: var(--color-success);
}

.core-ping-dot.connecting {
  background: var(--color-warning);
}

.core-ping-dot.error {
  background: var(--color-danger);
}
</style>
