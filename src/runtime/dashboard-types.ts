/** Public dashboard DTOs contain only operational counters, never raw provider payloads. */
export interface QuotaMetric {
  id: string;
  label: string;
  unit: 'tokens' | 'requests' | 'percent' | 'USD';
  limit?: number;
  remaining?: number;
  used?: number;
  resetsAt?: number;
  observedAt: number;
}
export interface ProviderUsage {
  provider: string;
  model: string;
  actualModel?: string;
  configured: boolean;
  requests: number;
  measuredRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  limits: QuotaMetric[];
  lastStatus?: string;
  lastDurationMs?: number;
  lastRequestAt?: number;
  quotaStatus?: 'available' | 'unavailable';
  accountUrl?: string;
}
export interface BrainDashboard {
  selection: string;
  active?: { provider: string; model: string; startedAt: number };
  lastUsed?: { provider: string; model: string; completedAt: number; durationMs: number };
  providers: ProviderUsage[];
}
export interface AgentDashboard {
  id: 'codex' | 'antigravity';
  state: 'running' | 'ready' | 'stopped';
  model?: string;
  totalTokens?: number;
  limits: QuotaMetric[];
  observedAt?: number;
}
export interface RuntimeDashboard {
  generatedAt: number;
  startedAt: number;
  brain: BrainDashboard;
  agents: AgentDashboard[];
}
