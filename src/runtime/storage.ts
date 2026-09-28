import { KeyValueStorage } from './types';

export class MemoryStorage implements KeyValueStorage {
  private readonly store = new Map<string, unknown>();

  get(key: string): unknown {
    return this.store.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, structuredClone(value));
    }
  }

  clear(): void {
    this.store.clear();
  }
}
