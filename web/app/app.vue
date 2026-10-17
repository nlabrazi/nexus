<template>
  <div class="nexus-app" :class="currentView === 'workspace' ? `theme-${workspaceMode}` : 'theme-home'">
    <!-- Streamlined Cyber HUD Header -->
    <header class="app-header cyber-header">
      <div class="header-left">
        <button v-if="currentView === 'workspace'" type="button" class="cyber-back-btn" @click="leaveMode" aria-label="Retour à l'accueil">
          <NexusIcon name="chevron" class="reversed" />
          <span>Accueil</span>
        </button>
        <a v-else class="wordmark" href="#" aria-label="Nexus" @click.prevent="currentView = 'home'">
          <span class="brand-mark cyber-glow-box">
            <NexusIcon name="nexus" />
          </span>
          <span class="brand-copy">NEXUS<span class="brand-subtitle cyber-terminal-tag">// SYS_READY</span></span>
        </a>
      </div>

      <div class="header-right">
        <div class="status-beacon cyber-beacon" :class="[runtimeStatus.toLowerCase(), { 'is-online': isNodeReady }]"
          role="status" aria-live="polite" :aria-label="`Statut : ${runtimeStatusText}`">
          <span class="beacon-dot" />
          <span class="beacon-label">
            {{ connectionStatus === 'connecting' ? 'Connexion…' : isNodeReady ? 'Connecté' : 'Hors ligne' }}
          </span>
        </div>
        <button type="button" class="header-menu-btn" aria-label="Options et paramètres" :aria-expanded="showQuickMenu"
          @click="showQuickMenu = !showQuickMenu">
          <NexusIcon name="dots" />
        </button>
      </div>
    </header>

    <!-- Quick Overflow Menu Dropdown -->
    <div v-if="showQuickMenu" class="menu-backdrop" @click="showQuickMenu = false" />
    <div v-if="showQuickMenu" class="quick-menu" aria-label="Options et paramètres">
      <button type="button" class="menu-item" @click="showQuickMenu = false; openAgentPicker()">
        <NexusIcon :name="workspaceMode === 'brain' ? 'sparkles' : 'cpu'" />
        <span>Agent & modèle ({{ selectedBackendShortLabel(selectedBackend) }})</span>
      </button>

      <button type="button" class="menu-item" @click="showQuickMenu = false; showProjectMenu = true">
        <NexusIcon name="folder" />
        <span>Changer de projet{{ activeProjectName ? ` (${activeProjectName})` : '' }}</span>
      </button>

      <button type="button" class="menu-item" @click="toggleTts(); showQuickMenu = false">
        <NexusIcon :name="ttsEnabled ? 'speaker' : 'speakerOff'" />
        <span>{{ ttsEnabled ? 'Voix activée' : 'Voix désactivée' }}</span>
      </button>

      <button v-if="messages.length" type="button" class="menu-item danger" @click="showQuickMenu = false; clearChat()">
        <NexusIcon name="trash" />
        <span>Effacer la discussion</span>
      </button>

      <div class="menu-divider" />

      <button type="button" class="menu-item" @click="showQuickMenu = false; showSettings = true">
        <NexusIcon name="settings" />
        <span>Paramètres & configuration</span>
      </button>
    </div>

    <!-- MAIN SCREEN CONTAINER WITH DIRECTIONAL VIEW TRANSITION -->
    <div class="screen-container">
      <Transition :name="slideDirection === 'forward' ? 'screen-slide-forward' : 'screen-slide-backward'" mode="out-in">
        <!-- 1. HOME SCREEN (Ultra-sleek Cyberpunk HUD) -->
        <main v-if="currentView === 'home'" key="home" ref="homeScrollRef" class="home-screen"
          :class="{ 'has-scroll-top': canScrollHomeUp, 'has-scroll-bottom': canScrollHomeDown }"
          aria-label="Accueil Nexus" @scroll.passive="updateHomeScrollState">
          <div class="home-hero">
            <div class="cyber-scan-tag">
              <span class="scan-dot" :class="{ online: isNodeReady }" />
              <span>{{ isNodeReady ? 'SYSTÈME OPÉRATIONNEL' : 'POSTE HORS LIGNE' }}</span>
            </div>
            <h1 class="home-title">
              Que voulez-vous <span class="neon-text">faire ?</span>
            </h1>
            <p class="home-subtitle">
              Sélectionnez votre mode de travail autonome.
            </p>
          </div>

          <div class="home-cards-container">
            <!-- Card A: CODE -->
            <button type="button" class="cyber-choice-card code-card" @click="enterMode('code')">
              <div class="choice-card-edge" />
              <div class="choice-card-header">
                <span class="choice-card-badge">[ A ]</span>
                <span class="choice-card-type">DEVELOPMENT</span>
              </div>
              <div class="choice-card-icon">
                <NexusIcon name="code" />
              </div>
              <h2 class="choice-card-title">CODE</h2>
              <p class="choice-card-desc">
                Implémenter, refactoriser, tester et exécuter des tâches directement dans vos fichiers.
              </p>
              <div class="choice-card-footer">
                <span class="choice-card-meta">
                  <NexusIcon name="zap" />
                  <span>{{ selectedBackendShortLabel(lastCodingBackend) }}</span>
                </span>
                <span class="choice-card-cta">
                  Lancer
                  <NexusIcon name="chevron" />
                </span>
              </div>
            </button>

            <!-- Card B: BRAINSTORM -->
            <button type="button" class="cyber-choice-card brain-card" @click="enterMode('brain')">
              <div class="choice-card-edge" />
              <div class="choice-card-header">
                <span class="choice-card-badge">[ B ]</span>
                <span class="choice-card-type">IDEATION & ARCHITECTURE</span>
              </div>
              <div class="choice-card-icon">
                <NexusIcon name="sparkles" />
              </div>
              <h2 class="choice-card-title">BRAINSTORM</h2>
              <p class="choice-card-desc">
                Cadrer un besoin, explorer des solutions d'architecture et élaborer un plan d'action.
              </p>
              <div class="choice-card-footer">
                <span class="choice-card-meta">
                  <NexusIcon name="sparkles" />
                  <span>Nexus Brain</span>
                </span>
                <span class="choice-card-cta">
                  Lancer
                  <NexusIcon name="chevron" />
                </span>
              </div>
            </button>
          </div>

          <!-- Session Resume Banner (if messages exist) -->
          <div v-if="messages.length" class="home-resume-container">
            <button type="button" class="home-resume-pill" @click="enterMode(workspaceMode)">
              <NexusIcon name="chat" />
              <span>Reprendre la discussion ({{ messages.length }} message{{ messages.length > 1 ? 's' : '' }})</span>
              <NexusIcon name="chevron" />
            </button>
          </div>

          <div class="scroll-affordance-hint home-scroll-hint" :class="{ visible: canScrollHomeDown }" aria-hidden="true">
            <span class="scroll-affordance-pill">
              <span>Défiler</span>
              <NexusIcon name="chevron" class="scroll-chevron-down" />
            </span>
          </div>
        </main>

        <!-- 2. WORKSPACE SCREEN (Chat + Inline STT Mic) -->
        <main v-else key="workspace" class="workspace-screen" aria-label="Espace de travail">
          <div ref="messagesScrollRef" class="messages-stream"
            :class="{ 'has-scroll-top': canScrollMessagesUp, 'has-scroll-bottom': canScrollMessagesDown }"
            role="log" aria-label="Messages" aria-live="polite"
            aria-relevant="additions text" @scroll.passive="updateMessagesScrollState">
            <!-- Welcome HUD if no messages -->
            <div v-if="!messages.length" class="welcome-hud">
              <p class="eyebrow">{{ workspaceMode === 'code' ? 'AGENT DE CODE' : 'NEXUS BRAIN' }}</p>
              <h1 class="welcome-title">
                {{ workspaceMode === 'code' ? 'Prêt à coder.' : 'Prêt à brainstormer.' }}<br />
                <span>{{ workspaceMode === 'code' ? 'Donnez une consigne.' : 'Posez votre idée.' }}</span>
              </h1>
              <p class="welcome-description">{{ isNodeReady
                ? (workspaceMode === 'code'
                    ? "Dictez ou écrivez votre demande technique. L'agent analyse le projet et exécute."
                    : "Échangez librement pour cadrer l'architecture, puis transmettez au code d'un clic.")
                : "Votre poste de travail est hors ligne. Connectez votre machine pour exécuter les tâches." }}</p>
              <button v-if="!isNodeReady && connectionStatus !== 'connecting'" type="button"
                class="text-button connect-link" @click="openConnectionSettings">
                <NexusIcon name="computer" /><span>Connecter mon poste</span><NexusIcon name="chevron" />
              </button>
            </div>

            <!-- Chat Messages -->
            <TransitionGroup name="message-arrival" tag="div" class="message-list">
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
                <div v-if="msg.role === 'assistant' && msg.backend === 'brain' && !msg.error" class="handoff-bar" style="margin-top: 10px; display: flex; gap: 8px;">
                  <button type="button" class="chip-button" style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; padding: 6px 12px; border-radius: 8px; background: rgba(0, 240, 255, 0.12); color: #00f0ff; border: 1px solid rgba(0, 240, 255, 0.3); cursor: pointer;" @click="handoffToCodingAgent(msg.text)">
                    <NexusIcon name="cpu" />
                    <span>Transmettre au code</span>
                  </button>
                </div>
              </article>
            </TransitionGroup>

            <!-- In-flight Task Progress -->
            <div v-if="isSending" class="task-progress" role="status">
              <span class="activity-wave" aria-hidden="true"><i /><i /><i /></span><span>{{
                currentProgressMessage || "En cours…"
              }}</span><span v-if="inFlightStartedAt" class="elapsed-time">{{ Math.max(0, Math.floor((now - inFlightStartedAt) / 1000)) }} s</span>
              <button v-if="currentInFlightTaskId" type="button" class="text-button danger"
                @click="cancelTask(currentInFlightTaskId)">
                <NexusIcon name="stop" />Arrêter
              </button>
            </div>
          </div>

          <div class="scroll-affordance-hint workspace-scroll-hint" :class="{ visible: canScrollMessagesDown }" aria-hidden="true">
            <span class="scroll-affordance-pill">
              <span>Défiler vers le bas</span>
              <NexusIcon name="chevron" class="scroll-chevron-down" />
            </span>
          </div>

          <!-- Centered STT Mic & Composer Dock -->
          <div class="cyber-composer-dock">
            <!-- Pending Approvals Banner -->
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
            <div v-if="isListening || isProcessingAudio" class="cyber-voice-banner" role="status">
              <div class="cyber-voice-wave">
                <span class="wave-bar" /><span class="wave-bar" /><span class="wave-bar" /><span class="wave-bar" />
              </div>
              <span class="cyber-voice-text">
                {{ interimTranscript || (isProcessingAudio ? "Transcription en cours…" : "À l'écoute… Touchez le micro pour terminer.") }}
              </span>
              <button type="button" class="cyber-voice-cancel" aria-label="Annuler la dictée" @click="cancelVoiceRecording">
                <NexusIcon name="close" />
              </button>
            </div>

            <!-- Quick Slash Commands Bar -->
            <div class="cyber-slash-bar" aria-label="Commandes rapides">
              <button type="button" class="slash-chip" :disabled="isSending || !isNodeReady" @click="sendQuickCommand('/new')">/new</button>
              <button type="button" class="slash-chip" :disabled="isSending || !isNodeReady" @click="sendQuickCommand('/status')">/status</button>
              <button type="button" class="slash-chip" :disabled="isSending || !isNodeReady" @click="sendQuickCommand('/usage')">/usage</button>
              <button type="button" class="slash-chip" :disabled="isSending || !isNodeReady" @click="openPersonaSettings">/persona</button>
            </div>

            <!-- Sleek Cyber Input Form -->
            <form class="cyber-composer-form" @submit.prevent="submitMessage">
              <div class="composer-input-row" :class="`mode-${workspaceMode}`">
                <button type="button" class="composer-mode-tag" :class="workspaceMode"
                  :aria-label="`Mode actuel: ${workspaceMode}. Cliquer pour changer.`"
                  @click="toggleWorkspaceMode">
                  <NexusIcon :name="workspaceMode === 'brain' ? 'sparkles' : 'code'" />
                  <span>{{ workspaceMode === 'code' ? 'CODE' : 'BRAIN' }}</span>
                </button>

                <label for="message" class="sr-only">Votre message</label>
                <textarea id="message" ref="chatTextareaRef" v-model="inputPrompt" rows="1"
                  :placeholder="isNodeReady
                    ? (workspaceMode === 'code' ? 'Consigne de code, /new, /usage…' : 'Idée, architecture, /new…')
                    : 'Écrivez un brouillon…'"
                  :disabled="isSending"
                  @keydown="handleComposerKeydown"
                  @input="resizeComposer" />

                <div class="composer-right-actions">
                  <button type="button" class="cyber-inline-mic-btn"
                    :class="{
                      listening: isListening,
                      processing: isProcessingAudio,
                      'mode-brain': workspaceMode === 'brain'
                    }"
                    :disabled="isSending || isProcessingAudio"
                    :aria-pressed="isListening"
                    :aria-label="isListening ? 'Terminer la dictée' : 'Parler à Nexus'"
                    :title="isListening ? 'Terminer la dictée' : 'Toucher pour parler'"
                    @click="handleMicClick">
                    <NexusIcon :name="isListening ? 'stop' : 'mic'" />
                  </button>

                  <button type="submit" class="cyber-send-btn" :class="`mode-${workspaceMode}`" :disabled="!canSend" aria-label="Envoyer le message">
                    <NexusIcon name="arrow" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </main>
      </Transition>
    </div>


    <!-- ALL-IN-ONE SETTINGS SHEET -->
    <NexusSheet v-model="showSettings" title="Paramètres & Configuration">
      <div class="cyber-settings-container">
        <!-- Cyber Tabs Bar -->
        <div class="cyber-settings-nav" role="tablist" aria-label="Sections des paramètres">
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'connection' }"
            @click="settingsSection = 'connection'">
            <NexusIcon name="computer" />
            <span>Connexion</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'agent' }"
            @click="settingsSection = 'agent'">
            <NexusIcon name="cpu" />
            <span>Agent & Modèle</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'persona' }"
            @click="settingsSection = 'persona'">
            <NexusIcon name="sparkles" />
            <span>Persona & Mémoire</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'voice' }"
            @click="settingsSection = 'voice'">
            <NexusIcon name="speaker" />
            <span>Voix & STT</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'notifications' }"
            @click="settingsSection = 'notifications'">
            <NexusIcon name="shield" />
            <span>Notifications</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'projects' }"
            @click="settingsSection = 'projects'">
            <NexusIcon name="folder" />
            <span>Projets</span>
          </button>
          <button type="button" class="settings-nav-tab" :class="{ active: settingsSection === 'quotas' }"
            @click="settingsSection = 'quotas'">
            <NexusIcon name="activity" />
            <span>Quotas & Tâches</span>
          </button>
        </div>

        <!-- 1. Connexion -->
        <div v-show="settingsSection === 'connection'" class="settings-section-body">
          <form class="settings-form" @submit.prevent="saveSettings">
            <p>Reliez Nexus à votre poste de travail ou daemon local.</p>
            <div class="field">
              <label for="core-url">Adresse du serveur</label>
              <input id="core-url" v-model="coreUrlInput" type="text"
                inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" required
                aria-describedby="server-help" />
              <small id="server-help">{{
                isNativeApp
                  ? "L'adresse de votre ordinateur sur le réseau (ex: http://192.168.1.XX:4040)."
                  : "L'adresse et le port de votre serveur Nexus (ex: http://localhost:4040)."
              }}</small>
            </div>
            <div class="field">
              <label for="core-token">Jeton d'accès (Bearer Token)</label>
              <input id="core-token" v-model="authTokenInput" type="password" autocomplete="current-password" spellcheck="false" />
            </div>
            <p v-if="settingsError" class="inline-error" role="alert">{{ settingsError }}</p>
            <button type="submit" class="button primary full-width">
              Enregistrer et connecter
              <NexusIcon name="chevron" />
            </button>
            <div class="settings-details-box" style="margin-top: 14px; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--line-dim);">
              <p style="font-size: 12px; color: var(--muted-light);"><strong>État :</strong> {{ connectionStatusText }}</p>
              <p v-if="lastUpdated" style="font-size: 11px; color: var(--muted); margin-top: 4px;">Dernier contact : {{ lastUpdatedText }}</p>
              <button type="button" class="text-button" style="margin-top: 10px; font-size: 11px;" @click="resetSettings">
                Rétablir l'adresse par défaut
              </button>
            </div>
          </form>
        </div>

        <!-- 2. Agent & Modèle -->
        <div v-show="settingsSection === 'agent'" class="settings-section-body">
          <div class="sheet-section-title">AGENT DE CODE ACTIF</div>
          <div class="agent-sheet-list">
            <button v-for="agent in agentOptions" :key="agent.id" type="button" class="agent-card-row"
              :class="{ selected: selectedBackend === agent.id }" @click="handleSelectBackend(agent.id)">
              <div class="agent-card-icon">
                <NexusIcon :name="agent.id === 'brain' ? 'sparkles' : agent.id === 'codex' ? 'zap' : agent.id === 'claude' ? 'cpu' : 'branch'" />
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

          <div class="sheet-section-title model-section-title" style="margin-top: 14px;">
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

          <div v-if="currentModelEfforts.length > 1" style="margin-top: 14px;">
            <div class="sheet-section-title">EFFORT DE RAISONNEMENT</div>
            <div class="effort-pills-row">
              <button v-for="eff in currentModelEfforts" :key="eff.reasoningEffort" type="button"
                class="effort-pill-btn" :class="{ active: currentSelectedEffort === eff.reasoningEffort }"
                @click="handleSelectModel(currentSelectedModel, eff.reasoningEffort)">
                <strong>{{ eff.reasoningEffort.toUpperCase() }}</strong>
                <small v-if="eff.description"> {{ eff.description }}</small>
              </button>
            </div>
          </div>
        </div>

        <!-- 2b. Persona & Mémoire (Upstash) -->
        <div v-show="settingsSection === 'persona'" class="settings-section-body">
          <div class="sheet-section-title">PERSONA & INSTRUCTIONS GLOBALES (UPSTASH)</div>
          <p style="font-size: 12px; color: var(--muted-light); margin-bottom: 8px;">
            Ces instructions sont stockées dans <strong>Upstash Redis</strong> et injectées automatiquement dans tous vos agents (Brain, Codex, Antigravity, Claude Code).
          </p>
          <div class="field">
            <textarea v-model="personaInput" rows="7" class="cyber-code-textarea"
              placeholder="Décrivez qui vous êtes, votre stack favorite, vos conventions de code et le comportement attendu des agents…" />
          </div>

          <div class="sheet-section-title" style="margin-top: 14px;">
            DIRECTIVES DU PROJET ({{ activeProjectName || 'Projet actif' }})
          </div>
          <div class="field">
            <textarea v-model="projectPreferencesInput" rows="4" class="cyber-code-textarea"
              placeholder="Conventions ou consignes propres à ce dépôt uniquement…" />
          </div>

          <div class="sheet-section-title" style="margin-top: 14px;">
            MÉMOIRE ARCHITECTURALE DU PROJET (UPSTASH)
          </div>
          <div class="field">
            <textarea v-model="projectMemoryInput" rows="6" class="cyber-code-textarea"
              placeholder="Décisions techniques validées par Brain ou par vous…" />
          </div>

          <p v-if="personaStatusMsg" style="font-size: 12px; color: #00f0ff; margin: 6px 0;">
            {{ personaStatusMsg }}
          </p>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button type="button" class="button primary full-width" :disabled="isSavingPersona" @click="savePersonaAndMemory">
              <span>{{ isSavingPersona ? 'Synchronisation Upstash…' : '💾 Sauvegarder dans Upstash' }}</span>
            </button>
            <button type="button" class="button secondary" :disabled="isLoadingPersona" @click="fetchPersonaAndMemory">
              <span>Actualiser</span>
            </button>
          </div>
        </div>

        <!-- 3. Voix & STT -->
        <div v-show="settingsSection === 'voice'" class="settings-section-body">
          <p v-if="!ttsAvailable" style="color: var(--muted-light); font-size: 13px;">La lecture vocale n'est pas disponible sur cet appareil.</p>
          <template v-else>
            <label class="switch-field">
              <span>Activer la synthèse vocale (TTS)<small>Permet à Nexus de vous répondre à haute voix.</small></span>
              <input v-model="ttsEnabled" type="checkbox" role="switch" />
            </label>
            <label class="switch-field">
              <span>Lire aussi les réponses aux messages écrits</span>
              <input v-model="autoSpeak" :disabled="!ttsEnabled" type="checkbox" role="switch" />
            </label>
            <label class="switch-field">
              <span>Envoyer automatiquement après la dictée<small>Désactivez pour relire avant l'envoi.</small></span>
              <input v-model="autoSendVoice" type="checkbox" role="switch" />
            </label>
            <div class="field">
              <label for="speech-voice">Voix de lecture</label>
              <select id="speech-voice" v-model="speechVoice" :disabled="!ttsEnabled">
                <option value="">Automatique · français de France</option>
                <option v-if="speechVoice && !speechVoices.some(voice => voice.voiceURI === speechVoice)" :value="speechVoice">Voix enregistrée indisponible — choix automatique</option>
                <option v-for="voice in speechVoices" :key="voice.voiceURI" :value="voice.voiceURI">{{ voice.name }} · {{ voice.lang }} · {{ voice.localService ? "sur l'appareil" : "en ligne" }}</option>
              </select>
            </div>
            <div class="field">
              <label for="speech-rate">Vitesse d'élocution : {{ speechRate.toFixed(1) }}×</label>
              <input id="speech-rate" v-model.number="speechRate" :disabled="!ttsEnabled" type="range" min="0.8" max="1.3" step="0.1" />
            </div>
            <button type="button" class="button secondary" :disabled="!ttsEnabled" @click="speakMessage('Bonjour. Nexus est opérationnel et prêt à exécuter vos tâches.')">
              <NexusIcon name="speaker" />
              <span>Tester la voix de synthèse</span>
            </button>
          </template>
        </div>

        <!-- 4. Notifications -->
        <div v-show="settingsSection === 'notifications'" class="settings-section-body">
          <label class="switch-field">
            <span>Notifications système<small>Alertes sonores et pop-up type SMS lors des approbations.</small></span>
            <input v-model="notificationsEnabled" type="checkbox" role="switch" />
          </label>
          <div v-if="notificationsEnabled" style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
            <button type="button" class="button secondary" @click="testUrgentNotification">
              <span>🔔 Tester l'alerte sonore et pop-up (style SMS)</span>
            </button>
            <button type="button" class="button secondary" style="color: #00f0ff; border-color: rgba(0,240,255,0.3);" @click="testFcmPush">
              <span>🚀 Tester la vraie notification Push Google FCM</span>
            </button>
          </div>
        </div>

        <!-- 5. Projets -->
        <div v-show="settingsSection === 'projects'" class="settings-section-body">
          <div class="sheet-section-title">PROJET COURANT</div>
          <p style="font-family: var(--font-mono); font-size: 13px; color: var(--accent); padding: 8px 12px; border-radius: 6px; background: rgba(0,240,255,0.06); border: 1px solid var(--line);">
            📁 {{ activeProjectName || 'Aucun projet sélectionné' }}
          </p>

          <div v-if="projectsList.length" class="project-sheet-list" style="margin-top: 10px;">
            <button v-for="project in projectsList" :key="`${project.nodeId || ''}:${project.id || project.path}`" type="button"
              class="project-sheet-row" :class="{ selected: isProjectActive(project) }"
              :disabled="isSwitchingProject || isSending" @click="openProject(project)">
              <span class="project-symbol"><NexusIcon name="folder" /></span>
              <span class="project-info">
                <span class="project-name">{{ project.name }}</span>
                <span class="project-quick-path">{{ project.path }}</span>
              </span>
              <span v-if="isProjectActive(project)" class="project-badge-active">Actif</span>
            </button>
          </div>

          <div class="sheet-section-title" style="margin-top: 16px;">EXPLORATEUR DE DOSSIERS SUR LE PC</div>
          <NexusFileBrowser :core-url="coreUrl" :token="authToken" :nodes="onlineNodes" :busy="isSending || isSwitchingProject"
            @settings="settingsSection = 'connection'" @opened="handleFolderOpened" />
        </div>

        <!-- 6. Quotas & Tâches -->
        <div v-show="settingsSection === 'quotas'" class="settings-section-body">
          <NexusUsageDashboard :dashboard="usageDashboard" :loading="dashboardLoading" :error="dashboardError" :online="isNodeReady"
            :agent-label="selectedBackendLabel(selectedBackend)" :model-label="selectedModelLabel" :now="now" @refresh="fetchDashboard" />

          <div class="sheet-section-title" style="margin-top: 20px;">TÂCHES RÉCENTES ({{ tasks.length }})</div>
          <div v-if="tasks.length" class="task-list" style="max-height: 280px; overflow-y: auto;">
            <article v-for="task in tasks.slice(0, 5)" :key="task.taskId" class="task-row">
              <div class="task-line">
                <span class="task-status" :class="task.status"><span class="status-dot" />{{ formatTaskStatus(task.status) }}</span>
                <time>{{ formatRelativeTime(task.createdAt) }}</time>
              </div>
              <h4 style="font-size: 13px; margin: 4px 0;">{{ task.prompt }}</h4>
              <div class="task-subline">
                <span>{{ selectedBackendLabel(task.backend) }}</span>
                <button v-if="task.status === 'running' || task.status === 'pending'" type="button" class="text-button danger" @click="cancelTask(task.taskId)">
                  Arrêter
                </button>
              </div>
            </article>
          </div>
          <p v-else style="font-size: 12px; color: var(--muted); padding: 8px 0;">Aucune tâche récente enregistrée.</p>
        </div>
      </div>
    </NexusSheet>

    <!-- APPROVALS SHEET -->
    <NexusSheet v-model="showApprovalModal" title="Autorisation requise">
      <div v-if="activeApproval" class="approval-content">
        <div class="approval-heading">
          <NexusIcon name="shield" /><span>{{ activeApproval.agentName
            }}<small>{{ formatApprovalKind(activeApproval.kind) }}</small></span>
        </div>
        <div v-if="activeApprovalParsed" class="approval-parsed-body">
          <p class="approval-reason-banner">
            {{ activeApproval.summary || activeApprovalParsed.reason }}
          </p>

          <div v-if="activeApprovalParsed.command" class="approval-parsed-item">
            <span class="approval-parsed-label">Commande à exécuter :</span>
            <pre class="approval-code"><code>{{ activeApprovalParsed.command }}</code></pre>
            <span v-if="activeApprovalParsed.cwd" class="approval-cwd-tag">
              📁 {{ activeApprovalParsed.cwd }}
            </span>
          </div>

          <div v-if="activeApprovalParsed.files && activeApprovalParsed.files.length" class="approval-parsed-item">
            <span class="approval-parsed-label">
              {{ activeApprovalParsed.files.length > 1 ? "Fichiers concernés :" : "Fichier concerné :" }}
            </span>
            <ul class="approval-files-list">
              <li v-for="(file, fIdx) in activeApprovalParsed.files" :key="fIdx" class="approval-file-entry">
                <code>{{ file.path }}</code>
              </li>
            </ul>
          </div>

          <div v-if="activeApprovalParsed.network" class="approval-parsed-item">
            <span class="approval-parsed-label">Accès réseau :</span>
            <pre class="approval-code"><code>{{ activeApprovalParsed.network.protocol ? `${activeApprovalParsed.network.protocol}://` : '' }}{{ activeApprovalParsed.network.host }}</code></pre>
          </div>

          <div v-if="activeApprovalParsed.questions && activeApprovalParsed.questions.length" class="approval-questions">
            <div v-for="(q, qIdx) in activeApprovalParsed.questions" :key="qIdx" class="question-block">
              <p class="question-title"><strong>{{ q.question }}</strong></p>
              <div class="question-options">
                <button v-for="(opt, optIdx) in q.options" :key="optIdx" type="button" class="button secondary compact-btn"
                  @click="decideApproval(activeApproval.approvalId, 'accept', opt)">
                  {{ opt }}
                </button>
              </div>
            </div>
          </div>
        </div>
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

    <!-- DISCREET APPROVAL DECISION TOAST (Top-Layer Manual Popover, No Backdrop Blur) -->
    <div
      ref="approvalDecisionToastRef"
      popover="manual"
      role="status"
      aria-live="polite"
      class="approval-decision-toast"
      :class="[
        `is-${approvalDecisionToast.variant}`,
        { 'is-visible': approvalDecisionToast.visible },
      ]"
      @click="hideApprovalDecisionToast"
    >
      <span class="approval-toast-badge" aria-hidden="true">
        <NexusIcon :name="approvalDecisionToast.variant === 'accepted' ? 'check' : 'close'" />
      </span>
      <div class="approval-toast-copy">
        <strong class="approval-toast-title">{{ approvalDecisionToast.title }}</strong>
        <span v-if="approvalDecisionToast.subtitle" class="approval-toast-subtitle">{{ approvalDecisionToast.subtitle }}</span>
      </div>
    </div>

    <!-- QUICK PROJECT SELECTOR SHEET -->
    <NexusSheet v-model="showProjectMenu" title="Changer de projet">
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div v-if="projectsList.length" class="project-sheet-list">
        <button v-for="project in projectsList" :key="`${project.nodeId || ''}:${project.id || project.path}`" type="button"
          class="project-sheet-row" :class="{ selected: isProjectActive(project) }"
          :disabled="isSwitchingProject || isSending" @click="openProject(project)">
          <span class="project-symbol">
            <NexusIcon name="folder" />
          </span>
          <span class="project-info">
            <span class="project-name">{{ project.name }}</span>
            <span class="project-quick-path">{{ project.path }}</span>
            <span v-if="project.currentBranch" class="project-branch">
              <NexusIcon name="branch" />{{ project.currentBranch }}
            </span>
          </span>
          <span v-if="isProjectActive(project)" class="project-badge-active">Actif</span>
        </button>
      </div>
      <div v-else class="empty-state compact">
        <p>Aucun projet détecté sur le poste connecté.</p>
        <button type="button" class="button secondary" @click="showProjectMenu = false; settingsSection = 'projects'; showSettings = true">
          Parcourir les dossiers du PC
        </button>
      </div>
      <button v-if="projectsList.length" type="button" class="button secondary" @click="showProjectMenu = false; settingsSection = 'projects'; showSettings = true">Parcourir les dossiers du PC</button>
    </NexusSheet>

    <!-- AGENT & MODEL SELECTOR SHEET -->
    <NexusSheet v-model="showAgentPickerSheet" title="Agent IA & Modèle">
      <div class="agent-model-sheet">
        <div class="sheet-section-title">AGENT IA</div>
        <div class="agent-sheet-list">
          <button v-for="agent in agentOptions" :key="agent.id" type="button" class="agent-card-row"
            :class="{ selected: selectedBackend === agent.id }" @click="handleSelectBackend(agent.id)">
            <div class="agent-card-icon">
              <NexusIcon :name="agent.id === 'brain' ? 'sparkles' : agent.id === 'codex' ? 'zap' : agent.id === 'claude' ? 'cpu' : 'branch'" />
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

        <div v-if="currentModelEfforts.length > 1" style="margin-top: 14px;">
          <div class="sheet-section-title">EFFORT DE RAISONNEMENT</div>
          <div class="effort-pills-row">
            <button v-for="eff in currentModelEfforts" :key="eff.reasoningEffort" type="button"
              class="effort-pill-btn" :class="{ active: currentSelectedEffort === eff.reasoningEffort }"
              @click="handleSelectModel(currentSelectedModel, eff.reasoningEffort)">
              <strong>{{ eff.reasoningEffort.toUpperCase() }}</strong>
              <small v-if="eff.description"> {{ eff.description }}</small>
            </button>
          </div>
        </div>
      </div>
    </NexusSheet>
  </div>
