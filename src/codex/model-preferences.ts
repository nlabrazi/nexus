import { ModelSelection } from './types';

export interface ModelPreferences {
  load(): ModelSelection | undefined;
  save(selection: ModelSelection): Promise<void>;
}

export class WorkspaceModelPreferences implements ModelPreferences {
  constructor(private readonly storage: { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> }) { }

  load(): ModelSelection | undefined {
    const value = this.storage.get('nexus.codex.model') as Partial<ModelSelection> | undefined;
    return value && typeof value.model === 'string' && value.model.trim() &&
      typeof value.effort === 'string' && value.effort.trim() ? { model: value.model, effort: value.effort } : undefined;
  }

  async save(selection: ModelSelection): Promise<void> {
    await this.storage.update('nexus.codex.model', { ...selection });
  }
}
