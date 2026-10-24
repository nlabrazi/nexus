<template>
  <div class="agent-model-sheet">
    <div class="sheet-section-title">{{ sectionTitle }}</div>
    <div class="agent-sheet-list">
      <button
        v-for="agent in agentOptions"
        :key="agent.id"
        type="button"
        class="agent-card-row"
        :class="{ selected: selectedBackend === agent.id }"
        @click="$emit('select-backend', agent.id)"
      >
        <div class="agent-card-icon">
          <NexusIcon
            :name="
              agent.id === 'brain'
                ? 'sparkles'
                : agent.id === 'codex'
                  ? 'zap'
                  : agent.id === 'claude'
                    ? 'cpu'
                    : 'branch'
            "
          />
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

    <div class="sheet-section-title model-section-title" style="margin-top: 14px">
      <span>MODÈLE ({{ selectedBackendShortLabel(selectedBackend) }})</span>
      <span v-if="isLoadingModels" class="model-loading-spinner">Chargement…</span>
    </div>

    <div v-if="models.length" class="models-sheet-list">
      <button
        v-for="m in models"
        :key="m.id || m.model"
        type="button"
        class="model-card-row"
        :class="{ selected: selectedModel === m.model }"
        @click="$emit('select-model', m.model)"
      >
        <div class="model-card-info">
          <div class="model-card-name">{{ m.displayName || m.model }}</div>
          <div v-if="m.description" class="model-card-desc">{{ m.description }}</div>
        </div>
        <span v-if="selectedModel === m.model" class="agent-selected-badge">
          <NexusIcon name="check" />
        </span>
      </button>
    </div>
    <div v-else-if="!isLoadingModels" class="models-empty-note">
      <span>Modèle par défaut actif ({{ selectedModel || 'automatique' }}).</span>
    </div>

    <div v-if="efforts.length > 1" style="margin-top: 14px">
      <div class="sheet-section-title">EFFORT DE RAISONNEMENT</div>
      <div class="effort-pills-row">
        <button
          v-for="eff in efforts"
          :key="eff.reasoningEffort"
          type="button"
          class="effort-pill-btn"
          :class="{ active: selectedEffort === eff.reasoningEffort }"
          @click="$emit('select-model', selectedModel, eff.reasoningEffort)"
        >
          <strong>{{ eff.reasoningEffort.toUpperCase() }}</strong>
          <small v-if="eff.description"> {{ eff.description }}</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  agentOptions,
  selectedBackendShortLabel,
  type ModelItem,
} from '../types/nexus';

withDefaults(
  defineProps<{
    sectionTitle?: string;
    selectedBackend: 'codex' | 'antigravity' | 'claude' | 'brain';
    models: ModelItem[];
    selectedModel: string;
    selectedEffort: string;
    efforts: Array<{ reasoningEffort: string; description: string }>;
    isLoadingModels: boolean;
  }>(),
  {
    sectionTitle: 'AGENT IA',
  }
);

defineEmits<{
  (e: 'select-backend', backend: 'codex' | 'antigravity' | 'claude' | 'brain'): void;
  (e: 'select-model', model: string, effort?: string): void;
}>();
</script>