</template>

<script setup lang="ts">
import NexusFileBrowser from './components/NexusFileBrowser.vue';
import NexusUsageDashboard from './components/NexusUsageDashboard.vue';
import type { RuntimeDashboard } from "../../src/runtime/dashboard-types";
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { createNativeSpeechPlayback } from "./utils/native-speech-playback.mjs";
import { shouldSpeakReply } from "./utils/voice-reply.mjs";
import { createSpeechPlayback } from "./utils/speech-playback.mjs";
import { cleanTextForSpeech } from "./utils/speech-text.mjs";
import { getAssistantState, assistantStateLabels, getInteractionMessage } from "./utils/assistant-state.mjs";
import { parseApprovalDetails } from "./utils/approval-parser.mjs";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
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
  nodeId?: string;
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
  backend: "brain" | "codex" | "antigravity" | "claude";
  text: string;
  timestamp: number;
  fileSummary?: string;
  error?: boolean;
}

interface RemoteTaskItem {
  taskId: string;
  backend: "codex" | "antigravity" | "claude" | "brain";
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
  replyText?: string;
  text?: string;
  fileSummary?: string;
  result?: {
    text?: string;
    fileSummary?: string;
    filesChanged?: string[];
  };
  error?:
    | string
    | {
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
  toolName?: string;
  summary?: string;
  details: string;
  expiresAt: number;
  createdAt: number;
  status: "pending" | "accepted" | "declined" | "cancelled" | "timed_out";
  decidedAt?: number;
  decidedBy?: string;
  decision?: "accept" | "decline";
  cancelReason?: string;
}

// Navigation & View state
const currentView = ref<"home" | "workspace">("home");
const workspaceMode = ref<"code" | "brain">("code");
const lastCodingBackend = ref<"codex" | "antigravity" | "claude">("codex");
const slideDirection = ref<"forward" | "backward">("forward");
const settingsSection = ref<"connection" | "agent" | "persona" | "voice" | "notifications" | "projects" | "quotas">("connection");
const activeTab = ref<"chat" | "agent" | "activity" | "dashboard" | "system">("chat");
const selectedBackend = ref<"codex" | "antigravity" | "claude" | "brain">("codex");

function shortModelName(model: string): string {
  if (!model) return "";
  return model.replace(/^claude-/, "").replace(/^gemini-/, "").replace(/^(groq|gemini|mistral|openrouter|cerebras|ollama):/, "$1:");
}

function enterMode(mode: "code" | "brain") {
  workspaceMode.value = mode;
  if (mode === "code") {
    if (selectedBackend.value === "brain") {
      selectedBackend.value = lastCodingBackend.value || "codex";
    }
  } else {
    selectedBackend.value = "brain";
  }
  slideDirection.value = "forward";
  currentView.value = "workspace";
  activeTab.value = "chat";
  triggerHaptic("light");
  void fetchModelsForBackend(selectedBackend.value);
  nextTick(() => {
    scrollToBottom();
    resizeComposer();
  });
}

function leaveMode() {
  slideDirection.value = "backward";
  currentView.value = "home";
  triggerHaptic("light");
}

function toggleWorkspaceMode() {
  if (workspaceMode.value === "code") {
    enterMode("brain");
  } else {
    enterMode("code");
  }
}

// Quick Dropdowns & HUD Modals state
const showQuickMenu = ref<boolean>(false);
const showProjectMenu = ref<boolean>(false);
const showAgentPickerSheet = ref<boolean>(false);

const agentOptions = [
  {
    id: "codex" as const,
    name: "Codex",
    description: "Modèle de code rapide & précis (OpenAI)",
  },
  {
    id: "antigravity" as const,
    name: "Antigravity",
    description: "Agent autonome multi-outils (DeepMind)",
  },
  {
    id: "claude" as const,
    name: "Claude Code",
    description: "Agent de code autonome (Anthropic)",
  },
  {
    id: "brain" as const,
    name: "Nexus Brain",
    description: "Orchestration & brainstorming conceptuel",
  },
];

function selectedBackendShortLabel(b?: string): string {
  if (b === "brain") return "Brain";
  if (b === "codex") return "Codex";
  if (b === "antigravity") return "AGY";
  if (b === "claude") return "Claude";
  return "Agent";
}

// Core Connection state
const coreUrl = ref<string>("");
const coreUrlInput = ref<string>("");
const authToken = ref<string>("");
const authTokenInput = ref<string>("");
const showSettings = ref<boolean>(false);
const settingsTab = ref('overview');
function openConnectionSettings() {
  settingsSection.value = 'connection';
  showSettings.value = true;
}
function openPersonaSettings() {
  settingsSection.value = 'persona';
  showSettings.value = true;
  void fetchPersonaAndMemory();
}
const usageDashboard = ref<RuntimeDashboard | null>(null);
const dashboardLoading = ref(false);
const dashboardError = ref('');
let dashboardController: AbortController | undefined;
let dashboardFetchedAt = 0;
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
const draftFromVoice = ref(false);
const voiceTaskIds = new Set<string>();
watch(inputPrompt, (text) => { if (!text.trim()) draftFromVoice.value = false; }, { flush: "sync" });
const isSending = ref<boolean>(false);
const inFlightStartedAt = ref<number | null>(null);
const inFlightBackend = ref<"brain" | "codex" | "antigravity" | null>(null);
const lastTaskFailed = ref(false);

const currentInFlightTaskId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const messagesScrollRef = ref<HTMLElement | null>(null);
const homeScrollRef = ref<HTMLElement | null>(null);
const canScrollMessagesUp = ref(false);
const canScrollMessagesDown = ref(false);
const canScrollHomeUp = ref(false);
const canScrollHomeDown = ref(false);
const chatTextareaRef = ref<HTMLTextAreaElement | null>(null);
const settingsError = ref("");

function updateMessagesScrollState() {
  const el = messagesScrollRef.value;
  if (!el) {
    canScrollMessagesUp.value = false;
    canScrollMessagesDown.value = false;
    return;
  }
  canScrollMessagesUp.value = el.scrollTop > 10;
  canScrollMessagesDown.value = el.scrollHeight - el.scrollTop - el.clientHeight > 14;
}

function updateHomeScrollState() {
  const el = homeScrollRef.value;
  if (!el) {
    canScrollHomeUp.value = false;
    canScrollHomeDown.value = false;
    return;
  }
  canScrollHomeUp.value = el.scrollTop > 10;
  canScrollHomeDown.value = el.scrollHeight - el.scrollTop - el.clientHeight > 14;
}

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
let speechPlayback: ReturnType<typeof createSpeechPlayback> | ReturnType<typeof createNativeSpeechPlayback> | undefined;

function stopSpeaking() {
  return speechPlayback?.stop();
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

// System Notifications
const notificationsEnabled = ref<boolean>(true);
if (typeof window !== "undefined") {
  try {
    const savedNotifs = localStorage.getItem("nexus_notifications_enabled");
    if (savedNotifs !== null) notificationsEnabled.value = savedNotifs === "true";
  } catch {}
}

watch(notificationsEnabled, (val) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("nexus_notifications_enabled", String(val));
  } catch {}
  void syncNativeDaemonConfig();
});

