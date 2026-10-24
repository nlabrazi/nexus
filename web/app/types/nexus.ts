export interface ConnectedNodeInfo {
  nodeId: string;
  nodeName: string;
  online: boolean;
  state: 'idle' | 'busy' | 'offline';
  lastHeartbeat?: number;
  activeTaskId?: string;
  activeProject?: {
    id?: string;
    name: string;
    path: string;
    currentBranch?: string;
  };
}

export interface ProjectInfo {
  id?: string;
  name: string;
  path: string;
  nodeId?: string;
  currentBranch?: string;
  lastActive?: number;
  isActive?: boolean;
}

export interface CoreStatusData {
  uptimeSeconds: number;
  totalNodes: number;
  onlineNodes: number;
  nodes: ConnectedNodeInfo[];
  projects: ProjectInfo[];
  activeTasks?: number;
  pendingApprovals?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  backend: 'brain' | 'codex' | 'antigravity' | 'claude';
  text: string;
  timestamp: number;
  fileSummary?: string;
  filesChanged?: readonly string[];
  diff?: string;
  taskId?: string;
  error?: boolean;
}

export interface RemoteTaskItem {
  taskId: string;
  backend: 'codex' | 'antigravity' | 'claude' | 'brain';
  prompt: string;
  projectId?: string;
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  stage?: string;
  progressMessage?: string;
  activeTool?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  replyText?: string;
  text?: string;
  fileSummary?: string;
  filesChanged?: string[];
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

export interface PendingApprovalItem {
  approvalId: string;
  taskId: string;
  nodeId: string;
  agentName: string;
  kind: 'command' | 'fileChange' | 'consent';
  toolName?: string;
  summary?: string;
  details: string;
  expiresAt: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'timed_out';
  decidedAt?: number;
  decidedBy?: string;
  decision?: 'accept' | 'decline';
  cancelReason?: string;
}

export interface ModelItem {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  context?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort?: string;
}

export interface VoiceBackendStatus {
  available: boolean;
  engine?: string;
  provider?: string;
  language?: string;
  tts?: {
    provider?: 'fish' | 'system';
    fishAudioAvailable?: boolean;
    hasApiKey?: boolean;
    referenceId?: string;
    model?: string;
  };
}

export const agentOptions = [
  {
    id: 'codex' as const,
    name: 'Codex',
    description: 'Modèle de code rapide & précis (OpenAI)',
  },
  {
    id: 'antigravity' as const,
    name: 'Antigravity',
    description: 'Agent autonome multi-outils (DeepMind)',
  },
  {
    id: 'claude' as const,
    name: 'Claude Code',
    description: 'Agent de code autonome (Anthropic)',
  },
  {
    id: 'brain' as const,
    name: 'Nexus Brain',
    description: 'Orchestration & brainstorming conceptuel',
  },
];

export function selectedBackendShortLabel(b?: string): string {
  if (b === 'brain') return 'Brain';
  if (b === 'codex') return 'Codex';
  if (b === 'antigravity') return 'AGY';
  if (b === 'claude') return 'Claude';
  return 'Agent';
}

export function selectedBackendLabel(b?: string): string {
  if (b === 'brain') return 'Nexus Brain';
  if (b === 'codex') return 'Codex';
  if (b === 'antigravity') return 'Antigravity';
  if (b === 'claude') return 'Claude Code';
  return 'Agent';
}

export function formatApprovalKind(kind?: string): string {
  if (kind === 'command') return 'Exécution de commande';
  if (kind === 'fileChange') return 'Modification de fichier';
  if (kind === 'consent') return 'Demande d’autorisation';
  return 'Opération sécurisée';
}

export function formatTaskStatus(status: string): string {
  if (status === 'running') return 'En cours';
  if (status === 'pending') return 'En attente';
  if (status === 'completed') return 'Terminé';
  if (status === 'failed') return 'Échoué';
  if (status === 'cancelled') return 'Annulé';
  return status;
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(timestamp: number | undefined, now: number): string {
  if (!timestamp) return 'inconnu';
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec <= 1) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin}m`;
  return `il y a ${Math.floor(diffMin / 60)}h`;
}

