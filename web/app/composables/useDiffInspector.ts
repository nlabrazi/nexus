import { ref, type Ref } from 'vue';
import { parseUnifiedDiff, summarizeDiff } from '../utils/diff-viewer.mjs';
import { triggerHaptic } from '../utils/haptics.mjs';
import type { ChatMessage } from '../types/nexus';

export function useDiffInspector(options: {
  coreUrl: Ref<string>;
  apiUrl: (path?: string) => string;
  getRequestHeaders: () => Record<string, string>;
  saveMessages: () => void;
}) {
  const { coreUrl, apiUrl, getRequestHeaders, saveMessages } = options;

  const expandedDiffs = ref<Record<string, boolean>>({});
  const diffCache = ref<Record<string, string>>({});
  const loadingDiffs = ref<Record<string, boolean>>({});

  function isDiffOpen(id: string): boolean {
    return Boolean(expandedDiffs.value[id]);
  }

  function getParsedDiffForMessage(msg: ChatMessage) {
    const raw = msg.diff || diffCache.value[msg.id] || '';
    return parseUnifiedDiff(raw);
  }

  function getDiffSummaryLabel(msg: ChatMessage): string {
    const parsed = getParsedDiffForMessage(msg);
    if (parsed.length > 0) return summarizeDiff(parsed).label;
    if (msg.filesChanged && msg.filesChanged.length > 0) {
      return `${msg.filesChanged.length} fichier${msg.filesChanged.length > 1 ? 's' : ''} modifié${msg.filesChanged.length > 1 ? 's' : ''}`;
    }
    return msg.fileSummary || 'Fichiers modifiés';
  }

  async function toggleDiffForMessage(msg: ChatMessage) {
    const currentlyOpen = isDiffOpen(msg.id);
    expandedDiffs.value[msg.id] = !currentlyOpen;
    triggerHaptic('selection');
    if (currentlyOpen) return;

    if (msg.diff || diffCache.value[msg.id]) return;

    if (msg.taskId && coreUrl.value) {
      loadingDiffs.value[msg.id] = true;
      try {
        const targetUrl = `${apiUrl()}/api/tasks/${encodeURIComponent(msg.taskId)}/diff`;
        const res = await fetch(targetUrl, { headers: getRequestHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.diff) {
            diffCache.value[msg.id] = data.diff;
            msg.diff = data.diff;
            saveMessages();
          }
        }
      } catch {
      } finally {
        loadingDiffs.value[msg.id] = false;
      }
    }
  }

  return {
    expandedDiffs,
    diffCache,
    loadingDiffs,
    isDiffOpen,
    getParsedDiffForMessage,
    getDiffSummaryLabel,
    toggleDiffForMessage,
  };
}