interface NexusNativeAlertPluginInterface {
  sendUrgentNotification(options: {
    title: string;
    body: string;
    approvalId?: string;
    dedupKey?: string;
  }): Promise<void>;
  configureDaemon(options: {
    url: string;
    token: string;
    notificationsEnabled: boolean;
  }): Promise<void>;
}
const NexusNativeAlert = registerPlugin<NexusNativeAlertPluginInterface>("NexusNativeAlert");

async function syncNativeDaemonConfig() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await NexusNativeAlert.configureDaemon({
      url: coreUrl.value || "",
      token: authToken.value || "",
      notificationsEnabled: notificationsEnabled.value,
    });
  } catch (err) {
    console.warn("NexusNativeAlert.configureDaemon error:", err);
  }
}

async function sendSystemNotification(title: string, body: string, extra?: Record<string, any>) {
  if (!notificationsEnabled.value) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await NexusNativeAlert.sendUrgentNotification({
        title,
        body,
        approvalId: extra?.approvalId || "",
        dedupKey: extra?.dedupKey || (extra?.approvalId ? `approval:${extra.approvalId}` : ""),
      });
    } catch (e) {
      console.warn("NexusNativeAlert error, fallback local-notif:", e);
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.floor(Math.random() * 1000000) + 1,
              title,
              body,
              channelId: "nexus_urgent_sms_channel_v2",
              extra,
            },
          ],
        });
      } catch {}
    }
  } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body, icon: "/pwa-icon.png", badge: "/pwa-icon.png" });
    } catch {}
  }
}

