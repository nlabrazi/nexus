<template>
  <section class="usage-dashboard" aria-label="Agents, modèles et quotas">
    <div class="dashboard-toolbar">
      <div><p class="eyebrow">VOTRE SESSION</p><h3>{{ agentLabel }}</h3><p class="dashboard-caption">{{ modelLabel || 'Modèle à confirmer par le poste' }}</p></div>
      <button class="icon-button" type="button" :disabled="loading || !online" aria-label="Actualiser les quotas" @click="$emit('refresh')"><NexusIcon name="refresh" :class="{ 'is-refreshing': loading }" /></button>
    </div>
    <p v-if="!online" class="dashboard-notice" role="status">Poste hors ligne. Les relevés conservés ne décrivent pas son état actuel.</p>
    <div v-if="error" class="inline-error" role="alert"><p>{{ error }}</p><button v-if="online" type="button" class="text-button" :disabled="loading" @click="$emit('refresh')">Réessayer</button></div>
    <div v-if="loading && !dashboard" class="dashboard-skeleton" role="status"><span /><span /><p>Lecture des informations du poste…</p></div>
    <template v-if="dashboard">
      <section class="brain-overview">
        <div class="dashboard-card-heading"><h4>Nexus Brain</h4><span class="usage-badge">{{ dashboard.brain.selection === 'auto' ? 'Automatique' : 'Choix fixe' }}</span></div>
        <p class="brain-selection">{{ dashboard.brain.selection === 'auto' ? 'Repli entre les fournisseurs configurés' : dashboard.brain.selection }}</p>
        <div v-if="dashboard.brain.active && online && !error" class="brain-current" role="status"><span class="activity-wave" aria-hidden="true"><i /><i /><i /></span><div><small>En cours · {{ dashboard.brain.active.provider }}</small><strong>{{ dashboard.brain.active.model }}</strong></div></div>
        <div v-if="dashboard.brain.lastUsed" class="brain-last"><small>Dernière réponse · {{ dashboard.brain.lastUsed.provider }}</small><strong>{{ dashboard.brain.lastUsed.model }}</strong><span>{{ (dashboard.brain.lastUsed.durationMs / 1000).toFixed(1) }} s · {{ time(dashboard.brain.lastUsed.completedAt) }}</span></div>
        <p v-else-if="!dashboard.brain.active" class="dashboard-caption">Aucune réponse observée depuis le démarrage.</p>
      </section>
      <div class="dashboard-section-heading"><h4>Fournisseurs Brain</h4><small>Consommation depuis {{ time(dashboard.startedAt) }}</small></div>
      <p class="dashboard-caption">Les tokens ci-dessous sont mesurés par Nexus. Les quotas restants viennent des fournisseurs et peuvent inclure vos autres applications.</p>
      <p v-if="!dashboard.brain.providers.length" class="dashboard-caption">Ce moteur Brain ne transmet pas de relevés par fournisseur.</p>
      <div class="provider-grid">
        <section v-for="provider in dashboard.brain.providers" :key="provider.provider" class="provider-card" :class="{ 'not-configured': !provider.configured }">
          <div class="dashboard-card-heading"><h4>{{ provider.provider === 'ollama' ? 'Ollama' : provider.provider }}</h4><span class="usage-badge" :class="{ enabled: provider.configured }">{{ provider.provider === 'ollama' ? 'Local' : provider.configured ? 'Configuré' : 'Clé absente' }}</span></div>
          <p class="provider-model">{{ provider.model }}</p>
          <template v-if="provider.configured">
            <div class="provider-counters"><div><strong>{{ formatCount(provider.requests) }}</strong><small>appels observés</small></div><div><strong>{{ provider.measuredRequests ? formatCount(provider.totalTokens) : '—' }}</strong><small>tokens mesurés</small></div><div v-if="provider.lastDurationMs !== undefined"><strong>{{ (provider.lastDurationMs / 1000).toFixed(1) }} s</strong><small>dernier appel</small></div></div>
            <p v-if="provider.lastStatus" class="provider-status">{{ statusLabel(provider.lastStatus) }}</p>
            <NexusQuota v-for="metric in provider.limits" :key="metric.id" :metric="metric" :now="now" />
            <p v-if="!provider.limits.length" class="dashboard-caption">{{ provider.provider === 'ollama' ? 'Pas de quota cloud. Capacité liée à votre machine.' : 'Quota restant non communiqué.' }}</p>
            <p v-if="provider.quotaStatus === 'unavailable'" class="dashboard-caption">Actualisation du compte indisponible ; les anciens relevés sont conservés.</p>
          </template>
          <p v-else class="dashboard-caption">À configurer sur le poste Nexus.</p>
          <a v-if="provider.accountUrl?.startsWith('https://')" :href="provider.accountUrl" target="_blank" rel="noopener noreferrer" class="account-link">Ouvrir le compte {{ provider.provider }} ↗</a>
        </section>
      </div>
      <div class="dashboard-section-heading"><h4>Agents de code</h4><small>Sessions du poste</small></div>
      <section v-for="agent in dashboard.agents" :key="agent.id" class="provider-card">
        <div class="dashboard-card-heading"><h4>{{ agent.id === 'codex' ? 'Codex' : 'Antigravity' }}</h4><span class="usage-badge">{{ agent.state === 'running' ? 'En cours' : agent.state === 'ready' ? 'Session active' : 'Arrêté' }}</span></div>
        <p class="provider-model">{{ agent.model || 'Modèle non communiqué' }}</p>
        <p class="dashboard-caption">{{ agent.totalTokens === undefined ? 'Consommation non communiquée par cet agent.' : `${formatCount(agent.totalTokens)} tokens dans la session` }}</p>
        <NexusQuota v-for="metric in agent.limits" :key="metric.id" :metric="metric" :now="now" />
        <p v-if="!agent.limits.length" class="dashboard-caption">Quota d’abonnement non communiqué par cet agent.</p>
      </section>
      <p class="dashboard-footnote">Actualisé à {{ time(dashboard.generatedAt) }}. Les fenêtres en heures indiquent le renouvellement d’un quota, pas un nombre d’heures de travail disponibles. Les compteurs Nexus repartent à zéro au redémarrage.</p>
    </template>
    <p v-else-if="!loading && !error" class="dashboard-caption">{{ online ? 'Les informations de session n’ont pas encore été chargées.' : 'Connectez votre poste pour consulter les modèles et les quotas.' }}</p>
  </section>
</template>
<script setup lang="ts">
import NexusQuota from './NexusQuota.vue';
import NexusIcon from './NexusIcon.vue';
import type { RuntimeDashboard } from '../../../src/runtime/dashboard-types';
import { formatCount } from '../utils/usage-dashboard.mjs';
defineProps<{ dashboard: RuntimeDashboard | null; loading: boolean; error: string; online: boolean; agentLabel: string; modelLabel: string; now: number }>();
defineEmits<{ refresh: [] }>();
const time = (value: number) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const statusLabel = (value: string) => ({ success: 'Dernier appel réussi', running: 'Réponse en cours', rate_limited: 'Limite atteinte', quota_exhausted: 'Quota épuisé', authentication: 'Clé à vérifier', configuration: 'Configuration à vérifier', unavailable: 'Service indisponible', timeout: 'Délai dépassé', cancelled: 'Appel annulé', invalid_response: 'Réponse invalide', refused: 'Demande refusée', network: 'Erreur réseau', failed: 'Dernier appel en échec' }[value] || 'État non communiqué');
</script>
