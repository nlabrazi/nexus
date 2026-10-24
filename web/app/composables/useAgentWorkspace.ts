import { computed, type Ref, ref } from 'vue';
import type { RuntimeDashboard } from '../../../src/runtime/dashboard-types';
import type { ModelItem, NodeInfo } from '../types/nexus';
import { triggerHaptic } from '../utils/haptics.mjs';

export interface UseAgentWorkspaceOptions {
  coreUrl: Ref<string>;
  isNodeReady: Ref<boolean>;
  primaryNode: Ref<NodeInfo | null>;
  selectedBackend: Ref<'brain' | 'codex' | 'antigravity' | 'claude'>;
  workspaceMode: Ref<'brain' | 'code'>;
  lastCodingBackend: Ref<'codex' | 'antigravity' | 'claude'>;
  errorMessage: Ref<string>;
  apiUrl: () => string;
  getRequestHeaders: () => Record<string, string>;
}

export function useAgentWorkspace(options: UseAgentWorkspaceOptions) {
  const {
    coreUrl,
    isNodeReady,
    primaryNode,
    selectedBackend,
    workspaceMode,
    lastCodingBackend,
    errorMessage,
    apiUrl,
    getRequestHeaders,
  } = options;

  const usageDashboard = ref<RuntimeDashboard | null>(null);
  const dashboardLoading = ref(false);
  const dashboardError = ref('');
  let dashboardFetchedAt = 0;
  let dashboardController: AbortController | undefined;

  const agentModels = ref<
    Record<string, { models: ModelItem[]; selected?: string; selectedEffort?: string }>
  >({
    brain: { models: [], selected: '', selectedEffort: '' },
    codex: { models: [], selected: '', selectedEffort: 'high' },
    antigravity: { models: [], selected: '', selectedEffort: '' },
    claude: { models: [], selected: 'claude-sonnet-4-6', selectedEffort: 'high' },
  });
  const isLoadingModels = ref<boolean>(false);

  const currentBackendModels = computed(() => {
    return agentModels.value[selectedBackend.value]?.models || [];
  });

  const currentSelectedModel = computed(() => {
    return agentModels.value[selectedBackend.value]?.selected || '';
  });

  const currentSelectedEffort = computed(() => {
    return agentModels.value[selectedBackend.value]?.selectedEffort || 'high';
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
    const actual = usageDashboard.value?.agents.find(
      (agent) => agent.id === selectedBackend.value
    )?.model;
    return (
      actual ||
      currentBackendModels.value.find((model) => model.model === currentSelectedModel.value)
        ?.displayName ||
      currentSelectedModel.value
    );
  });

  // Persona & Memory State (Upstash synced)
  const personaInput = ref<string>('');
  const projectPreferencesInput = ref<string>('');
  const projectMemoryInput = ref<string>('');
  const isLoadingPersona = ref<boolean>(false);
  const isSavingPersona = ref<boolean>(false);
  const personaStatusMsg = ref<string>('');

  async function fetchPersonaAndMemory() {
    if (!coreUrl.value || !isNodeReady.value) return;
    isLoadingPersona.value = true;
    personaStatusMsg.value = '';
    try {
      const base = apiUrl();
      const headers = getRequestHeaders();
      const activePath = primaryNode.value?.activeProject?.path;
      const query = activePath ? `?path=${encodeURIComponent(activePath)}` : '';
      const personaRes = await fetch(`${base}/api/persona${query}`, { headers });
      if (personaRes.ok) {
        const pData = await personaRes.json();
        personaInput.value = pData.persona ?? '';
        projectPreferencesInput.value = pData.projectPreferences ?? '';
        projectMemoryInput.value = pData.projectMemory ?? '';
      }
    } catch (err) {
      console.warn('[Persona] Échec du chargement Persona/Mémoire:', err);
    } finally {
      isLoadingPersona.value = false;
    }
  }

  async function savePersonaAndMemory() {
    if (!coreUrl.value || isSavingPersona.value) return;
    isSavingPersona.value = true;
    personaStatusMsg.value = '';
    try {
      const base = apiUrl();
      const headers = {
        ...getRequestHeaders(),
        'Content-Type': 'application/json',
      };
      const activePath = primaryNode.value?.activeProject?.path;
      const pRes = await fetch(`${base}/api/persona`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectPath: activePath || undefined,
          persona: personaInput.value,
          projectPreferences: projectPreferencesInput.value,
          projectMemory: projectMemoryInput.value,
        }),
      });
      if (pRes.ok) {
        const saved = await pRes.json().catch(() => null);
        if (saved && typeof saved === 'object') {
          if (typeof saved.persona === 'string') personaInput.value = saved.persona;
          if (typeof saved.projectPreferences === 'string') {
            projectPreferencesInput.value = saved.projectPreferences;
          }
          if (typeof saved.projectMemory === 'string') {
            projectMemoryInput.value = saved.projectMemory;
          }
        }
        personaStatusMsg.value = '✓ Sauvegardé et synchronisé sur Upstash';
        triggerHaptic('success');
      } else {
        personaStatusMsg.value = '⚠ Erreur lors de la sauvegarde.';
      }
    } catch {
      personaStatusMsg.value = '⚠ Impossible de joindre le serveur Nexus.';
    } finally {
      isSavingPersona.value = false;
    }
  }

  async function fetchDashboard() {
    if (dashboardLoading.value) return;
    if (!coreUrl.value || !isNodeReady.value) {
      dashboardError.value =
        'Connectez votre poste dans Voix & connexion pour consulter ses informations.';
      return;
    }
    dashboardLoading.value = true;
    dashboardError.value = '';
    dashboardFetchedAt = Date.now();
    const controller = new AbortController();
    dashboardController = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const query = primaryNode.value?.nodeId
        ? `?nodeId=${encodeURIComponent(primaryNode.value.nodeId)}`
        : '';
      const response = await fetch(`${apiUrl()}/api/dashboard${query}`, {
        headers: getRequestHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? 'Renseignez le jeton Nexus dans Voix & connexion pour consulter les quotas.'
            : response.status === 404
              ? 'Mettez à jour Nexus pour consulter cet aperçu.'
              : 'Le poste ne peut pas fournir ses quotas.'
        );
      }
      const data = await response.json();
      if (dashboardController !== controller) return;
      if (!data?.brain || !Array.isArray(data.brain.providers) || !Array.isArray(data.agents)) {
        throw new Error('Mettez à jour Nexus pour afficher les informations de session.');
      }
      usageDashboard.value = data;
    } catch (error: any) {
      if (dashboardController === controller) {
        dashboardError.value = controller.signal.aborted
          ? 'Le poste ne répond pas dans le délai prévu. Réessayez.'
          : error?.message || 'Impossible d’actualiser les quotas.';
      }
    } finally {
      clearTimeout(timer);
      if (dashboardController === controller) {
        dashboardLoading.value = false;
        dashboardController = undefined;
      }
    }
  }

  function resetDashboardState() {
    dashboardController?.abort();
    dashboardController = undefined;
    dashboardLoading.value = false;
    usageDashboard.value = null;
    dashboardError.value = '';
  }

  function shouldPollDashboard() {
    return Date.now() - dashboardFetchedAt > 5000;
  }

  async function fetchModelsForBackend(backend: 'brain' | 'codex' | 'antigravity' | 'claude') {
    if (!coreUrl.value) return;
    isLoadingModels.value = true;
    try {
      const res = await fetch(`${apiUrl()}/api/models?backend=${backend}`, {
        headers: getRequestHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          agentModels.value[backend] = {
            models: data.models,
            selected:
              data.selected?.model ||
              agentModels.value[backend]?.selected ||
              data.models[0]?.model,
            selectedEffort:
              data.selected?.effort ||
              agentModels.value[backend]?.selectedEffort ||
              data.models[0]?.defaultReasoningEffort ||
              'high',
          };
        }
      }
    } catch (err) {
      console.warn(`[Models] Échec du chargement des modèles (${backend}):`, err);
    } finally {
      isLoadingModels.value = false;
    }
  }

  async function handleSelectBackend(backend: 'brain' | 'codex' | 'antigravity' | 'claude') {
    selectedBackend.value = backend;
    if (backend === 'brain') {
      workspaceMode.value = 'brain';
    } else {
      workspaceMode.value = 'code';
      lastCodingBackend.value = backend;
    }
    triggerHaptic('release');
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
      headers['Content-Type'] = 'application/json';
      const res = await fetch(`${apiUrl()}/api/models/select`, {
        method: 'POST',
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
        triggerHaptic('press');
      } else {
        errorMessage.value =
          'Impossible de sélectionner ce modèle. Vérifiez sa configuration sur le poste Nexus.';
      }
    } catch {
      errorMessage.value = 'Impossible de joindre le poste pour changer de modèle.';
    }
  }

  return {
    usageDashboard,
    dashboardLoading,
    dashboardError,
    agentModels,
    isLoadingModels,
    currentBackendModels,
    currentSelectedModel,
    currentSelectedEffort,
    currentModelEfforts,
    selectedModelLabel,
    personaInput,
    projectPreferencesInput,
    projectMemoryInput,
    isLoadingPersona,
    isSavingPersona,
    personaStatusMsg,
    fetchPersonaAndMemory,
    savePersonaAndMemory,
    fetchDashboard,
    resetDashboardState,
    shouldPollDashboard,
    fetchModelsForBackend,
    handleSelectBackend,
    handleSelectModel,
  };
}