async function testUrgentNotification() {
  await sendSystemNotification(
    "Nexus : Test d'alerte SMS",
    "Ceci est une alerte sonore et pop-up Heads-Up comme un SMS !"
  );
}

const fcmToken = ref<string>("");

async function sendTokenToDaemon(token: string) {
  if (!coreUrl.value || !token) return;
  try {
    const rawUrl = coreUrl.value.replace(/\/+$/, "");
    await fetch(`${rawUrl}/api/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
      },
      body: JSON.stringify({ token }),
    });
    console.log("[FCM] Token enregistré avec succès sur le daemon");
  } catch (err) {
    console.warn("[FCM] Échec enregistrement token sur le daemon:", err);
  }
}

async function testFcmPush() {
  if (!coreUrl.value) {
    errorMessage.value = "Connectez-vous d'abord au daemon.";
    return;
  }
  try {
    const rawUrl = coreUrl.value.replace(/\/+$/, "");
    const res = await fetch(`${rawUrl}/api/push/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}),
      },
    });
    const data = await res.json();
    if (res.ok) {
      alert("✅ Requête push envoyée à Google ! Votre téléphone va sonner.");
    } else {
      alert(`Erreur push : ${data.error || "Échec"}`);
    }
  } catch (err: any) {
    alert(`Erreur de connexion au daemon : ${err.message}`);
  }
}

