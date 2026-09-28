<template>
  <div class="nexus-app">
    <!-- Streamlined HUD Header -->
    <header class="app-header">
      <div class="header-left">
        <a class="wordmark" href="#" aria-label="Nexus, discussion" @click.prevent="activeTab = 'chat'">
          <span class="brand-mark">
            <NexusIcon name="nexus" />
          </span>
          <span>nexus<span class="brand-period">.</span></span>
        </a>
      </div>

      <div class="header-center">
        <button type="button" class="project-pill" aria-label="Changer de projet" @click="showProjectMenu = true">
          <NexusIcon name="folder" />
          <span class="project-pill-name">{{ activeProjectName || "Projet..." }}</span>
          <NexusIcon name="down" />
        </button>
      </div>

      <div class="header-right">
        <button class="status-beacon" type="button" :class="connectionStatus === 'connected' && isNodeReady
          ? 'online'
          : connectionStatus
          " :aria-label="connectionStatusText" @click="showSettings = true">
          <span class="beacon-dot" />
          <span class="beacon-label">{{
            connectionStatus === "connecting"
              ? "SYNC"
              : isNodeReady
                ? "ON"
                : "OFF"
          }}</span>
        </button>
        <button type="button" class="header-menu-btn" aria-label="Menu des options"
          @click="showQuickMenu = !showQuickMenu">
          <NexusIcon name="dots" />
        </button>
      </div>
    </header>

    <!-- Quick Overflow Menu Dropdown -->
    <div v-if="showQuickMenu" class="menu-backdrop" @click="showQuickMenu = false" />
    <div v-if="showQuickMenu" class="quick-menu" role="menu">
      <div class="menu-section">
        <span class="menu-section-title">AGENT IA</span>
        <div class="agent-segment">
          <button v-for="b in (['brain', 'codex', 'antigravity'] as const)" :key="b" type="button"
            class="agent-pill-btn" :class="{ active: selectedBackend === b }"
            @click="selectedBackend = b; showQuickMenu = false">
            {{ selectedBackendShortLabel(b) }}
          </button>
        </div>
      </div>

      <div class="menu-divider" />

      <button type="button" class="menu-item" @click="toggleTts(); showQuickMenu = false">
        <NexusIcon :name="ttsEnabled ? 'speaker' : 'speakerOff'" />
        <span>{{ ttsEnabled ? 'Voix activée' : 'Voix désactivée' }}</span>
      </button>

      <button type="button" class="menu-item" @click="showQuickMenu = false; showProjectMenu = true">
        <NexusIcon name="folder" />
        <span>Changer de projet</span>
      </button>

      <button v-if="messages.length" type="button" class="menu-item danger" @click="showQuickMenu = false; clearChat()">
        <NexusIcon name="trash" />
        <span>Effacer la discussion</span>
      </button>

      <div class="menu-divider" />

      <button type="button" class="menu-item" @click="showQuickMenu = false; showSettings = true">
        <NexusIcon name="settings" />
        <span>Connexion & paramètres</span>
      </button>
    </div>

    <!-- MAIN CHAT VIEW (Purified, only strict necessary) -->
    <main v-if="activeTab === 'chat'" class="chat-view" aria-label="Discussion">
      <div ref="messagesScrollRef" class="messages-stream" role="log" aria-label="Messages" aria-live="polite"
        aria-relevant="additions text">
        <!-- Minimalist Jarvis Holographic Standby Screen -->
        <div v-if="!messages.length" class="welcome-hud">
          <div class="arc-reactor" aria-hidden="true">
            <div class="core-ring outer" />
            <div class="core-ring middle" />
            <div class="core-glyph">
              <NexusIcon name="nexus" />
            </div>
          </div>

          <div class="hud-status-block">
            <p class="hud-code">// NEXUS PROTOCOL v1.0.0</p>
            <h1 class="hud-title">
              {{
                isNodeReady
                  ? "SYSTÈME EN LIGNE"
                  : connectionStatus === "connecting"
                    ? "CONNEXION EN COURS…"
                    : "POSTE HORS LIGNE"
              }}
            </h1>
            <div class="hud-telemetry">
              <span class="hud-pill" :class="{ ready: isNodeReady }">
                <span class="beacon-dot" />
                {{ isNodeReady ? "CORE ACTIF" : "EN ATTENTE" }}
              </span>
              <span v-if="activeProjectName" class="hud-pill project">
                <NexusIcon name="folder" /> {{ activeProjectName }}
              </span>
            </div>
          </div>

          <button v-if="!isNodeReady && connectionStatus !== 'connecting'" type="button"
            class="button primary hud-connect-btn" @click="
              connectionStatus === 'error' || !coreUrl
                ? (showSettings = true)
                : (activeTab = 'dashboard')
              ">
            <NexusIcon name="settings" />
            <span>Connecter mon poste</span>
          </button>

        </div>

        <!-- Chat Messages -->
        <article v-for="msg in messages" :key="msg.id" class="message" :class="[msg.role, { 'is-error': msg.error }]">
          <div class="message-meta">
            <span>{{
              msg.role === "user" ? "Vous" : selectedBackendLabel(msg.backend)
            }}</span>
            <div class="message-meta-actions">
              <button v-if="msg.role === 'assistant' && !msg.error && ttsAvailable && ttsEnabled" type="button" class="icon-button tts-play-btn"
                :class="{ speaking: currentSpeakingId === msg.id && isSpeaking }"
                :aria-label="currentSpeakingId === msg.id && isSpeaking ? 'Arrêter la lecture' : 'Écouter le message vocalement'"
                @click="toggleSpeakMessage(msg)">
                <NexusIcon :name="currentSpeakingId === msg.id && isSpeaking ? 'stop' : 'speaker'" />
              </button>
              <time>{{ formatTime(msg.timestamp) }}</time>
            </div>
          </div>
          <div class="message-content" v-html="renderMarkdown(msg.text)" />
          <p v-if="msg.fileSummary" class="file-summary">
            <NexusIcon name="folder" />{{ msg.fileSummary }}
          </p>
        </article>

        <!-- In-flight Task Progress -->
        <div v-if="isSending" class="task-progress" role="status">
          <span class="busy-indicator" /><span>{{
            currentProgressMessage || "En cours…"
          }}</span>
          <button v-if="currentInFlightTaskId" type="button" class="text-button danger"
            @click="cancelTask(currentInFlightTaskId)">
            <NexusIcon name="stop" />Arrêter
          </button>
        </div>
      </div>

      <!-- Floating HUD Composer Area -->
      <div class="composer-area">
        <!-- Floating Pending Approvals Notice -->
        <button v-if="pendingApprovalsCount > 0" type="button" class="approval-hud-pill"
          @click="showApprovalModal = true">
          <NexusIcon name="shield" />
          <span>{{
            pendingApprovalsCount === 1
              ? "Une action attend votre accord"
              : `${pendingApprovalsCount} actions attendent votre accord`
          }}</span>
          <NexusIcon name="chevron" />
        </button>

        <div v-if="errorMessage && isNodeReady" class="inline-error" role="alert">
          {{ errorMessage }}
        </div>

        <p v-if="speechError" class="inline-error" role="status">
          {{ speechError }}
          <button type="button" class="text-button" @click="speechError = ''">Fermer</button>
        </p>

        <!-- Voice Recognition Interim Notice -->
        <div v-if="isListening || isProcessingAudio" class="voice-hud-notice" role="status">
          <span class="status-dot recording" /><span>{{
            interimTranscript ||
            (isProcessingAudio
              ? "Transcription neuronale…"
              : "Écoute en cours… Touchez pour terminer.")
          }}</span>
          <button type="button" class="icon-button" aria-label="Annuler la dictée" @click="cancelVoiceRecording">
            <NexusIcon name="close" />
          </button>
        </div>

        <form class="composer" @submit.prevent="submitMessage">
          <label for="message" class="sr-only">Votre message</label>
          <textarea id="message" ref="chatTextareaRef" v-model="inputPrompt" rows="1" :placeholder="isNodeReady
            ? 'Donnez une instruction à Jarvis...'
            : 'Poste hors ligne (brouillon actif)...'
            " :disabled="isSending" @keydown="handleComposerKeydown" @input="resizeComposer" />
          <div class="composer-tools">
            <button type="button" class="agent-badge-btn" aria-label="Changer d'agent et de modèle"
              @click="openAgentPicker">
              <NexusIcon :name="selectedBackend === 'brain' ? 'sparkles' : 'zap'" class="agent-zap-icon" />
              <span>{{ selectedBackendShortLabel(selectedBackend) }}<span v-if="currentSelectedModelShort"
                  class="agent-model-pill">{{ currentSelectedModelShort }}</span></span>
              <NexusIcon name="down" />
            </button>

            <div class="composer-actions">
              <button type="button" class="icon-button mic-button" :class="{ recording: isListening }"
                :disabled="isSending || isProcessingAudio" :aria-label="isListening ? 'Terminer la dictée' : 'Dicter un message'
                  " :aria-pressed="isListening" @click="handleMicClick">
                <NexusIcon :name="isListening ? 'stop' : 'mic'" />
              </button>
              <button type="submit" class="send-button" :disabled="!canSend" aria-label="Envoyer le message">
                <NexusIcon name="arrow" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>

    <!-- ACTIVITY VIEW -->
    <main v-if="activeTab === 'activity'" class="page-view" aria-labelledby="activity-title">
      <div class="page-heading">
        <div>
          <p class="eyebrow">LE SUIVI</p>
          <h1 id="activity-title">Activité<span class="accent">.</span></h1>
        </div>
        <button type="button" class="icon-button" :disabled="isRefreshingTasks || isRefreshingApprovals"
          aria-label="Actualiser l’activité" @click="refreshActivity">
          <NexusIcon name="refresh" />
        </button>
      </div>
      <button v-if="pendingApprovalsCount" type="button" class="approval-hud-pill" @click="showApprovalModal = true">
        <NexusIcon name="shield" /><span>{{ pendingApprovalsCount }} autorisation{{
          pendingApprovalsCount > 1 ? "s" : ""
          }}
          en attente</span>
        <NexusIcon name="chevron" />
      </button>
      <div v-if="tasks.length" class="filter-bar" role="group" aria-label="Filtrer les tâches">
        <button v-for="filter in taskFilterTabs" :key="filter.key" type="button"
          :aria-pressed="activeTaskFilter === filter.key" @click="activeTaskFilter = filter.key">
          {{ filter.label }}<span v-if="filter.count">{{ filter.count }}</span>
        </button>
      </div>
      <div v-if="!filteredTasks.length" class="empty-state">
        <NexusIcon name="activity" />
        <h2>
          {{
            tasks.length ? "Rien dans cette vue" : "Aucune tâche récente."
          }}
        </h2>
        <p>
          {{
            tasks.length
              ? "Essayez un autre filtre."
              : "Vos tâches et leurs résultats s'afficheront ici."
          }}
        </p>
        <button v-if="!tasks.length" type="button" class="button secondary" @click="activeTab = 'chat'">
          Ouvrir la discussion
          <NexusIcon name="chevron" />
        </button>
      </div>
      <div class="task-list">
        <article v-for="task in filteredTasks" :key="task.taskId" class="task-row">
          <div class="task-line">
            <span class="task-status" :class="task.status"><span class="status-dot" />{{
              formatTaskStatus(task.status)
              }}</span><time>{{ formatRelativeTime(task.createdAt) }}</time>
          </div>
          <h2>{{ task.prompt }}</h2>
          <div class="task-subline">
            <span>{{ selectedBackendLabel(task.backend) }}</span><span v-if="task.projectId">{{
              projectLabel(task.projectId)
            }}</span><button v-if="task.status === 'running' || task.status === 'pending'" type="button"
              class="text-button danger" @click="cancelTask(task.taskId)">
              <NexusIcon name="stop" />Arrêter
            </button>
          </div>
          <p v-if="task.status === 'running' && task.progressMessage" class="task-progress-label">
            {{ task.progressMessage }}
          </p>
          <p v-if="task.error" class="inline-error" role="alert">
            {{ task.error.message || "La tâche a échoué." }}
          </p>
          <details v-if="task.result?.text || task.result?.fileSummary" class="task-result">
            <summary>Voir le résultat
              <NexusIcon name="down" />
            </summary>
            <div v-if="task.result.text" class="message-content" v-html="renderMarkdown(task.result.text)" />
            <p v-if="task.result.fileSummary" class="file-summary">
              {{ task.result.fileSummary }}
            </p>
          </details>
        </article>
      </div>
    </main>

    <!-- PROJECTS VIEW -->
    <main v-if="activeTab === 'dashboard'" class="page-view" aria-labelledby="projects-title">
      <div class="page-heading">
        <div>
          <p class="eyebrow">VOTRE ESPACE</p>
          <h1 id="projects-title">Projets<span class="accent">.</span></h1>
        </div>
        <button type="button" class="icon-button" :disabled="isRefreshing" aria-label="Actualiser les projets"
          @click="handleManualRefresh">
          <NexusIcon name="refresh" />
        </button>
      </div>
      <p v-if="errorMessage" class="inline-error" role="alert">
        {{ errorMessage }}
      </p>
      <div v-if="projectsList.length" class="project-list">
        <button v-for="project in projectsList" :key="project.id || project.path" type="button" class="project-row"
          :class="{ selected: isProjectActive(project) }" :disabled="isSwitchingProject || isSending"
          :aria-label="`${isProjectActive(project) ? 'Ouvrir' : 'Choisir'} ${project.name}`"
          @click="openProject(project)">
          <span class="project-symbol">
            <NexusIcon name="folder" />
          </span><span class="project-info"><span class="project-name">{{ project.name }}</span><span
              v-if="project.currentBranch" class="project-branch">
              <NexusIcon name="branch" />{{ project.currentBranch }}
            </span></span>
          <span v-if="switchingProjectId === (project.id || project.path)"
            class="project-selection">Ouverture…</span><span v-else-if="isProjectActive(project)"
            class="project-selection">Actif
            <NexusIcon name="check" />
          </span>
          <NexusIcon v-else name="chevron" />
        </button>
      </div>
      <div v-else class="empty-state">
        <NexusIcon name="folder" />
        <h2>
          {{
            connectionStatus === 'error'
              ? "Retrouvez vos projets."
              : "Aucun projet pour le moment."
          }}
        </h2>
        <p>
          {{
            connectionStatus === 'error'
              ? "Connectez votre poste pour les retrouver ici."
              : "Ouvrez un projet sur votre poste et démarrez Nexus."
          }}
        </p>
        <button v-if="connectionStatus === 'error'" type="button" class="button primary" @click="showSettings = true">
          Configurer la connexion
        </button>
      </div>

      <section class="workstation-section" aria-labelledby="workstation-title">
        <h2 id="workstation-title" class="section-label">Poste de travail</h2>
        <details v-for="node in onlineNodes" :key="node.nodeId" class="workstation">
          <summary>
            <NexusIcon name="computer" /><span>{{ node.nodeName }}</span><span class="node-state"><span
                class="status-dot online" />{{
                  formatState(node.state)
                }}</span>
            <NexusIcon name="down" />
          </summary>
          <div class="workstation-details">
            <p v-if="node.activeProject?.path" class="project-path">
              {{ node.activeProject.path }}
            </p>
            <p v-if="node.lastHeartbeat">
              Dernier contact {{ formatRelativeTime(node.lastHeartbeat) }}
            </p>
            <button v-if="node.state === 'busy' && node.activeTaskId" type="button" class="text-button danger"
              @click="cancelTask(node.activeTaskId)">
              Arrêter la tâche
            </button>
          </div>
        </details>
        <div v-if="!onlineNodes.length" class="workstation-offline">
          <NexusIcon name="computer" />
          <div>
            <h3>En attente de votre poste</h3>
            <p>Démarrez Nexus sur votre ordinateur.</p>
            <details class="setup-help">
              <summary>Comment le connecter ?</summary>
              <p>Dans le terminal de Nexus sur votre ordinateur :</p>
              <div class="command-line">
                <code>npm run desktop -- start</code><button type="button" class="text-button"
                  @click="copyCommand('npm run desktop -- start')">
                  {{ copied ? "Copié" : "Copier" }}
                </button>
              </div>
              <button type="button" class="text-button" @click="showSettings = true">
                Paramètres de connexion
              </button>
            </details>
          </div>
        </div>
      </section>
      <button v-if="deferredPrompt" type="button" class="button secondary install-button" @click="installPwa">
        Installer Nexus
      </button>
    </main>

    <!-- BOTTOM HUD NAVIGATION -->
    <nav class="bottom-nav" aria-label="Navigation principale">
      <button type="button" :aria-current="activeTab === 'chat' ? 'page' : undefined" @click="activeTab = 'chat'">
        <span class="nav-icon">
          <NexusIcon name="chat" /><span v-if="isSending" class="nav-dot" />
        </span><span>Discussion</span>
      </button>
      <button type="button" :aria-current="activeTab === 'activity' ? 'page' : undefined"
        @click="activeTab = 'activity'">
        <span class="nav-icon">
          <NexusIcon name="activity" /><span v-if="pendingApprovalsCount || runningTasksCount" class="nav-count">{{
            pendingApprovalsCount || runningTasksCount }}</span>
        </span><span>Activité</span>
      </button>
      <button type="button" :aria-current="activeTab === 'dashboard' ? 'page' : undefined"
        @click="activeTab = 'dashboard'">
        <span class="nav-icon">
          <NexusIcon name="folder" />
        </span><span>Projets</span>
      </button>
    </nav>

    <!-- SETTINGS SHEET -->
    <NexusSheet v-model="showSettings" title="Connexion & préférences">
      <form class="settings-form" @submit.prevent="saveSettings">
        <p>Reliez Nexus à votre poste de travail.</p>
        <div class="field">
          <label for="core-url">Adresse du serveur</label><input id="core-url" v-model="coreUrlInput" type="text"
            inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" required
            aria-describedby="server-help" /><small id="server-help">{{
              isNativeApp
                ? "L’adresse de votre ordinateur sur le réseau, avec le port de Nexus."
                : "L’adresse et le port de votre serveur Nexus."
            }}</small>
        </div>
        <div class="field">
          <label for="core-token">Jeton d’accès <span class="optional">si configuré</span></label><input id="core-token"
            v-model="authTokenInput" type="password" autocomplete="current-password" spellcheck="false" />
        </div>
        <label class="switch-field"><span>Envoyer après la dictée<small>Désactivez pour relire avant
              l’envoi.</small></span><input v-model="autoSendVoice" type="checkbox" role="switch" /></label>
        <details class="settings-details">
          <summary>Voix</summary>
          <p v-if="!ttsAvailable">La lecture vocale n’est pas disponible sur cet appareil.</p>
          <template v-else>
            <label class="switch-field"><span>Activer la voix</span><input v-model="ttsEnabled" type="checkbox" role="switch" /></label>
            <label class="switch-field"><span>Lire automatiquement les réponses</span><input v-model="autoSpeak" :disabled="!ttsEnabled" type="checkbox" role="switch" /></label>
            <div class="field">
              <label for="speech-voice">Voix</label>
              <select id="speech-voice" v-model="speechVoice" :disabled="!ttsEnabled">
                <option value="">Automatique (français)</option>
                <option v-if="speechVoice && !speechVoices.some(voice => voice.voiceURI === speechVoice)" :value="speechVoice">Voix enregistrée indisponible — choix automatique</option>
                <option v-for="voice in speechVoices" :key="voice.voiceURI" :value="voice.voiceURI">{{ voice.name }} ({{ voice.lang }})</option>
              </select>
            </div>
            <div class="field">
              <label for="speech-rate">Vitesse : {{ speechRate.toFixed(1) }}×</label>
              <input id="speech-rate" v-model.number="speechRate" :disabled="!ttsEnabled" type="range" min="0.8" max="1.3" step="0.1" />
            </div>
            <button type="button" class="text-button" :disabled="!ttsEnabled" @click="speakMessage('Bonjour. Nexus est prêt à vous écouter.')">Écouter un exemple</button>
          </template>
        </details>
        <p v-if="settingsError" class="inline-error" role="alert">
          {{ settingsError }}
        </p>
        <button type="submit" class="button primary full-width">
          Enregistrer et connecter
          <NexusIcon name="chevron" />
        </button>
        <details class="settings-details">
          <summary>Options de connexion</summary>
          <p>{{ connectionStatusText }}</p>
          <p v-if="lastUpdated">Dernier contact {{ lastUpdatedText }}</p>
          <button type="button" class="text-button" @click="resetSettings">
            Rétablir les paramètres par défaut
          </button>
        </details>
      </form>
    </NexusSheet>

    <!-- APPROVALS SHEET -->
    <NexusSheet v-model="showApprovalModal" title="Autorisation requise">
      <div v-if="activeApproval" class="approval-content">
        <div class="approval-heading">
          <NexusIcon name="shield" /><span>{{ activeApproval.agentName
            }}<small>{{ formatApprovalKind(activeApproval.kind) }}</small></span>
        </div>
        <pre class="approval-code"><code>{{ activeApproval.details }}</code></pre>
        <p class="approval-expiry" :class="{
          danger: getApprovalRemainingSeconds(activeApproval.expiresAt) <= 15,
        }">
          {{
            isApprovalExpired(activeApproval.expiresAt)
              ? "Demande expirée. L’action a été refusée."
              : `Refus automatique dans ${getApprovalRemainingSeconds(activeApproval.expiresAt)} s.`
          }}
        </p>
        <div v-if="pendingApprovals.length > 1" class="approval-pagination">
          <button type="button" class="icon-button" :disabled="activeApprovalIndex === 0"
            aria-label="Demande précédente" @click="activeApprovalIndex--">
            <NexusIcon name="chevron" class="reversed" />
          </button><span>{{ activeApprovalIndex + 1 }} / {{ pendingApprovals.length }}</span><button type="button"
            class="icon-button" :disabled="activeApprovalIndex >= pendingApprovals.length - 1"
            aria-label="Demande suivante" @click="activeApprovalIndex++">
            <NexusIcon name="chevron" />
          </button>
        </div>
        <div class="approval-actions">
          <button type="button" class="button secondary" :disabled="isDecidingApproval || isApprovalExpired(activeApproval.expiresAt)
            " @click="decideApproval(activeApproval.approvalId, 'decline')">
            Refuser</button><button type="button" class="button primary" :disabled="isDecidingApproval || isApprovalExpired(activeApproval.expiresAt)
              " @click="decideApproval(activeApproval.approvalId, 'accept')">
            {{ isDecidingApproval ? "Envoi…" : "Autoriser" }}
          </button>
        </div>
      </div>
      <div v-else class="empty-state compact">
        <NexusIcon name="check" />
        <h3>Aucune demande en attente</h3>
      </div>
    </NexusSheet>

    <!-- QUICK PROJECT SELECTOR SHEET -->
    <NexusSheet v-model="showProjectMenu" title="Changer de projet">
      <div v-if="projectsList.length" class="project-sheet-list">
        <button v-for="project in projectsList" :key="project.id || project.path" type="button"
          class="project-sheet-row" :class="{ selected: isProjectActive(project) }"
          :disabled="isSwitchingProject || isSending" @click="openProject(project); showProjectMenu = false">
          <span class="project-symbol">
            <NexusIcon name="folder" />
          </span>
          <span class="project-info">
            <span class="project-name">{{ project.name }}</span>
            <span v-if="project.currentBranch" class="project-branch">
              <NexusIcon name="branch" />{{ project.currentBranch }}
            </span>
          </span>
          <span v-if="isProjectActive(project)" class="project-badge-active">Actif</span>
        </button>
      </div>
      <div v-else class="empty-state compact">
        <p>Aucun projet détecté sur le poste connecté.</p>
        <button type="button" class="button secondary" @click="showProjectMenu = false; activeTab = 'dashboard'">
          Voir le statut du poste
        </button>
      </div>
    </NexusSheet>

    <!-- AGENT & MODEL SELECTOR SHEET -->
    <NexusSheet v-model="showAgentPickerSheet" title="Agent IA & Modèle">
      <div class="agent-model-sheet">
        <div class="sheet-section-title">AGENT IA</div>
        <div class="agent-sheet-list">
          <button v-for="agent in agentOptions" :key="agent.id" type="button" class="agent-card-row"
            :class="{ selected: selectedBackend === agent.id }" @click="handleSelectBackend(agent.id)">
            <div class="agent-card-icon">
              <NexusIcon :name="agent.id === 'brain' ? 'sparkles' : agent.id === 'codex' ? 'zap' : 'branch'" />
            </div>
            <div class="agent-card-info">
              <div class="agent-card-name">{{ agent.name }}</div>
              <div class="agent-card-desc">{{ agent.description }}</div>
            </div>
            <span v-if="selectedBackend === agent.id" class="agent-selected-badge">
              <NexusIcon name="check" />
            </span>
          </button>
        </div>

        <div class="sheet-section-title model-section-title">
          <span>MODÈLE ({{ selectedBackendShortLabel(selectedBackend) }})</span>
          <span v-if="isLoadingModels" class="model-loading-spinner">Chargement…</span>
        </div>

        <div v-if="currentBackendModels.length" class="models-sheet-list">
          <button v-for="m in currentBackendModels" :key="m.id || m.model" type="button" class="model-card-row"
            :class="{ selected: currentSelectedModel === m.model }" @click="handleSelectModel(m.model)">
            <div class="model-card-info">
              <div class="model-card-name">{{ m.displayName || m.model }}</div>
              <div v-if="m.description" class="model-card-desc">{{ m.description }}</div>
            </div>
            <span v-if="currentSelectedModel === m.model" class="agent-selected-badge">
              <NexusIcon name="check" />
            </span>
          </button>
        </div>
        <div v-else-if="!isLoadingModels" class="models-empty-note">
          <span>Modèle par défaut actif ({{ currentSelectedModel || 'automatique' }}).</span>
        </div>
      </div>
    </NexusSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { createSpeechPlayback } from "./utils/speech-playback.mjs";
