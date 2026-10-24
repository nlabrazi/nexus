import type { AntigravityServiceStatus } from '../antigravity/types';
import type { ClaudeCodeClientStatus } from '../claude/types';
import type { CodexServiceStatus } from '../codex/types';
import type { AgentBackendType } from './types';

export interface NexusStatusSnapshot {
  brain?: { provider: string; model?: string };
  tts?: string;
  workspace?: { name: string; path: string };
  workspaceCount: number;
  activeBackend?: AgentBackendType;
  codex?: CodexServiceStatus;
  antigravity?: AntigravityServiceStatus;
  claude?: ClaudeCodeClientStatus;
  core?: {
    uptimeSeconds: number;
    onlineNodes: number;
    totalNodes: number;
    activeTasks: number;
    nodes: readonly {
      nodeId: string;
      nodeName: string;
      online: boolean;
      state: string;
    }[];
  };
}