// Agent & Models state
interface ModelItem {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  context?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort?: string;
}

const agentModels = ref<Record<string, { models: ModelItem[]; selected?: string; selectedEffort?: string }>>({
  brain: { models: [], selected: "", selectedEffort: "" },
  codex: { models: [], selected: "", selectedEffort: "high" },
  antigravity: { models: [], selected: "", selectedEffort: "" },
  claude: { models: [], selected: "claude-sonnet-4-6", selectedEffort: "high" },
});
const isLoadingModels = ref<boolean>(false);

const currentBackendModels = computed(() => {
  return agentModels.value[selectedBackend.value]?.models || [];
});

const currentSelectedModel = computed(() => {
  return agentModels.value[selectedBackend.value]?.selected || "";
});

const currentSelectedEffort = computed(() => {
  return agentModels.value[selectedBackend.value]?.selectedEffort || "high";
});

const currentModelEfforts = computed(() => {
  const m = currentBackendModels.value.find(
    (item) => item.model === currentSelectedModel.value || item.id === currentSelectedModel.value
  );
  return m?.supportedReasoningEfforts || [];
});

const selectedModelLabel = computed(() => {
  if (selectedBackend.value === 'brain' && usageDashboard.value) {
    const selection = usageDashboard.value.brain.selection;
    return selection === 'auto' ? 'Sélection automatique' : selection.replace(':', ' · ');
  }
  const actual = usageDashboard.value?.agents.find(agent => agent.id === selectedBackend.value)?.model;
  return actual || currentBackendModels.value.find(model => model.model === currentSelectedModel.value)?.displayName || currentSelectedModel.value;
});

// Persona & Memory State (Upstash synced)
const personaInput = ref<string>("");
const projectPreferencesInput = ref<string>("");
const projectMemoryInput = ref<string>("");
const isLoadingPersona = ref<boolean>(false);
const isSavingPersona = ref<boolean>(false);
const personaStatusMsg = ref<string>("");

async function fetchPersonaAndMemory() {
  if (!coreUrl.value || !isNodeReady.value) return;
  isLoadingPersona.value = true;
  personaStatusMsg.value = "";
  try {
    const base = coreUrl.value.replace(/\/+$/, "");
    const headers = getRequestHeaders();
    const [personaRes, memRes] = await Promise.all([
      fetch(`${base}/api/persona`, { headers }),
      fetch(`${base}/api/projects/memory`, { headers }),
    ]);
    if (personaRes.ok) {
      const pData = await personaRes.json();
      personaInput.value = pData.persona || "";
    }
    if (memRes.ok) {
      const mData = await memRes.json();
      projectPreferencesInput.value = mData.projectPreferences || "";
      projectMemoryInput.value = mData.memory || "";
    }
  } catch (err) {
    console.warn("[Persona] Échec du chargement Persona/Mémoire:", err);
  } finally {
    isLoadingPersona.value = false;
  }
}

async function savePersonaAndMemory() {
  if (!coreUrl.value || isSavingPersona.value) return;
  isSavingPersona.value = true;
  personaStatusMsg.value = "";
  try {
    const base = coreUrl.value.replace(/\/+$/, "");
    const headers = {
      ...getRequestHeaders(),
      "Content-Type": "application/json",
    };
    const [pRes, mRes] = await Promise.all([
      fetch(`${base}/api/persona`, {
        method: "POST",
        headers,
        body: JSON.stringify({ persona: personaInput.value }),
      }),
      fetch(`${base}/api/projects/memory`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          preferences: projectPreferencesInput.value,
          memory: projectMemoryInput.value,
        }),
      }),
    ]);
    if (pRes.ok && mRes.ok) {
      personaStatusMsg.value = "✓ Sauvegardé et synchronisé sur Upstash";
      triggerHaptic("success");
    } else {
      personaStatusMsg.value = "⚠ Erreur lors de la sauvegarde.";
    }
  } catch {
    personaStatusMsg.value = "⚠ Impossible de joindre le serveur Nexus.";
  } finally {
    isSavingPersona.value = false;
  }
}

async function sendQuickCommand(cmd: string) {
  if (isSending.value) return;
  triggerHaptic("release");
  await sendPrompt(cmd, false);
}

function handleSettingsTabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  settingsTab.value = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'preferences' : settingsTab.value === 'overview' ? 'preferences' : 'overview';
  void nextTick(() => document.getElementById(`${settingsTab.value === 'overview' ? 'overview' : 'preferences'}-tab`)?.focus());
}

async function fetchDashboard() {
  if (dashboardLoading.value) return;
  if (!coreUrl.value || !isNodeReady.value) {
    dashboardError.value = 'Connectez votre poste dans Voix & connexion pour consulter ses informations.';
    return;
  }
  dashboardLoading.value = true;
  dashboardError.value = '';
  dashboardFetchedAt = Date.now();
  const controller = new AbortController();
  dashboardController = controller;
  // Also works in Android WebViews without AbortSignal.any/timeout.
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const query = primaryNode.value?.nodeId ? `?nodeId=${encodeURIComponent(primaryNode.value.nodeId)}` : '';
    const response = await fetch(`${coreUrl.value.replace(/\/+$/, '')}/api/dashboard${query}`, {
      headers: getRequestHeaders(), signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Renseignez le jeton Nexus dans Voix & connexion pour consulter les quotas.' : response.status === 404 ? 'Mettez à jour Nexus Core et Nexus Desktop pour consulter cet aperçu.' : 'Le poste ne peut pas fournir ses quotas. Réessayez ou vérifiez Nexus Desktop.');
    const data = await response.json();
    if (dashboardController !== controller) return;
    if (!data?.brain || !Array.isArray(data.brain.providers) || !Array.isArray(data.agents)) throw new Error('Mettez à jour Nexus Desktop pour afficher les informations de session.');
    usageDashboard.value = data;
  } catch (error: any) {
    if (dashboardController === controller) dashboardError.value = controller.signal.aborted ? 'Le poste ne répond pas dans le délai prévu. Réessayez.' : error?.message || 'Impossible d’actualiser les quotas.';
  } finally {
    clearTimeout(timer);
    if (dashboardController === controller) { dashboardLoading.value = false; dashboardController = undefined; }
  }
}

async function fetchModelsForBackend(backend: "brain" | "codex" | "antigravity" | "claude") {
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
            data.selected?.model || agentModels.value[backend]?.selected || data.models[0]?.model,
          selectedEffort:
            data.selected?.effort || agentModels.value[backend]?.selectedEffort || data.models[0]?.defaultReasoningEffort || "high",
        };
      }
    }
  } catch (err) {
    console.warn(`[Models] Échec du chargement des modèles (${backend}):`, err);
  } finally {
    isLoadingModels.value = false;
  }
}