import { cleanTextForSpeech } from "./utils/speech-text.mjs";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { VoiceRecorder } from "capacitor-voice-recorder";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

interface ConnectedNodeInfo {
  nodeId: string;
  nodeName: string;
  online: boolean;
  state: "idle" | "busy" | "offline";
  lastHeartbeat?: number;
  activeTaskId?: string;
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
  isActive?: boolean;
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
  role: "user" | "assistant";
  backend: "brain" | "codex" | "antigravity";
  text: string;
  timestamp: number;
  fileSummary?: string;
  error?: boolean;
}

interface RemoteTaskItem {
  taskId: string;
  backend: "codex" | "antigravity" | "brain";
  prompt: string;
  projectId?: string;
  nodeId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  stage?: string;
  progressMessage?: string;
  activeTool?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: {
    text?: string;
    fileSummary?: string;
    filesChanged?: string[];
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface PendingApprovalItem {
  approvalId: string;
  taskId: string;
  nodeId: string;
  agentName: string;
  kind: "command" | "fileChange" | "consent";
  details: string;
  expiresAt: number;
  createdAt: number;
  status: "pending" | "accepted" | "declined" | "cancelled" | "timed_out";
  decidedAt?: number;
  decidedBy?: string;
  decision?: "accept" | "decline";
  cancelReason?: string;
}

// Navigation & Tab state
const activeTab = ref<"chat" | "activity" | "dashboard">("chat");
const selectedBackend = ref<"brain" | "codex" | "antigravity">("brain");

// Quick Dropdowns & HUD Modals state
const showQuickMenu = ref<boolean>(false);
const showProjectMenu = ref<boolean>(false);
const showAgentPickerSheet = ref<boolean>(false);

const agentOptions = [
  {
    id: "brain" as const,
    name: "Nexus Brain",
    description: "Orchestration & conversation globale",
  },
  {
    id: "codex" as const,
    name: "Codex",
    description: "Modèle de code rapide & précis",
  },
  {
    id: "antigravity" as const,
    name: "Antigravity",
    description: "Agent autonome multi-outils",
  },
];

function selectedBackendShortLabel(b?: string): string {
  if (b === "brain") return "Brain";
  if (b === "codex") return "Codex";
  if (b === "antigravity") return "AGY";
  return "Agent";
}

// Core Connection state
const coreUrl = ref<string>("");
const coreUrlInput = ref<string>("");
const authToken = ref<string>("");
const authTokenInput = ref<string>("");
const showSettings = ref<boolean>(false);
const isRefreshing = ref<boolean>(false);
const connectionStatus = ref<"connecting" | "connected" | "error">(
  "connecting",
);
const errorMessage = ref<string>("");
const lastUpdated = ref<number | null>(null);
const now = ref<number>(Date.now());
const copied = ref<boolean>(false);
const deferredPrompt = ref<any>(null);

const coreStatus = ref<CoreStatusData | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

// Chat State
const inputPrompt = ref<string>("");
const isSending = ref<boolean>(false);
const currentProgressMessage = ref<string>("");
const currentInFlightTaskId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const messagesScrollRef = ref<HTMLElement | null>(null);
const chatTextareaRef = ref<HTMLTextAreaElement | null>(null);
const settingsError = ref("");

function resizeComposer() {
  const textarea = chatTextareaRef.value;
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
}

// TTS State
const ttsEnabled = ref<boolean>(true);
const autoSpeak = ref(true);
const speechRate = ref(1);
const speechVoice = ref("");
const speechVoices = ref<SpeechSynthesisVoice[]>([]);

function refreshSpeechVoices() {
  speechVoices.value = window.speechSynthesis.getVoices();
}

watch([ttsEnabled, autoSpeak, speechRate, speechVoice], () => {
  if (!ttsEnabled.value) { stopSpeaking(); speechError.value = ""; }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("nexus_tts_enabled", String(ttsEnabled.value));
    localStorage.setItem("nexus_tts_preferences", JSON.stringify({ autoSpeak: autoSpeak.value, rate: speechRate.value, voice: speechVoice.value }));
  } catch { /* Preferences remain usable for this session when storage is unavailable. */ }
});
const isSpeaking = ref<boolean>(false);
const currentSpeakingId = ref<string | null>(null);

const speechError = ref("");
const ttsAvailable = ref(false);
let speechPlayback: ReturnType<typeof createSpeechPlayback> | undefined;

function stopSpeaking() {
  speechPlayback?.stop();
}

function speakMessage(text: string, messageId?: string) {
  speechError.value = "";
  if (!ttsEnabled.value) return;
  if (!ttsAvailable.value || !speechPlayback) {
    speechError.value = "La lecture vocale n’est pas disponible sur cet appareil.";
    return;
  }
  const clean = cleanTextForSpeech(text);
  if (clean) speechPlayback.speak(clean, messageId, { rate: speechRate.value, voiceURI: speechVoice.value });
}

function toggleSpeakMessage(msg: ChatMessage) {
  if (currentSpeakingId.value === msg.id && isSpeaking.value) {
    stopSpeaking();
  } else {
    speakMessage(msg.text, msg.id);
  }
}

function toggleTts() {
  ttsEnabled.value = !ttsEnabled.value;
  if (!ttsEnabled.value) {
    stopSpeaking();
  }
  triggerHaptic("light");
}

// Agent & Models state
interface ModelItem {
  id: string;
  model: string;
  displayName: string;
  description?: string;
}

const agentModels = ref<Record<string, { models: ModelItem[]; selected?: string }>>({
  brain: { models: [], selected: "llama3.2:3b" },
  codex: { models: [], selected: "" },
  antigravity: { models: [], selected: "" },
});
const isLoadingModels = ref<boolean>(false);

const currentBackendModels = computed(() => {
  return agentModels.value[selectedBackend.value]?.models || [];
});

const currentSelectedModel = computed(() => {
  return agentModels.value[selectedBackend.value]?.selected || "";
});

const currentSelectedModelShort = computed(() => {
  const model = currentSelectedModel.value;
  if (!model) return "";
  return model.split(":")[0].replace("gemini-2.5-", "").replace("gemini-", "");
});

async function fetchModelsForBackend(backend: "brain" | "codex" | "antigravity") {
  if (!coreUrl.value) return;
  isLoadingModels.value = true;
  try {
    const res = await fetch(
      `${coreUrl.value.replace(/\/+$/, "")}/api/models?backend=${backend}`,
      { headers: getRequestHeaders() }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models)) {
        agentModels.value[backend] = {
          models: data.models,
          selected:
            data.selected?.model || agentModels.value[backend].selected || data.models[0]?.model,
        };
      }
    }
  } catch (err) {
    console.warn(`[Models] Échec du chargement des modèles (${backend}):`, err);
  } finally {
    isLoadingModels.value = false;
  }
}

