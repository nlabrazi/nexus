import { nextTick, type Ref, ref } from 'vue';
import { type ChatMessage, type NodeInfo, selectedBackendLabel } from '../types/nexus';
import { getProjectStorageKey, serializeChatForUpstash } from '../utils/chat-history.mjs';
import { formatHandoffPrompt, resolveHandoffBackend } from '../utils/handoff.mjs';
import { triggerHaptic } from '../utils/haptics.mjs';

export interface UseChatHistoryOptions {
  messages: Ref<ChatMessage[]>;
  lastTaskFailed: Ref<boolean>;
  coreUrl: Ref<string>;
  isNodeReady: Ref<boolean>;
  primaryNode: Ref<NodeInfo | null>;
  selectedBackend: Ref<'brain' | 'codex' | 'antigravity' | 'claude'>;
  workspaceMode: Ref<'brain' | 'code'>;
  lastCodingBackend: Ref<'codex' | 'antigravity' | 'claude'>;
  inputPrompt: Ref<string>;
  currentView: Ref<'home' | 'workspace'>;
  activeTab: Ref<'chat' | 'agent' | 'activity' | 'system' | 'dashboard'>;
  chatTextareaRef: Ref<HTMLTextAreaElement | null>;
  apiUrl: () => string;
  getRequestHeaders: () => Record<string, string>;
  scrollToBottom: () => void;
  resizeComposer: () => void;
}

export function useChatHistory(options: UseChatHistoryOptions) {
  const {
    messages,
    lastTaskFailed,
    coreUrl,
    isNodeReady,
    primaryNode,
    selectedBackend,
    workspaceMode,
    lastCodingBackend,
    inputPrompt,
    currentView,
    activeTab,
    chatTextareaRef,
    apiUrl,
    getRequestHeaders,
    scrollToBottom,
    resizeComposer,
  } = options;

  let syncChatTimer: ReturnType<typeof setTimeout> | null = null;
  const handoffNoticeMsg = ref('');

  function clearChat() {
    if (
      confirm(
        'Voulez-vous effacer l’historique de conversation et réinitialiser la session active ?'
      )
    ) {
      messages.value = [];
      lastTaskFailed.value = false;
      const targetProj =
        primaryNode.value?.activeProject?.path || primaryNode.value?.activeProject?.name || '';
      const projKey = getProjectStorageKey(targetProj);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`nexus_chat_${projKey}`);
        localStorage.removeItem('nexus_brain_messages');
      }
      if (coreUrl.value) {
        const targetUrl = `${apiUrl()}/api/chat/history${targetProj ? `?project=${encodeURIComponent(targetProj)}` : ''}`;
        fetch(targetUrl, {
          method: 'DELETE',
          headers: getRequestHeaders(),
        }).catch(() => {});
      }
      if (coreUrl.value && isNodeReady.value) {
        const headers = {
          ...getRequestHeaders(),
          'Content-Type': 'application/json',
        };
        fetch(`${apiUrl()}/api/sessions/reset`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ backend: selectedBackend.value }),
        }).catch(() => {});
      }
    }
  }

  function loadPersistedMessages(projectPath?: string) {
    if (typeof window === 'undefined') return;
    const targetProj =
      projectPath ||
      primaryNode.value?.activeProject?.path ||
      primaryNode.value?.activeProject?.name ||
      '';
    const projKey = getProjectStorageKey(targetProj);
    try {
      const raw =
        localStorage.getItem(`nexus_chat_${projKey}`) ||
        localStorage.getItem('nexus_brain_messages');
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
    const targetProj =
      primaryNode.value?.activeProject?.path || primaryNode.value?.activeProject?.name || '';
    const projKey = getProjectStorageKey(targetProj);
    const trimmed = serializeChatForUpstash(messages.value, 50);
    try {
      localStorage.setItem(`nexus_chat_${projKey}`, JSON.stringify(trimmed));
      localStorage.setItem('nexus_brain_messages', JSON.stringify(trimmed));
    } catch {}

    if (!coreUrl.value) return;
    if (syncChatTimer) clearTimeout(syncChatTimer);
    syncChatTimer = setTimeout(async () => {
      try {
        const targetUrl = `${apiUrl()}/api/chat/history`;
        await fetch(targetUrl, {
          method: 'POST',
          headers: {
            ...getRequestHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project: targetProj,
            messages: trimmed,
          }),
        });
      } catch {
        // Non-blocking offline fallback
      }
    }, 800);
  }

  async function fetchChatHistoryFromServer(projectPath?: string) {
    if (!coreUrl.value) return;
    try {
      const targetProj =
        projectPath ||
        primaryNode.value?.activeProject?.path ||
        primaryNode.value?.activeProject?.name ||
        '';
      const targetUrl = `${apiUrl()}/api/chat/history${targetProj ? `?project=${encodeURIComponent(targetProj)}` : ''}`;
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: getRequestHeaders(),
      });
      if (res.ok) {
        const serverMsgs = (await res.json()) as ChatMessage[];
        if (Array.isArray(serverMsgs) && serverMsgs.length > 0) {
          messages.value = serverMsgs;
          const projKey = getProjectStorageKey(targetProj);
          if (typeof window !== 'undefined') {
            localStorage.setItem(`nexus_chat_${projKey}`, JSON.stringify(serverMsgs));
            localStorage.setItem('nexus_brain_messages', JSON.stringify(serverMsgs));
          }
          scrollToBottom();
        }
      }
    } catch {
      // Non-blocking offline fallback
    }
  }

  function handoffToCodingAgent(text: string) {
    workspaceMode.value = 'code';
    const targetBackend = resolveHandoffBackend(
      selectedBackend.value,
      lastCodingBackend.value,
      'codex'
    );
    selectedBackend.value = targetBackend;
    inputPrompt.value = formatHandoffPrompt(text);
    currentView.value = 'workspace';
    activeTab.value = 'chat';
    handoffNoticeMsg.value = `✓ Proposition transmise à ${selectedBackendLabel(targetBackend)}`;
    setTimeout(() => {
      handoffNoticeMsg.value = '';
    }, 3500);
    void triggerHaptic('press');
    nextTick(() => {
      resizeComposer();
      chatTextareaRef.value?.focus();
      scrollToBottom();
    });
  }

  return {
    handoffNoticeMsg,
    clearChat,
    loadPersistedMessages,
    saveMessages,
    fetchChatHistoryFromServer,
    handoffToCodingAgent,
  };
}
