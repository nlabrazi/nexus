import { ModelPreferences, WorkspaceModelPreferences } from '../codex/model-preferences';

export type AntigravityModelPreferences = ModelPreferences;

export class WorkspaceAntigravityModelPreferences extends WorkspaceModelPreferences {
  constructor(storage: {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void>;
  }) {
    super(storage, 'nexus.antigravity.model');
  }
}
