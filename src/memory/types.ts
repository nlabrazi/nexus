export interface ProjectDecision {
  readonly id: string;
  readonly date: string; // ISO date YYYY-MM-DD
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly status: 'accepted' | 'superseded' | 'deprecated';
}

export interface DecisionRecordInput {
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly status?: 'accepted' | 'superseded' | 'deprecated';
}

export interface ProjectMemorySnapshot {
  readonly rootPath: string;
  readonly memoryFilePath: string;
  readonly exists: boolean;
  readonly rawContent: string;
  readonly decisions: readonly ProjectDecision[];
}