async function handleSelectBackend(backend: "brain" | "codex" | "antigravity") {
  selectedBackend.value = backend;
  triggerHaptic("light");
  await fetchModelsForBackend(backend);
}

async function handleSelectModel(modelName: string) {
  if (!coreUrl.value) return;
  const backend = selectedBackend.value;
  try {
    const headers = getRequestHeaders();
    headers["Content-Type"] = "application/json";
    const res = await fetch(`${coreUrl.value.replace(/\/+$/, "")}/api/models/select`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        backend,
        selection: { model: modelName },
      }),
    });
    if (res.ok) {
      agentModels.value[backend].selected = modelName;
      triggerHaptic("medium");
    }
  } catch (err) {
    console.warn(`[Models] Échec de la sélection du modèle :`, err);
  }
}

function openAgentPicker() {
  showAgentPickerSheet.value = true;
  fetchModelsForBackend(selectedBackend.value);
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.isComposing
  ) {
    event.preventDefault();
    void submitMessage();
  }
}


watch(inputPrompt, () => nextTick(resizeComposer));
watch(activeTab, (tab) => {
  localStorage.setItem("nexus_active_tab", tab);
  showQuickMenu.value = false;
  if (tab === "chat") {
    scrollToBottom();
    nextTick(resizeComposer);
  }
});

