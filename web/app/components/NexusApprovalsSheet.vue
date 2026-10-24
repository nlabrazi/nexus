<template>
  <NexusSheet
    :model-value="modelValue"
    title="Autorisation requise"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="activeApproval" class="approval-content">
      <div class="approval-heading">
        <NexusIcon name="shield" />
        <span>
          {{ activeApproval.agentName }}
          <small>{{ formatApprovalKind(activeApproval.kind) }}</small>
        </span>
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

        <div
          v-if="activeApprovalParsed.files && activeApprovalParsed.files.length"
          class="approval-parsed-item"
        >
          <span class="approval-parsed-label">
            {{
              activeApprovalParsed.files.length > 1
                ? 'Fichiers concernés :'
                : 'Fichier concerné :'
            }}
          </span>
          <ul class="approval-files-list">
            <li
              v-for="(file, fIdx) in activeApprovalParsed.files"
              :key="fIdx"
              class="approval-file-entry"
            >
              <code>{{ file.path }}</code>
            </li>
          </ul>
        </div>

        <div v-if="activeApprovalParsed.network" class="approval-parsed-item">
          <span class="approval-parsed-label">Accès réseau :</span>
          <pre class="approval-code"><code>{{ activeApprovalParsed.network.protocol ? `${activeApprovalParsed.network.protocol}://` : '' }}{{ activeApprovalParsed.network.host }}</code></pre>
        </div>

        <div
          v-if="activeApprovalParsed.questions && activeApprovalParsed.questions.length"
          class="approval-questions"
        >
          <div
            v-for="(q, qIdx) in activeApprovalParsed.questions"
            :key="qIdx"
            class="question-block"
          >
            <p class="question-title">
              <strong>{{ q.question }}</strong>
            </p>
            <div class="question-options">
              <button
                v-for="(opt, optIdx) in q.options"
                :key="optIdx"
                type="button"
                class="button secondary compact-btn"
                @click="$emit('decide', activeApproval.approvalId, 'accept', opt)"
              >
                {{ opt }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p
        class="approval-expiry"
        :class="{
          danger: remainingSeconds <= 15,
        }"
      >
        {{
          expired
            ? 'Demande expirée. L’action a été refusée.'
            : `Refus automatique dans ${remainingSeconds} s.`
        }}
      </p>
      <div v-if="pendingCount > 1" class="approval-pagination">
        <button
          type="button"
          class="icon-button"
          :disabled="activeIndex === 0"
          aria-label="Demande précédente"
          @click="$emit('update:activeIndex', activeIndex - 1)"
        >
          <NexusIcon name="chevron" class="reversed" />
        </button>
        <span>{{ activeIndex + 1 }} / {{ pendingCount }}</span>
        <button
          type="button"
          class="icon-button"
          :disabled="activeIndex >= pendingCount - 1"
          aria-label="Demande suivante"
          @click="$emit('update:activeIndex', activeIndex + 1)"
        >
          <NexusIcon name="chevron" />
        </button>
      </div>
      <div class="approval-actions">
        <button
          type="button"
          class="button secondary"
          :disabled="isDeciding || expired"
          @click="$emit('decide', activeApproval.approvalId, 'decline')"
        >
          Refuser
        </button>
        <button
          type="button"
          class="button primary"
          :disabled="isDeciding || expired"
          @click="$emit('decide', activeApproval.approvalId, 'accept')"
        >
          {{ isDeciding ? 'Envoi…' : 'Autoriser' }}
        </button>
      </div>
    </div>
    <div v-else class="empty-state compact">
      <NexusIcon name="check" />
      <h3>Aucune demande en attente</h3>
    </div>
  </NexusSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatApprovalKind, type PendingApprovalItem } from '../types/nexus';

const props = defineProps<{
  modelValue: boolean;
  activeApproval: PendingApprovalItem | null;
  activeApprovalParsed: any;
  pendingCount: number;
  activeIndex: number;
  isDeciding: boolean;
  now: number;
}>();

defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:activeIndex', value: number): void;
  (e: 'decide', approvalId: string, decision: 'accept' | 'decline', response?: string): void;
}>();

const remainingSeconds = computed(() => {
  const expiresAt = props.activeApproval?.expiresAt;
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - props.now) / 1000));
});

const expired = computed(() => {
  const expiresAt = props.activeApproval?.expiresAt;
  if (!expiresAt) return false;
  return props.now >= expiresAt;
});
</script>

