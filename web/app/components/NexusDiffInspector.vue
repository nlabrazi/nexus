<template>
  <div
    v-if="(msg.filesChanged && msg.filesChanged.length > 0) || msg.diff || msg.fileSummary"
    class="diff-inspector-container"
  >
    <button type="button" class="diff-toggle-bar" @click="$emit('toggle', msg)">
      <div class="diff-toggle-left">
        <NexusIcon name="folder" />
        <span class="diff-summary-title">{{ summaryLabel }}</span>
      </div>
      <div class="diff-toggle-right">
        <span class="diff-toggle-pill">
          {{ open ? 'Masquer le diff ▲' : 'Voir le diff ▼' }}
        </span>
      </div>
    </button>

    <div v-if="open" class="diff-inspector-body">
      <div v-if="loading" class="diff-loading">
        <span class="activity-wave"><i /><i /><i /></span>
        <span>Chargement du diff…</span>
      </div>
      <div v-else-if="parsedFiles.length === 0" class="diff-fallback-view">
        <p v-if="msg.fileSummary" class="diff-fallback-text">{{ msg.fileSummary }}</p>
        <p v-else class="diff-fallback-empty">Aucune modification git détectée pour cette tâche.</p>
      </div>
      <div v-else class="diff-files-list">
        <div v-for="file in parsedFiles" :key="file.filePath" class="diff-file-card">
          <div class="diff-file-header">
            <span class="diff-file-name">{{ file.filePath }}</span>
            <span class="diff-file-badge">
              <span v-if="file.additions > 0" class="diff-stat add">+{{ file.additions }}</span>
              <span v-if="file.deletions > 0" class="diff-stat del">-{{ file.deletions }}</span>
            </span>
          </div>
          <div class="diff-hunks-container">
            <div v-for="(hunk, hIdx) in file.hunks" :key="hIdx" class="diff-hunk-block">
              <div class="diff-hunk-header">{{ hunk.header }}</div>
              <div
                v-for="(line, lIdx) in hunk.lines"
                :key="lIdx"
                class="diff-code-line"
                :class="line.type"
              >
                <span class="diff-line-marker">{{
                  line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
                }}</span>
                <span class="diff-line-content">{{ line.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessage } from '../types/nexus';

defineProps<{
  msg: ChatMessage;
  open: boolean;
  loading: boolean;
  summaryLabel: string;
  parsedFiles: Array<{
    filePath: string;
    additions: number;
    deletions: number;
    hunks: Array<{
      header: string;
      lines: Array<{ type: string; text: string }>;
    }>;
  }>;
}>();

defineEmits<{
  (e: 'toggle', msg: ChatMessage): void;
}>();
</script>