async function handleSelectBackend(backend: "brain" | "codex" | "antigravity" | "claude") {
  selectedBackend.value = backend;
  if (backend === "brain") {
    workspaceMode.value = "brain";
  } else {
    workspaceMode.value = "code";
    lastCodingBackend.value = backend;
  }
  triggerHaptic("release");
  await fetchModelsForBackend(backend);
}

async function handleSelectModel(modelName: string, effort?: string) {
  if (!coreUrl.value || !modelName) return;
  const backend = selectedBackend.value;
  const foundModel = (agentModels.value[backend]?.models || []).find(
    (m) => m.model === modelName || m.id === modelName
  );
  const resolvedEffort =
    effort ||
    agentModels.value[backend]?.selectedEffort ||
    foundModel?.defaultReasoningEffort ||
    undefined;
  try {
    const headers = getRequestHeaders();
    headers["Content-Type"] = "application/json";
    const res = await fetch(`${coreUrl.value.replace(/\/+$/, "")}/api/models/select`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        backend,
        model: modelName,
        context: foundModel?.context,
        effort: resolvedEffort,
        selection: {
          model: modelName,
          context: foundModel?.context,
          effort: resolvedEffort,
        },
      }),
    });
    if (res.ok) {
      agentModels.value[backend].selected = modelName;
      if (resolvedEffort) {
        agentModels.value[backend].selectedEffort = resolvedEffort;
      }
      void fetchDashboard();
      triggerHaptic("press");
    } else {
      errorMessage.value = "Impossible de sélectionner ce modèle. Vérifiez sa configuration sur le poste Nexus.";
    }
  } catch {
    errorMessage.value = "Impossible de joindre le poste pour changer de modèle.";
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

const approvalDecisionToastRef = ref<HTMLElement | null>(null);
const approvalDecisionToast = ref<{
  visible: boolean;
  variant: "accepted" | "declined" | "error";
  title: string;
  subtitle: string;
}>({
  visible: false,
  variant: "accepted",
  title: "",
  subtitle: "",
});
let approvalToastTimer: ReturnType<typeof setTimeout> | null = null;

function hideApprovalDecisionToast() {
  if (approvalToastTimer) {
    clearTimeout(approvalToastTimer);
    approvalToastTimer = null;
  }
  approvalDecisionToast.value.visible = false;
  const el = approvalDecisionToastRef.value as any;
  if (el && typeof el.hidePopover === "function") {
    try {
      el.hidePopover();
    } catch {}
  }
}

function showApprovalDecisionToast(
  variant: "accepted" | "declined" | "error",
  title: string,
  subtitle = ""
) {
  if (approvalToastTimer) {
    clearTimeout(approvalToastTimer);
    approvalToastTimer = null;
  }
  approvalDecisionToast.value = {
    visible: true,
    variant,
    title,
    subtitle,
  };
  void nextTick(() => {
    const el = approvalDecisionToastRef.value as any;
    if (el && typeof el.showPopover === "function") {
      try {
        el.showPopover();
      } catch {}
    }
  });
  approvalToastTimer = setTimeout(() => {
    hideApprovalDecisionToast();
  }, 2400);
}

const pendingApprovals = computed(() => {
  return approvals.value.filter((a) => a.status === "pending");
});

watch(
  () => pendingApprovals.value.length,
  (count) => {
    if (count === 0 && showApprovalModal.value) {
      showApprovalModal.value = false;
    }
  }
);

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

const activeApprovalParsed = computed<any>(() => {
  if (!activeApproval.value) return null;
  return parseApprovalDetails(activeApproval.value);
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

// WebSocket Real-Time Stream State
let wsInstance: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const isWsConnected = ref(false);

function handleDaemonWsMessage(data: { event: string; payload: any; timestamp: number }) {
  if (!data || !data.event) return;

  switch (data.event) {
    case "task:started": {
      const payload = data.payload;
      if (payload?.taskId) {
        currentInFlightTaskId.value = payload.taskId;
        inFlightStartedAt.value = payload.startedAt || Date.now();
        inFlightBackend.value = payload.backend || selectedBackend.value;
        isSending.value = true;
      }
      void fetchTasks(true);
      break;
    }

    case "task:progress": {
      const payload = data.payload;
      if (payload?.taskId) {
        const existing = tasks.value.find((t) => t.taskId === payload.taskId);
        if (existing && payload.filesChanged) {
          existing.filesChanged = payload.filesChanged;
        }
      }
      break;
    }

    case "task:chunk": {
      const payload = data.payload;
      if (payload?.taskId) {
        let msg = messages.value.find((m) => m.id === `asst-${payload.taskId}`);
        if (!msg) {
          msg = {
            id: `asst-${payload.taskId}`,
            role: "assistant",
            backend: inFlightBackend.value || selectedBackend.value,
            text: payload.delta || "",
            timestamp: Date.now(),
          };
          messages.value.push(msg);
        } else {
          msg.text = payload.text !== undefined ? payload.text : (msg.text + (payload.delta || ""));
        }
        scrollToBottom();
      }
      break;
    }

    case "task:completed": {
      const payload = data.payload;
      if (payload?.taskId) {
        const text = payload.replyText || payload.text;
        const wasFromVoice = voiceTaskIds.has(payload.taskId) || draftFromVoice.value;
        voiceTaskIds.delete(payload.taskId);
        const existingMsg = messages.value.find((m) => m.id === `asst-${payload.taskId}`);
        if (existingMsg) {
          if (text) existingMsg.text = text;
          existingMsg.fileSummary = payload.fileSummary;
          saveMessages();
          scrollToBottom();
          if (
            shouldSpeakReply({
              enabled: ttsEnabled.value,
              autoSpeak: autoSpeak.value,
              fromVoice: wasFromVoice,
              error: false,
            })
          ) {
            speakMessage(existingMsg.text, existingMsg.id);
          }
        } else if (text) {
          const assistantMsg: ChatMessage = {
            id: `asst-${payload.taskId}`,
            role: "assistant",
            backend: payload.backend || selectedBackend.value,
            text,
            timestamp: payload.completedAt || Date.now(),
            fileSummary: payload.fileSummary,
          };
          messages.value.push(assistantMsg);
          saveMessages();
          scrollToBottom();
          if (
            shouldSpeakReply({
              enabled: ttsEnabled.value,
              autoSpeak: autoSpeak.value,
              fromVoice: wasFromVoice,
              error: false,
            })
          ) {
            speakMessage(assistantMsg.text, assistantMsg.id);
          }
        }
        if (!notifiedTaskIds.has(payload.taskId)) {
          notifiedTaskIds.add(payload.taskId);
          void sendSystemNotification(
            "Nexus : Tâche terminée ✅",
            payload?.fileSummary || payload?.summary || "La tâche demandée a été exécutée avec succès.",
            { dedupKey: `task:${payload.taskId}:completed` }
          );
        }
        if (currentInFlightTaskId.value === payload.taskId) {
          isSending.value = false;
          inFlightStartedAt.value = null;
          inFlightBackend.value = null;
          currentInFlightTaskId.value = null;
        }
      }
      void fetchTasks(true);
      void fetchStatus(true);
      break;
    }

    case "task:failed": {
      const payload = data.payload;
      if (payload?.taskId) {
        lastTaskFailed.value = true;
        if (!messages.value.some((m) => m.id === `err-${payload.taskId}`)) {
          const errorMsg: ChatMessage = {
            id: `err-${payload.taskId}`,
            role: "assistant",
            backend: selectedBackend.value,
            text: `Erreur : ${payload.error || "Échec de la tâche"}`,
            timestamp: Date.now(),
            error: true,
          };
          messages.value.push(errorMsg);
          saveMessages();
          scrollToBottom();
        }
        if (!notifiedTaskIds.has(payload.taskId)) {
          notifiedTaskIds.add(payload.taskId);
          void sendSystemNotification(
            "Nexus : Tâche échouée ❌",
            payload.error || "Une erreur est survenue lors de l'exécution.",
            { dedupKey: `task:${payload.taskId}:failed` }
          );
        }
        if (currentInFlightTaskId.value === payload.taskId) {
          isSending.value = false;
          inFlightStartedAt.value = null;
          inFlightBackend.value = null;
          currentInFlightTaskId.value = null;
        }
      }
      void fetchTasks(true);
      void fetchStatus(true);
      break;
    }

    case "task:cancelled": {
      const payload = data.payload;
      if (currentInFlightTaskId.value === payload?.taskId) {
        isSending.value = false;
        inFlightStartedAt.value = null;
        inFlightBackend.value = null;
        currentInFlightTaskId.value = null;
      }
      void fetchTasks(true);
      break;
    }

    case "approval:requested": {
      const item = data.payload;
      if (item?.approvalId) {
        if (!approvals.value.some((a) => a.approvalId === item.approvalId)) {
          approvals.value.push({
            ...item,
            status: "pending",
          });
        }
        showApprovalModal.value = true;
        activeApprovalIndex.value = 0;
        triggerHaptic("heavy");
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate([120, 60, 120]);
        }
        notifyApprovalIfNeeded(item);
      }
      break;
    }

    case "approval:decided": {
      const payload = data.payload;
      if (payload?.approvalId) {
        const found = approvals.value.find((a) => a.approvalId === payload.approvalId);
        if (found) {
          found.status = payload.decision === "accept" ? "accepted" : "declined";
          found.decision = payload.decision;
        }
      }
      break;
    }

    case "project:switched": {
      void fetchStatus(true);
      break;
    }
  }
}

const notifiedApprovalIds = new Set<string>();
const notifiedTaskIds = new Set<string>();

function notifyApprovalIfNeeded(item: Partial<PendingApprovalItem> & { approvalId?: string }) {
  if (!item?.approvalId || notifiedApprovalIds.has(item.approvalId)) {
    return;
  }
  notifiedApprovalIds.add(item.approvalId);

  const parsed = parseApprovalDetails(item);
  void sendSystemNotification(
    parsed.notificationTitle,
    item.summary || parsed.notificationBody,
    { approvalId: item.approvalId, dedupKey: `approval:${item.approvalId}` }
  );
}

function connectWebSocket() {
  if (typeof window === "undefined" || !coreUrl.value) return;
  if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const rawUrl = coreUrl.value.replace(/\/+$/, "");
    const wsBase = rawUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const wsTarget = `${wsBase}/ws?token=${encodeURIComponent(authToken.value || "")}`;

    wsInstance = new WebSocket(wsTarget);

    wsInstance.onopen = () => {
      isWsConnected.value = true;
      if (fcmToken.value) {
        void sendTokenToDaemon(fcmToken.value);
      }
    };

    wsInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleDaemonWsMessage(data);
      } catch (e) {
        console.warn("Erreur parsing message WS:", e);
      }
    };

    wsInstance.onerror = () => {
      isWsConnected.value = false;
    };

    wsInstance.onclose = () => {
      isWsConnected.value = false;
      wsInstance = null;
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null;
          connectWebSocket();
        }, 3000);
      }
    };
  } catch (err) {
    console.warn("Échec connexion WebSocket:", err);
  }
}