function syncViewport() {
  document.documentElement.style.setProperty(
    "--app-height",
    `${window.visualViewport?.height || window.innerHeight}px`,
  );
}

// Activity & Tasks State
const tasks = ref<RemoteTaskItem[]>([]);
const isRefreshingTasks = ref<boolean>(false);
const activeTaskFilter = ref<"all" | "running" | "completed" | "failed">("all");

// Approvals State
const approvals = ref<PendingApprovalItem[]>([]);
const isRefreshingApprovals = ref<boolean>(false);
const showApprovalModal = ref<boolean>(false);
const isDecidingApproval = ref<boolean>(false);
const approvalDecidingId = ref<string | null>(null);
const activeApprovalIndex = ref<number>(0);

const pendingApprovals = computed(() => {
  return approvals.value.filter((a) => a.status === "pending");
});

const pendingApprovalsCount = computed(() => {
  const localPending = pendingApprovals.value.length;
  const statusPending = coreStatus.value?.pendingApprovals ?? 0;
  return Math.max(localPending, statusPending);
});

const activeApproval = computed(() => {
  if (pendingApprovals.value.length === 0) return null;
  const idx = Math.min(
    activeApprovalIndex.value,
    pendingApprovals.value.length - 1,
  );
  return pendingApprovals.value[idx] || pendingApprovals.value[0] || null;
});

