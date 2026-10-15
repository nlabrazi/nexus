import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../logging/logger';
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

  has(key: string): boolean {
    return this.store.has(key);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
  }
}

export class FileStorage implements KeyValueStorage {
  private readonly store = new Map<string, unknown>();
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.nexus', 'storage.json');
    this.loadSync();
  }

  private loadSync(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const content = readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          this.store.set(k, v);
        }
      }
    } catch (err) {
      logger.warn('Storage', 'load_failed', { status: 'failed' }, err);
    }
  }

  private saveSync(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data: Record<string, unknown> = {};
      for (const [k, v] of this.store.entries()) {
        data[k] = v;
      }
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tempPath, this.filePath);
    } catch (err) {
      logger.warn('Storage', 'save_failed', { status: 'failed' }, err);
    }
  }

  get(key: string): unknown {
    return this.store.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, structuredClone(value));
    }
    this.saveSync();
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
    this.saveSync();
  }
}

export interface UpstashStorageOptions {
  url: string;
  token: string;
  prefix?: string;
  fetchFn?: typeof fetch;
}

export class UpstashStorage implements KeyValueStorage {
  private readonly store = new Map<string, unknown>();
  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: UpstashStorageOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.prefix = options.prefix ?? 'nexus:';
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private formatKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  get(key: string): unknown {
    return this.store.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, structuredClone(value));
    }

    const fullKey = encodeURIComponent(this.formatKey(key));
    try {
      if (value === undefined) {
        await this.fetchFn(`${this.url}/del/${fullKey}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } else {
        await this.fetchFn(`${this.url}/set/${fullKey}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(value),
        });
      }
    } catch (err) {
      logger.warn(
        'Storage',
        'upstash_update_failed',
        { status: 'failed', provider: 'upstash' },
        err
      );
    }
  }

  async syncKey(key: string): Promise<unknown> {
    const fullKey = encodeURIComponent(this.formatKey(key));
    try {
      const res = await this.fetchFn(`${this.url}/get/${fullKey}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: string | null };
        if (data.result !== null && data.result !== undefined) {
          try {
            const parsed = JSON.parse(data.result);
            this.store.set(key, parsed);
            return parsed;
          } catch {
            this.store.set(key, data.result);
            return data.result;
          }
        } else {
          this.store.delete(key);
          return undefined;
        }
      }
    } catch (err) {
      logger.warn('Storage', 'upstash_sync_failed', { status: 'failed', provider: 'upstash' }, err);
    }
    return this.store.get(key);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
  }
}

export class HybridStorage implements KeyValueStorage {
  constructor(
    private readonly local: FileStorage | MemoryStorage,
    private readonly remote: UpstashStorage
  ) {}

  get(key: string): unknown {
    return this.local.get(key);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.local.update(key, value);
    void this.remote.update(key, value).catch(() => {});
  }

  keys(): string[] {
    return this.local.keys();
  }

  getLocal(): FileStorage | MemoryStorage {
    return this.local;
  }

  getRemote(): UpstashStorage {
    return this.remote;
  }
}

export interface StorageFactoryOptions {
  filePath?: string;
  upstashUrl?: string;
  upstashToken?: string;
  prefix?: string;
}

export function createPersistentStorage(options?: StorageFactoryOptions): KeyValueStorage {
  const filePath = options?.filePath ?? join(homedir(), '.nexus', 'storage.json');
  const upstashUrl =
    options?.upstashUrl !== undefined ? options.upstashUrl : process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken =
    options?.upstashToken !== undefined
      ? options.upstashToken
      : process.env.UPSTASH_REDIS_REST_TOKEN;

  const local = new FileStorage(filePath);

  if (upstashUrl && upstashToken) {
    const remote = new UpstashStorage({
      url: upstashUrl,
      token: upstashToken,
      prefix: options?.prefix ?? 'nexus:',
    });
    return new HybridStorage(local, remote);
  }

  return local;
}