// Lifecycle
onMounted(async () => {
  const speechCallbacks = {
    onState: (speaking: boolean, id: string | null) => { isSpeaking.value = speaking; currentSpeakingId.value = id; },
    onError: (message: string) => { speechError.value = message; },
  };
  if (Capacitor.isNativePlatform()) {
    ttsAvailable.value = Capacitor.isPluginAvailable("TextToSpeech");
    if (ttsAvailable.value) {
      speechPlayback = createNativeSpeechPlayback(TextToSpeech, speechCallbacks);
      void TextToSpeech.getSupportedVoices().then(({ voices }) => { speechVoices.value = voices; }).catch(() => {
        speechError.value = "Vérifiez le moteur vocal et la voix française dans les paramètres Android.";
      });
    }
  } else {
    ttsAvailable.value = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    if (ttsAvailable.value) {
      refreshSpeechVoices();
      window.speechSynthesis.addEventListener("voiceschanged", refreshSpeechVoices);
      speechPlayback = createSpeechPlayback(window.speechSynthesis,
        (text: string) => new SpeechSynthesisUtterance(text), speechCallbacks);
    }
  }
  if (typeof window !== "undefined") {
    syncViewport();
    window.visualViewport?.addEventListener("resize", syncViewport);
    const savedUrl = localStorage.getItem("nexus_core_url");
    const savedToken = localStorage.getItem("nexus_auth_token") || "";
    const savedTab = localStorage.getItem("nexus_active_tab") as
      | "chat"
      | "activity"
      | "agent"
      | "system"
      | "dashboard"
      | null;

    authToken.value = savedToken;
    authTokenInput.value = savedToken;
    fcmToken.value = localStorage.getItem("nexus_fcm_token") || "";

    if (savedUrl) {
      coreUrl.value = savedUrl;
      if (fcmToken.value) {
        void sendTokenToDaemon(fcmToken.value);
      }
    } else if (Capacitor.isNativePlatform()) {
      coreUrl.value = "";
      openConnectionSettings();
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
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#07090e" });
      } catch { }
      try {
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display !== "granted") {
          await LocalNotifications.requestPermissions();
        }
        await LocalNotifications.createChannel({
          id: "nexus-alerts",
          name: "Nexus Approbations & Alertes",
          description: "Alertes instantanées pour les approbations requises et fins de tâches",
          importance: 5,
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: "#4f98a3",
        });
        await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
          if (action.notification.extra?.approvalId) {
            showApprovalModal.value = true;
            const idx = approvals.value.findIndex((a) => a.approvalId === action.notification.extra?.approvalId);
            if (idx >= 0) activeApprovalIndex.value = idx;
          }
        });
      } catch (err) {
        console.warn("LocalNotifications init error:", err);
      }
      try {
        await PushNotifications.addListener("registration", async (token) => {
          console.log("[FCM] Registered token:", token.value);
          fcmToken.value = token.value;
          localStorage.setItem("nexus_fcm_token", token.value);
          await sendTokenToDaemon(token.value);
        });

        await PushNotifications.addListener("registrationError", (err) => {
          console.warn("[FCM] Registration error:", err);
        });

        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          console.log("[FCM] Push received foreground:", notification);
        });

        await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          console.log("[FCM] Push action clicked:", action);
          const approvalId = action.notification.data?.approvalId;
          if (approvalId) {
            showApprovalModal.value = true;
            const idx = approvals.value.findIndex((a) => a.approvalId === approvalId);
            if (idx >= 0) activeApprovalIndex.value = idx;
          }
        });

        let pushPerm = await PushNotifications.checkPermissions();
        if (pushPerm.receive !== "granted") {
          pushPerm = await PushNotifications.requestPermissions();
        }
        if (pushPerm.receive === "granted") {
          await PushNotifications.register();
        }
      } catch (err) {
        console.warn("PushNotifications init error:", err);
      }
      await syncNativeDaemonConfig();
    } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        void Notification.requestPermission();
      } catch { }
    }

    coreUrlInput.value = coreUrl.value;
    if (savedTab && ["chat", "agent", "activity", "dashboard", "system"].includes(savedTab))
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
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  fetchStatus();
  fetchTasks(true);
  fetchApprovals(true);
  fetchVoiceStatus();
  fetchModelsForBackend(selectedBackend.value);
  connectWebSocket();

  pollTimer = setInterval(() => {
    if ((showSettings.value || activeTab.value === 'agent' || isSending.value) && Date.now() - dashboardFetchedAt > 5000) void fetchDashboard();
    fetchStatus(true);
    fetchTasks(true);
    fetchApprovals(true);
  }, 3000);

  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

function handleVisibilityChange() {
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    connectWebSocket();
    void fetchStatus(true);
    void fetchTasks(true);
    void fetchApprovals(true);
  }
}

onUnmounted(() => {
  window.visualViewport?.removeEventListener("resize", syncViewport);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.documentElement.style.removeProperty("--app-height");
  dashboardController?.abort();
  if (pollTimer) clearInterval(pollTimer);
  if (clockTimer) clearInterval(clockTimer);
  if (fastApprovalTimer) clearInterval(fastApprovalTimer);
  if (approvalToastTimer) clearTimeout(approvalToastTimer);
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
  cancelVoiceRecording();
  stopSpeaking();
  if (!Capacitor.isNativePlatform() && ttsAvailable.value) window.speechSynthesis.removeEventListener("voiceschanged", refreshSpeechVoices);
});