// Voice / Push-to-Talk State
const isListening = ref<boolean>(false);
const isProcessingAudio = ref<boolean>(false);
const interimTranscript = ref<string>("");
const autoSendVoice = ref<boolean>(true);
const voiceBackendStatus = ref<{
  available: boolean;
  engine?: string;
  language?: string;
} | null>(null);
const isNativeApp = computed(() => Capacitor.isNativePlatform());

let recognitionInstance: any = null;
let mediaRecorderInstance: MediaRecorder | null = null;
let mediaStreamInstance: MediaStream | null = null;
let recordedAudioChunks: Blob[] = [];
let speechRecordingStart = 0;
let isPressingMic = false;
let clickToggleActive = false;
let nativeSpeechActive = false;
let nativeRecorderActive = false;

// Lifecycle
onMounted(async () => {
  ttsAvailable.value = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  if (ttsAvailable.value) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshSpeechVoices);
    speechPlayback = createSpeechPlayback(window.speechSynthesis,
      (text: string) => new SpeechSynthesisUtterance(text), {
        onState: (speaking: boolean, id: string | null) => { isSpeaking.value = speaking; currentSpeakingId.value = id; },
        onError: (message: string) => { speechError.value = message; },
      });
  }
  if (typeof window !== "undefined") {
    syncViewport();
    window.visualViewport?.addEventListener("resize", syncViewport);
    const savedUrl = localStorage.getItem("nexus_core_url");
    const savedToken = localStorage.getItem("nexus_auth_token") || "";
    const savedTab = localStorage.getItem("nexus_active_tab") as
      | "chat"
      | "activity"
      | "dashboard"
      | null;

    if (savedUrl) {
      coreUrl.value = savedUrl;
    } else if (Capacitor.isNativePlatform()) {
      coreUrl.value = "";
      showSettings.value = true;
    } else if (
      window.location.port === "4040" ||
      window.location.pathname.startsWith("/")
    ) {
      coreUrl.value = window.location.origin;
    } else {
      coreUrl.value = "http://127.0.0.1:4040";
    }

    if (Capacitor.isNativePlatform()) {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#06090e" });
      } catch { }
    }

    coreUrlInput.value = coreUrl.value;
    authToken.value = savedToken;
    authTokenInput.value = savedToken;
    if (savedTab && ["chat", "activity", "dashboard"].includes(savedTab))
      activeTab.value = savedTab;

    const savedAutoSend = localStorage.getItem("nexus_auto_send_voice");
    if (savedAutoSend !== null) {
      autoSendVoice.value = savedAutoSend === "true";
    }

    const savedTts = localStorage.getItem("nexus_tts_enabled");
    if (savedTts !== null) {
      ttsEnabled.value = savedTts === "true";
    }

    try {
      const preferences = JSON.parse(localStorage.getItem("nexus_tts_preferences") || "null");
      if (preferences && typeof preferences === "object") {
        if (typeof preferences.autoSpeak === "boolean") autoSpeak.value = preferences.autoSpeak;
        if (typeof preferences.rate === "number" && preferences.rate >= 0.8 && preferences.rate <= 1.3) speechRate.value = preferences.rate;
        if (typeof preferences.voice === "string") speechVoice.value = preferences.voice;
      }
    } catch { /* Ignore malformed saved preferences. */ }

    // Load persisted chat messages
    loadPersistedMessages();

    // Initialize Voice / Speech Recognition
    initSpeechRecognition();

    // Purge legacy ServiceWorker / CacheStorage to avoid stale cached assets
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const r of registrations) {
            r.unregister();
          }
        })
        .catch(() => { });
    }
    if ("caches" in window) {
      caches
        .keys()
        .then((names) => {
          for (const name of names) {
            caches.delete(name);
          }
        })
        .catch(() => { });
    }

    // Listen for PWA install prompt
    window.addEventListener("beforeinstallprompt", (e: Event) => {
      e.preventDefault();
      deferredPrompt.value = e;
    });
  }

  fetchStatus();
  fetchTasks(true);
  fetchApprovals(true);
  fetchVoiceStatus();
  fetchModelsForBackend(selectedBackend.value);

  pollTimer = setInterval(() => {
    fetchStatus(true);
    fetchTasks(true);
    fetchApprovals(true);
  }, 3000);

  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  window.visualViewport?.removeEventListener("resize", syncViewport);
  document.documentElement.style.removeProperty("--app-height");
  if (pollTimer) clearInterval(pollTimer);
  if (clockTimer) clearInterval(clockTimer);
  if (fastApprovalTimer) clearInterval(fastApprovalTimer);
  cancelVoiceRecording();
  stopSpeaking();
  if (ttsAvailable.value) window.speechSynthesis.removeEventListener("voiceschanged", refreshSpeechVoices);
});

let fastApprovalTimer: ReturnType<typeof setInterval> | null = null;

watch(
  pendingApprovalsCount,
  (newCount, oldCount) => {
    if (newCount > (oldCount || 0)) {
      showApprovalModal.value = true;
      activeApprovalIndex.value = 0;
      triggerHaptic("heavy");
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([120, 60, 120]);
      }
    }
  },
  { immediate: true }
);

watch(isSending, (sending) => {
  if (sending) {
    if (!fastApprovalTimer) {
      fastApprovalTimer = setInterval(() => {
        fetchApprovals(true);
      }, 1000);
    }
  } else if (fastApprovalTimer) {
    clearInterval(fastApprovalTimer);
    fastApprovalTimer = null;
  }
});

// Computed properties
const connectionStatusText = computed(() => {
  if (connectionStatus.value === "connected") return "Nexus Core connecté";
  if (connectionStatus.value === "connecting")
    return "Connexion à Nexus Core...";
  return "Déconnecté de Nexus Core";
});

const onlineNodes = computed(() => {
  return connectionStatus.value === "connected"
    ? (coreStatus.value?.nodes || []).filter((n) => n.online)
    : [];
});

const primaryNode = computed(() => {
  return onlineNodes.value[0] || null;
});

const isNodeReady = computed(() => {
  return connectionStatus.value === "connected" && onlineNodes.value.length > 0;
});

const activeProjectName = computed(() => {
  return (
    primaryNode.value?.activeProject?.name ||
    coreStatus.value?.projects?.find((p) => p.isActive)?.name ||
    ""
  );
});

const projectsList = computed(() => {
  return coreStatus.value?.projects || [];
});

const isSwitchingProject = ref(false);
const switchingProjectId = ref<string | null>(null);

async function switchProject(projectId: string) {
  if (!projectId || isSwitchingProject.value || isSending.value) return false;
  isSwitchingProject.value = true;
  switchingProjectId.value = projectId;
  try {
    const res = await fetch(`${coreUrl.value}/api/projects/switch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken.value
          ? { Authorization: `Bearer ${authToken.value}` }
          : {}),
      },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur HTTP ${res.status}`);
    }
    await fetchStatus();
    return connectionStatus.value === "connected";
  } catch (err: any) {
    console.error("Erreur basculement projet:", err);
    errorMessage.value = `Échec du changement de projet : ${err.message}`;
    return false;
  } finally {
    isSwitchingProject.value = false;
    switchingProjectId.value = null;
  }
}

function projectLabel(id: string) {
  return (
    projectsList.value.find(
      (project) => project.id === id || project.path === id,
    )?.name || id
  );
}

async function openProject(project: ProjectInfo) {
  if (
    isProjectActive(project) ||
    (await switchProject(project.id || project.path))
  )
    activeTab.value = "chat";
}

const canSend = computed(() => {
  return (
    inputPrompt.value.trim().length > 0 &&
    !isSending.value &&
    isNodeReady.value &&
    !isSwitchingProject.value &&
    !isListening.value &&
    !isProcessingAudio.value
  );
});

const lastUpdatedText = computed(() => {
  if (!lastUpdated.value) return "";
  const diffSec = Math.floor((now.value - lastUpdated.value) / 1000);
  if (diffSec < 2) return "à l'instant";
  return `il y a ${diffSec}s`;
});

// Tasks Computeds
const runningTasks = computed(() =>
  tasks.value.filter((t) => t.status === "running"),
);
const runningTasksCount = computed(() => {
  return runningTasks.value.length || (coreStatus.value?.activeTasks ?? 0);
});

const filteredTasks = computed(() => {
  if (activeTaskFilter.value === "all") return tasks.value;
  if (activeTaskFilter.value === "running") {
    return tasks.value.filter(
      (t) => t.status === "running" || t.status === "pending",
    );
  }
  if (activeTaskFilter.value === "completed") {
    return tasks.value.filter((t) => t.status === "completed");
  }
  if (activeTaskFilter.value === "failed") {
    return tasks.value.filter(
      (t) => t.status === "failed" || t.status === "cancelled",
    );
  }
  return tasks.value;
});

const taskFilterTabs = computed(() => [
  { key: "all" as const, label: "Tout", count: tasks.value.length },
  {
    key: "running" as const,
    label: "En cours",
    count: tasks.value.filter(
      (t) => t.status === "running" || t.status === "pending",
    ).length,
  },
  {
    key: "completed" as const,
    label: "Terminées",
    count: tasks.value.filter((t) => t.status === "completed").length,
  },
  {
    key: "failed" as const,
    label: "Interrompues",
    count: tasks.value.filter(
      (t) => t.status === "failed" || t.status === "cancelled",
    ).length,
  },
]);



// Helper functions for Approvals
function formatApprovalKind(kind?: string): string {
  if (kind === "command") return "Exécution de commande";
  if (kind === "fileChange") return "Modification de fichier";
  if (kind === "consent") return "Demande d’autorisation";
  return "Opération sécurisée";
}

function getApprovalRemainingSeconds(expiresAt?: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - now.value) / 1000));
}

function isApprovalExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  return now.value >= expiresAt;
}

// Actions & HTTP Calls
function getRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (authToken.value) {
    headers["Authorization"] = `Bearer ${authToken.value}`;
  }
  return headers;
}

async function handleManualRefresh() {
  await Promise.all([
    fetchStatus(false),
    fetchTasks(false),
    fetchApprovals(false),
  ]);
}

async function refreshActivity() {
  await Promise.all([fetchTasks(false), fetchApprovals(false)]);
}

async function fetchStatus(background = false) {
  if (!coreUrl.value) {
    connectionStatus.value = "error";
    return;
  }
  if (!background) isRefreshing.value = true;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/status`;
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: getRequestHeaders(),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    coreStatus.value = data;
    connectionStatus.value = "connected";
    errorMessage.value = "";
    lastUpdated.value = Date.now();
  } catch (err: any) {
    connectionStatus.value = "error";
    errorMessage.value =
      "Connexion impossible. Vérifiez l’adresse du serveur et votre réseau.";
  } finally {
    if (!background) isRefreshing.value = false;
  }
}

async function fetchTasks(background = false) {
  if (!coreUrl.value) return;
  if (!background) isRefreshingTasks.value = true;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/tasks`;
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: getRequestHeaders(),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        tasks.value = data;
      }
    }
  } catch {
    // Non-blocking error in background polling
  } finally {
    if (!background) isRefreshingTasks.value = false;
  }
}

async function cancelTask(taskId: string) {
  if (!taskId) return;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/tasks/${encodeURIComponent(taskId)}/cancel`;
    const headers = getRequestHeaders();
    headers["Content-Type"] = "application/json";

    await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "Annulé depuis l’interface Web mobile" }),
    });

    await fetchTasks(true);
    await fetchStatus(true);
  } catch (err: any) {
    alert(`Impossible d'arrêter la tâche : ${err?.message || err}`);
  }
}

async function fetchApprovals(background = false) {
  if (!coreUrl.value) return;
  if (!background) isRefreshingApprovals.value = true;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/approvals`;
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: getRequestHeaders(),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        approvals.value = data;
        // If index is beyond bounds, reset it
        if (activeApprovalIndex.value >= pendingApprovals.value.length) {
          activeApprovalIndex.value = Math.max(
            0,
            pendingApprovals.value.length - 1,
          );
        }
      }
    }
  } catch {
    // Non-blocking error
  } finally {
    if (!background) isRefreshingApprovals.value = false;
  }
}

async function decideApproval(
  approvalId: string,
  decision: "accept" | "decline",
) {
  if (!approvalId || isDecidingApproval.value) return;

  isDecidingApproval.value = true;
  approvalDecidingId.value = approvalId;

  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/approvals/${encodeURIComponent(approvalId)}/decide`;
    const headers = getRequestHeaders();
    headers["Content-Type"] = "application/json";

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision,
        decidedBy: "mobile-web",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }

    // Update approval status locally
    const found = approvals.value.find((a) => a.approvalId === approvalId);
    if (found) {
      found.status = decision === "accept" ? "accepted" : "declined";
      found.decision = decision;
    }

    // Refresh state from core
    await Promise.all([
      fetchApprovals(true),
      fetchStatus(true),
      fetchTasks(true),
    ]);

    // If no more pending approvals, auto-close modal after brief delay
    if (pendingApprovals.value.length === 0) {
      setTimeout(() => {
        showApprovalModal.value = false;
      }, 400);
    }
  } catch (err: any) {
    alert(`Erreur d’approbation : ${err?.message || err}`);
  } finally {
    isDecidingApproval.value = false;
    approvalDecidingId.value = null;
  }
}

async function submitMessage() {
  stopSpeaking();
  const promptText = inputPrompt.value.trim();
  if (!promptText || isSending.value || isSwitchingProject.value) return;
  if (!isNodeReady.value) {
    errorMessage.value =
      "Votre poste est hors ligne. Reconnectez-le pour envoyer votre message.";
    return;
  }
  inputPrompt.value = "";
  await sendPrompt(promptText);
}