watch([coreUrl, authToken], () => {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  if (wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
  connectWebSocket();
  void syncNativeDaemonConfig();
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

const selectedNodeId = ref('');
const primaryNode = computed(() => {
  return onlineNodes.value.find(node => node.nodeId === selectedNodeId.value) || onlineNodes.value[0] || null;
});
async function handleFolderOpened(nodeId: string) {
  selectedNodeId.value = nodeId;
  await fetchStatus();
  activeTab.value = 'chat';
}

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

async function switchProject(projectId: string, nodeId?: string) {
  if (!projectId || isSwitchingProject.value || isSending.value) return false;
  isSwitchingProject.value = true;
  switchingProjectId.value = projectId;
  try {
    const res = await fetch(`${coreUrl.value.replace(/\/+$/, "")}/api/filesystem/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken.value
          ? { Authorization: `Bearer ${authToken.value}` }
          : {}),
      },
      body: JSON.stringify({ path: projectId, nodeId: nodeId || primaryNode.value?.nodeId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur HTTP ${res.status}`);
    }
    if (nodeId) selectedNodeId.value = nodeId;
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
    (await switchProject(project.path, project.nodeId))
  ) {
    if (project.nodeId) selectedNodeId.value = project.nodeId;
    showProjectMenu.value = false;
    activeTab.value = "chat";
  }
}

watch([coreUrl, authToken, () => primaryNode.value?.nodeId], () => {
  dashboardController?.abort();
  dashboardController = undefined;
  dashboardLoading.value = false;
  usageDashboard.value = null;
  dashboardError.value = '';
  if ((showSettings.value || activeTab.value === 'agent') && isNodeReady.value) void fetchDashboard();
});
watch([showSettings, settingsSection, isNodeReady, activeTab], ([settings, section, ready, view]) => {
  if (!ready) return;
  if ((settings && section === 'quotas') || view === 'agent') void fetchDashboard();
  if (settings && section === 'persona') void fetchPersonaAndMemory();
  if (settings && section === 'agent') void fetchModelsForBackend(selectedBackend.value);
});

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
const currentProgressMessage = computed(() => getInteractionMessage(
  tasks.value.find(task => task.taskId === currentInFlightTaskId.value), inFlightBackend.value,
));
const runtimeStatus = computed(() => getAssistantState({
  online: isNodeReady.value,
  sending: isSending.value,
  busy: primaryNode.value?.state === "busy",
  backend: isSending.value ? inFlightBackend.value : tasks.value.find(task => task.taskId === primaryNode.value?.activeTaskId)?.backend,
  speaking: isSpeaking.value,
  failed: lastTaskFailed.value,
}));
const runtimeStatusText = computed(() => assistantStateLabels[runtimeStatus.value]);

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
        const activeId = currentInFlightTaskId.value;
        if (activeId) {
          const tracked = data.find((t: RemoteTaskItem) => t.taskId === activeId);
          if (tracked && tracked.status === "completed") {
            const replyContent = tracked.replyText || tracked.text || tracked.result?.text;
            const fileSummary = tracked.fileSummary || tracked.result?.fileSummary;
            const wasFromVoice = voiceTaskIds.has(activeId);
            voiceTaskIds.delete(activeId);
            const existingMsg = messages.value.find((m) => m.id === `asst-${activeId}`);
            if (existingMsg) {
              if (replyContent) existingMsg.text = replyContent;
              existingMsg.fileSummary = fileSummary;
              saveMessages();
            } else if (replyContent) {
              messages.value.push({
                id: `asst-${activeId}`,
                role: "assistant",
                backend: tracked.backend || selectedBackend.value,
                text: replyContent,
                timestamp: tracked.completedAt || Date.now(),
                fileSummary,
              });
              saveMessages();
              scrollToBottom();
              if (
                shouldSpeakReply({
                  enabled: ttsEnabled.value,
                  autoSpeak: autoSpeak.value,
                  fromVoice: wasFromVoice,
                  error: false,
                })
              ) {
                speakMessage(replyContent, `asst-${activeId}`);
              }
            }
            if (!notifiedTaskIds.has(activeId)) {
              notifiedTaskIds.add(activeId);
              void sendSystemNotification(
                "Nexus : Tâche terminée ✅",
                fileSummary || "La tâche demandée a été exécutée avec succès.",
                { dedupKey: `task:${activeId}:completed` }
              );
            }
            isSending.value = false;
            inFlightStartedAt.value = null;
            inFlightBackend.value = null;
            currentInFlightTaskId.value = null;
          } else if (
            tracked &&
            (tracked.status === "failed" || tracked.status === "cancelled")
          ) {
            voiceTaskIds.delete(activeId);
            if (tracked.status === "failed") {
              lastTaskFailed.value = true;
              const errText =
                typeof tracked.error === "string"
                  ? tracked.error
                  : tracked.error?.message || "Échec de la tâche";
              if (!messages.value.some((m) => m.id === `err-${activeId}`)) {
                messages.value.push({
                  id: `err-${activeId}`,
                  role: "assistant",
                  backend: tracked.backend || selectedBackend.value,
                  text: `Erreur : ${errText}`,
                  timestamp: tracked.completedAt || Date.now(),
                  error: true,
                });
                saveMessages();
                scrollToBottom();
              }
              if (!notifiedTaskIds.has(activeId)) {
                notifiedTaskIds.add(activeId);
                void sendSystemNotification(
                  "Nexus : Tâche échouée ❌",
                  errText,
                  { dedupKey: `task:${activeId}:failed` }
                );
              }
            }
            isSending.value = false;
            inFlightStartedAt.value = null;
            inFlightBackend.value = null;
            currentInFlightTaskId.value = null;
          }
        }
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
        for (const item of data) {
          if (item && (item.status === "pending" || !item.status)) {
            notifyApprovalIfNeeded(item);
          }
        }
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
  response?: string,
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
        response,
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

    // Close modal immediately if no more pending approvals remain
    if (pendingApprovals.value.length === 0) {
      showApprovalModal.value = false;
    }

    triggerHaptic(decision === "accept" ? "success" : "cancel");
    showApprovalDecisionToast(
      decision === "accept" ? "accepted" : "declined",
      decision === "accept" ? "Approbation validée" : "Approbation refusée",
      decision === "accept"
        ? "L’action autorisée poursuit son exécution"
        : "L’action demandée a été bloquée"
    );

    // Refresh state from core in background
    void Promise.all([
      fetchApprovals(true),
      fetchStatus(true),
      fetchTasks(true),
    ]);
  } catch (err: any) {
    showApprovalDecisionToast(
      "error",
      "Échec de l’approbation",
      err?.message || "Impossible de transmettre la décision"
    );
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
  const fromVoice = draftFromVoice.value;
  inputPrompt.value = "";
  await sendPrompt(promptText, fromVoice);
}

async function sendPrompt(promptText: string, fromVoice = false) {
  if (!promptText || isSending.value || isSwitchingProject.value) return;
  if (!isNodeReady.value) {
    inputPrompt.value = promptText;
    draftFromVoice.value = fromVoice;
    errorMessage.value =
      "Votre poste est hors ligne. Reconnectez-le pour envoyer votre message.";
    return;
  }

  const backend = selectedBackend.value;
  const generatedTaskId = `task-${Date.now()}`;
  currentInFlightTaskId.value = generatedTaskId;
  if (fromVoice) {
    voiceTaskIds.add(generatedTaskId);
  }

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
  inFlightStartedAt.value = Date.now();
  inFlightBackend.value = backend;
  lastTaskFailed.value = false;
  let keepTrackingInBackground = false;

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
        nodeId: primaryNode.value?.nodeId,
        projectId:
          primaryNode.value?.activeProject?.id || activeProjectName.value,
        wait: true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }

    const replyContent = data.replyText || data.text;
    const alreadyDisplayed = messages.value.some(
      (m) => m.id === `asst-${generatedTaskId}` || (m.role === 'assistant' && m.text === replyContent)
    );
    if (!alreadyDisplayed && replyContent) {
      const assistantMsg: ChatMessage = {
        id: `asst-${generatedTaskId}`,
        role: "assistant",
        backend,
        text: replyContent,
        timestamp: Date.now(),
        fileSummary: data.fileSummary,
      };

      messages.value.push(assistantMsg);
      saveMessages();
      if (shouldSpeakReply({ enabled: ttsEnabled.value, autoSpeak: autoSpeak.value, fromVoice, error: assistantMsg.error })) {
        speakMessage(assistantMsg.text, assistantMsg.id);
      }
    }
  } catch (err: any) {
    // Reconcile with daemon state first: if the mobile OS suspended the long-lived HTTP
    // socket while the app was minimized (e.g. waiting on an approval), the task may still
    // be running or may have already completed on the daemon.
    await Promise.all([fetchTasks(true), fetchApprovals(true)]);
    const stillRunningOnDaemon = tasks.value.some(
      (t) =>
        t.taskId === generatedTaskId &&
        (t.status === "running" || t.status === "pending")
    );
    if (stillRunningOnDaemon) {
      keepTrackingInBackground = true;
      return;
    }
    const alreadyHandled = messages.value.some(
      (m) => m.id === `asst-${generatedTaskId}` || m.id === `err-${generatedTaskId}`
    );
    if (!alreadyHandled) {
      lastTaskFailed.value = true;
      const errorMsg: ChatMessage = {
        id: `err-${generatedTaskId}`,
        role: "assistant",
        backend,
        text: `Erreur : ${err?.message || "Échec de la tâche"}`,
        timestamp: Date.now(),
        error: true,
      };
      messages.value.push(errorMsg);
      saveMessages();
    }
  } finally {
    if (!keepTrackingInBackground) {
      voiceTaskIds.delete(generatedTaskId);
      isSending.value = false;
      inFlightStartedAt.value = null;
      inFlightBackend.value = null;
      currentInFlightTaskId.value = null;
      scrollToBottom();
      void fetchDashboard();
      // Refresh tasks and status
      fetchTasks(true);
      fetchStatus(true);
    }
  }
}

function clearChat() {
  if (confirm("Voulez-vous effacer l’historique de conversation et réinitialiser la session active ?")) {
    messages.value = [];
    lastTaskFailed.value = false;
    if (typeof window !== "undefined") {
      localStorage.removeItem("nexus_brain_messages");
    }
    if (coreUrl.value && isNodeReady.value) {
      const headers = {
        ...getRequestHeaders(),
        "Content-Type": "application/json",
      };
      fetch(`${coreUrl.value.replace(/\/+$/, "")}/api/sessions/reset`, {
        method: "POST",
        headers,
        body: JSON.stringify({ backend: selectedBackend.value }),
      }).catch(() => {});
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
    updateMessagesScrollState();
    updateHomeScrollState();
  });
}

function selectedBackendLabel(b?: string): string {
  if (b === "brain") return "Nexus Brain";
  if (b === "codex") return "Codex";
  if (b === "antigravity") return "Antigravity";
  if (b === "claude") return "Claude Code";
  return "Agent";
}

function handoffToCodingAgent(text: string) {
  workspaceMode.value = "code";
  if (selectedBackend.value === "brain") {
    selectedBackend.value = lastCodingBackend.value || "codex";
  }
  inputPrompt.value = text;
  currentView.value = "workspace";
  activeTab.value = "chat";
  triggerHaptic("medium");
  nextTick(() => {
    resizeComposer();
    chatTextareaRef.value?.focus();
  });
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
          appendTranscript(finalChunk);
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
  draftFromVoice.value = true;
  interimTranscript.value = "";
}

async function runNativeSpeechPopup() {
  await stopSpeaking();
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
  await stopSpeaking();
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
  if (fcmToken.value) {
    void sendTokenToDaemon(fcmToken.value);
  }
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
  return onlineNodes.value.some(node =>
    (!project.nodeId || node.nodeId === project.nodeId) &&
    (node.activeProject?.path === project.path || Boolean(project.id && node.activeProject?.id === project.id)),
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