async function sendPrompt(promptText: string) {
  if (!promptText || isSending.value || isSwitchingProject.value) return;
  if (!isNodeReady.value) {
    inputPrompt.value = promptText;
    errorMessage.value =
      "Votre poste est hors ligne. Reconnectez-le pour envoyer votre message.";
    return;
  }

  const backend = selectedBackend.value;
  const generatedTaskId = `task-${Date.now()}`;
  currentInFlightTaskId.value = generatedTaskId;

  const userMsgId = `user-${Date.now()}`;
  const userMsg: ChatMessage = {
    id: userMsgId,
    role: "user",
    backend,
    text: promptText,
    timestamp: Date.now(),
  };

  messages.value.push(userMsg);
  saveMessages();
  scrollToBottom();

  isSending.value = true;
  currentProgressMessage.value = `Envoi au ${selectedBackendLabel(selectedBackend.value)}...`;

  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/tasks`;
    const headers = getRequestHeaders();
    headers["Content-Type"] = "application/json";

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        taskId: generatedTaskId,
        backend,
        prompt: promptText,
        projectId:
          primaryNode.value?.activeProject?.id || activeProjectName.value,
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
      role: "assistant",
      backend,
      text: data.text || "Tâche terminée sans sortie textuelle.",
      timestamp: Date.now(),
      fileSummary: data.fileSummary,
    };

    messages.value.push(assistantMsg);
    saveMessages();
    if (ttsEnabled.value && autoSpeak.value && ttsAvailable.value && !assistantMsg.error) {
      speakMessage(assistantMsg.text, assistantMsg.id);
    }
  } catch (err: any) {
    const errorMsg: ChatMessage = {
      id: `err-${Date.now()}`,
      role: "assistant",
      backend,
      text: `Erreur : ${err?.message || "Échec de la tâche"}`,
      timestamp: Date.now(),
      error: true,
    };
    messages.value.push(errorMsg);
    saveMessages();
  } finally {
    isSending.value = false;
    currentInFlightTaskId.value = null;
    currentProgressMessage.value = "";
    scrollToBottom();
    // Refresh tasks and status
    fetchTasks(true);
    fetchStatus(true);
  }
}

function clearChat() {
  if (confirm("Voulez-vous effacer l’historique de conversation ?")) {
    messages.value = [];
    if (typeof window !== "undefined") {
      localStorage.removeItem("nexus_brain_messages");
    }
  }
}

function loadPersistedMessages() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("nexus_brain_messages");
    if (raw) {
      messages.value = JSON.parse(raw);
      scrollToBottom();
    }
  } catch {
    messages.value = [];
  }
}

function saveMessages() {
  if (typeof window === "undefined") return;
  try {
    // Keep last 50 messages to preserve memory
    const trimmed = messages.value.slice(-50);
    localStorage.setItem("nexus_brain_messages", JSON.stringify(trimmed));
  } catch { }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesScrollRef.value) {
      messagesScrollRef.value.scrollTop = messagesScrollRef.value.scrollHeight;
    }
  });
}

function selectedBackendLabel(b?: string): string {
  if (b === "brain") return "Nexus Brain";
  if (b === "codex") return "Codex";
  if (b === "antigravity") return "Antigravity";
  return "Agent";
}

function renderMarkdown(raw: string): string {
  if (!raw) return "";
  let html = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```lang ... ```
  html = html.replace(
    /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    },
  );

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italics: *text*
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Line breaks
  html = html.replace(/\n/g, "<br>");

  return html;
}

function initSpeechRecognition() {
  if (typeof window === "undefined") return;
  const SpeechRecognitionClass =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (SpeechRecognitionClass) {
    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "fr-FR";

      recognition.onresult = (event: any) => {
        let finalChunk = "";
        let interimChunk = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalChunk += event.results[i][0].transcript;
          } else {
            interimChunk += event.results[i][0].transcript;
          }
        }
        if (interimChunk) {
          interimTranscript.value = interimChunk;
        }
        if (finalChunk) {
          const trimmed = finalChunk.trim();
          if (trimmed) {
            if (inputPrompt.value) {
              inputPrompt.value += " " + trimmed;
            } else {
              inputPrompt.value = trimmed;
            }
          }
          interimTranscript.value = "";
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("SpeechRecognition error:", event.error);
        if (event.error !== "no-speech") {
          interimTranscript.value = "";
        }
      };

      recognition.onend = () => {
        if (isListening.value && !clickToggleActive) {
          isListening.value = false;
        }
      };

      recognitionInstance = recognition;
    } catch (e) {
      console.warn("Failed to initialize SpeechRecognition:", e);
    }
  }
}

async function fetchVoiceStatus() {
  if (!coreUrl.value) return;
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/voice/status`;
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: getRequestHeaders(),
    });
    if (res.ok) {
      voiceBackendStatus.value = await res.json();
    }
  } catch {
    // Non-blocking
  }
}

async function triggerHaptic(type: "press" | "release" | "cancel" | "success") {
  if (Capacitor.isNativePlatform()) {
    try {
      if (type === "press") {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } else if (type === "release") {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else if (type === "success") {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (type === "cancel") {
        await Haptics.notification({ type: NotificationType.Warning });
      }
      return;
    } catch { }
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      if (type === "press") navigator.vibrate(40);
      else if (type === "release") navigator.vibrate([20, 30, 20]);
    } catch { }
  }
}

function appendTranscript(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (inputPrompt.value) {
    inputPrompt.value = `${inputPrompt.value} ${trimmed}`;
  } else {
    inputPrompt.value = trimmed;
  }
  interimTranscript.value = "";
}

async function runNativeSpeechPopup() {
  try {
    const avail = await SpeechRecognition.available();
    if (!avail.available) {
      console.warn("SpeechRecognition unavailable");
      errorMessage.value =
        "Reconnaissance vocale non disponible sur cet appareil.";
      return;
    }
    const perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== "granted") {
      const req = await SpeechRecognition.requestPermissions();
      if (req.speechRecognition !== "granted") {
        errorMessage.value =
          "Autorisation du micro requise pour la commande vocale.";
        return;
      }
    }
    await triggerHaptic("press");
    isListening.value = true;
    errorMessage.value = "";
    const result = await SpeechRecognition.start({
      language: "fr-FR",
      maxResults: 3,
      prompt: "Dicter un message",
      popup: true,
      partialResults: false,
    });
    await triggerHaptic("success");
    if (result?.matches && result.matches.length > 0) {
      const text = result.matches[0]?.trim() || "";
      if (text) {
        appendTranscript(text);
        if (autoSendVoice.value && isNodeReady.value) {
          setTimeout(() => {
            submitMessage();
          }, 300);
        }
      }
    }
  } catch (err: any) {
    console.warn("SpeechRecognition popup error:", err);
    await triggerHaptic("cancel");
  } finally {
    isListening.value = false;
    isPressingMic = false;
  }
}

async function handleMicClick() {
  if (isSending.value) return;

  if (Capacitor.isNativePlatform()) {
    if (isListening.value) {
      try {
        await SpeechRecognition.stop();
        await SpeechRecognition.removeAllListeners();
      } catch { }
      isListening.value = false;
      return;
    }
    await runNativeSpeechPopup();
    return;
  }

  // Web Browser fallback
  if (isListening.value) {
    clickToggleActive = false;
    await stopPushToTalk();
  } else {
    clickToggleActive = true;
    await startPushToTalk();
  }
}

async function onMicPointerDown(e: PointerEvent) {
  if (Capacitor.isNativePlatform()) return;
  if (isSending.value) return;
  const target = e.currentTarget as HTMLElement;
  if (target && target.setPointerCapture) {
    try {
      target.setPointerCapture(e.pointerId);
    } catch { }
  }

  if (isListening.value) {
    clickToggleActive = false;
    await stopPushToTalk();
    return;
  }

  speechRecordingStart = Date.now();
  isPressingMic = true;
  await startPushToTalk();
}

async function onMicPointerUp(e: PointerEvent) {
  if (Capacitor.isNativePlatform()) return;
  const target = e.currentTarget as HTMLElement;
  if (target && target.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId);
    } catch { }
  }

  if (!isPressingMic && !isListening.value) return;

  const pressDuration = Date.now() - speechRecordingStart;
  isPressingMic = false;

  if (pressDuration < 280) {
    clickToggleActive = true;
    return;
  }

  clickToggleActive = false;
  await stopPushToTalk();
}

async function onMicPointerCancel(e: PointerEvent) {
  const target = e.currentTarget as HTMLElement;
  if (target && target.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId);
    } catch { }
  }
  await cancelVoiceRecording();
}

async function startPushToTalk() {
  if (!isNodeReady.value || isSending.value) return;

  speechRecordingStart = Date.now();
  interimTranscript.value = "";
  isListening.value = true;
  await triggerHaptic("press");

  if (Capacitor.isNativePlatform()) {
    // 1. Tenter la reconnaissance vocale native on-device
    let speechAvailable = false;
    try {
      const avail = await SpeechRecognition.available();
      if (avail.available) {
        const perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== "granted") {
          const req = await SpeechRecognition.requestPermissions();
          speechAvailable = req.speechRecognition === "granted";
        } else {
          speechAvailable = true;
        }
      }
    } catch (e) {
      console.warn("SpeechRecognition check failed:", e);
    }

    if (speechAvailable) {
      try {
        nativeSpeechActive = true;
        await SpeechRecognition.removeAllListeners();
        await SpeechRecognition.addListener(
          "partialResults",
          (data: { matches: string[] }) => {
            if (data.matches && data.matches.length > 0) {
              interimTranscript.value = data.matches[0] || "";
            }
          },
        );
        await SpeechRecognition.start({
          language: "fr-FR",
          maxResults: 3,
          partialResults: true,
          popup: false,
        });
        return;
      } catch (err) {
        console.warn(
          "SpeechRecognition.start failed, will use popup on tap or recorder:",
          err,
        );
        nativeSpeechActive = false;
      }
    }

    // 2. Fallback vers enregistreur audio natif
    try {
      const perm = await VoiceRecorder.hasAudioRecordingPermission();
      if (!perm.value) {
        const req = await VoiceRecorder.requestAudioRecordingPermission();
        if (!req.value) {
          isListening.value = false;
          return;
        }
      }
      nativeRecorderActive = true;
      await VoiceRecorder.startRecording();
      return;
    } catch (err) {
      console.warn("VoiceRecorder.startRecording failed:", err);
      nativeRecorderActive = false;
      isListening.value = false;
      return;
    }
  }

  // Navigateur Web classique
  if (recognitionInstance) {
    try {
      recognitionInstance.start();
      return;
    } catch {
      // Fallback MediaRecorder
    }
  }

  if (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof MediaRecorder !== "undefined"
  ) {
    try {
      recordedAudioChunks = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamInstance = stream;
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedAudioChunks.push(e.data);
        }
      };
      recorder.start(100);
      mediaRecorderInstance = recorder;
    } catch (err: any) {
      console.warn("MediaRecorder error:", err);
      isListening.value = false;
      isPressingMic = false;
    }
  }
}

async function stopPushToTalk() {
  if (!isListening.value && !isPressingMic) return;

  const durationMs = Date.now() - speechRecordingStart;
  isPressingMic = false;
  isListening.value = false;
  await triggerHaptic("release");

  if (Capacitor.isNativePlatform()) {
    if (nativeSpeechActive) {
      try {
        await SpeechRecognition.stop();
        await SpeechRecognition.removeAllListeners();
        const text = interimTranscript.value.trim();
        if (text) {
          appendTranscript(text);
        } else if (durationMs < 600) {
          // Si rien n'a été capté pendant un court maintien, ouvrir la popup de reconnaissance vocale Google
          await runNativeSpeechPopup();
          return;
        }
      } catch (err) {
        console.warn("SpeechRecognition.stop failed:", err);
        if (interimTranscript.value.trim()) {
          appendTranscript(interimTranscript.value.trim());
        }
      } finally {
        nativeSpeechActive = false;
      }
    }

    if (nativeRecorderActive) {
      isProcessingAudio.value = true;
      try {
        const result = await VoiceRecorder.stopRecording();
        if (result.value?.recordDataBase64 && durationMs > 300) {
          await transcribeNativeAudio(
            result.value.recordDataBase64,
            result.value.mimeType || "audio/aac",
          );
        }
      } catch (err) {
        console.warn("VoiceRecorder.stopRecording failed:", err);
      } finally {
        nativeRecorderActive = false;
        isProcessingAudio.value = false;
      }
    }

    if (
      autoSendVoice.value &&
      inputPrompt.value.trim().length > 0 &&
      durationMs > 400
    ) {
      setTimeout(() => {
        submitMessage();
      }, 250);
    }
    return;
  }

  // Web Browser fallback
  if (recognitionInstance) {
    try {
      recognitionInstance.stop();
    } catch { }
  }

  if (mediaRecorderInstance && mediaRecorderInstance.state !== "inactive") {
    isProcessingAudio.value = true;
    try {
      const audioBlob = await new Promise<Blob>((resolve) => {
        mediaRecorderInstance!.onstop = () => {
          const blob = new Blob(recordedAudioChunks, {
            type: mediaRecorderInstance!.mimeType || "audio/webm",
          });
          resolve(blob);
        };
        mediaRecorderInstance!.stop();
      });

      if (mediaStreamInstance) {
        for (const track of mediaStreamInstance.getTracks()) {
          track.stop();
        }
        mediaStreamInstance = null;
      }
      mediaRecorderInstance = null;

      if (audioBlob.size > 1000) {
        await transcribeAudioBlob(audioBlob);
      }
    } catch (err: any) {
      console.warn("Error processing audio recording:", err);
    } finally {
      isProcessingAudio.value = false;
    }
  }

  if (
    autoSendVoice.value &&
    inputPrompt.value.trim().length > 0 &&
    durationMs > 400
  ) {
    setTimeout(() => {
      submitMessage();
    }, 250);
  }
}

async function transcribeNativeAudio(base64: string, mimeType: string) {
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/voice/transcribe`;
    const headers = {
      ...getRequestHeaders(),
      "Content-Type": "application/json",
    };
    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        audioBase64: base64,
        mimeType: mimeType || "audio/aac",
        language: "fr",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.text) {
        appendTranscript(data.text);
      }
    }
  } catch (err) {
    console.warn("Native audio backend transcription failed:", err);
  }
}

async function transcribeAudioBlob(blob: Blob) {
  try {
    const targetUrl = `${coreUrl.value.replace(/\/+$/, "")}/api/voice/transcribe`;
    const headers = getRequestHeaders();
    headers["Content-Type"] = blob.type || "audio/webm";

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: blob,
    });

    if (res.ok) {
      const data = await res.json();
      if (data.text) {
        appendTranscript(data.text);
      }
    }
  } catch (err) {
    console.warn("Backend transcription failed:", err);
  }
}

async function cancelVoiceRecording() {
  isListening.value = false;
  isPressingMic = false;
  clickToggleActive = false;
  interimTranscript.value = "";
  await triggerHaptic("cancel");

  if (Capacitor.isNativePlatform()) {
    if (nativeSpeechActive) {
      try {
        await SpeechRecognition.stop();
        await SpeechRecognition.removeAllListeners();
      } catch { }
      nativeSpeechActive = false;
    }
    if (nativeRecorderActive) {
      try {
        await VoiceRecorder.stopRecording();
      } catch { }
      nativeRecorderActive = false;
    }
    return;
  }

  if (recognitionInstance) {
    try {
      recognitionInstance.abort();
    } catch { }
  }
  if (mediaRecorderInstance && mediaRecorderInstance.state !== "inactive") {
    try {
      mediaRecorderInstance.stop();
    } catch { }
  }
  if (mediaStreamInstance) {
    for (const track of mediaStreamInstance.getTracks()) {
      track.stop();
    }
    mediaStreamInstance = null;
  }
  mediaRecorderInstance = null;
}

function saveSettings() {
  settingsError.value = "";
  if (!coreUrlInput.value.trim()) {
    settingsError.value = "Renseignez l’adresse de votre serveur.";
    return;
  }
  let cleaned = coreUrlInput.value.trim();
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = `http://${cleaned}`;
  }
  try {
    const url = new URL(cleaned);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    cleaned = url.origin;
  } catch {
    settingsError.value =
      "Saisissez une adresse HTTP ou HTTPS, avec son port si nécessaire.";
    return;
  }
  coreStatus.value = null;
  tasks.value = [];
  approvals.value = [];
  connectionStatus.value = "connecting";
  coreUrl.value = cleaned;
  authToken.value = authTokenInput.value.trim();

  if (typeof window !== "undefined") {
    localStorage.setItem("nexus_core_url", coreUrl.value);
    localStorage.setItem("nexus_auth_token", authToken.value);
    localStorage.setItem(
      "nexus_auto_send_voice",
      autoSendVoice.value ? "true" : "false",
    );
  }

  showSettings.value = false;
  handleManualRefresh();
  fetchVoiceStatus();
}

function resetSettings() {
  if (typeof window !== "undefined") {
    coreUrlInput.value = isNativeApp.value ? "" : window.location.origin;
    authTokenInput.value = "";
    autoSendVoice.value = true;
    settingsError.value = "";
  }
}

function isProjectActive(project: ProjectInfo): boolean {
  if (project.isActive) return true;
  return onlineNodes.value.some(
    (n) =>
      n.activeProject?.name === project.name ||
      n.activeProject?.path === project.path ||
      (project.id && n.activeProject?.id === project.id),
  );
}

function formatState(state: string): string {
  if (state === "idle") return "Disponible";
  if (state === "busy") return "En cours";
  return state;
}

function formatTaskStatus(status: string): string {
  if (status === "running") return "En cours";
  if (status === "pending") return "En attente";
  if (status === "completed") return "Terminé";
  if (status === "failed") return "Échoué";
  if (status === "cancelled") return "Annulé";
  return status;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "inconnu";
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
  } catch { }
}

async function installPwa() {
  if (!deferredPrompt.value) return;
  deferredPrompt.value.prompt();
  const choice = await deferredPrompt.value.userChoice;
  if (choice.outcome === "accepted") {
    deferredPrompt.value = null;
  }
}
</script>
