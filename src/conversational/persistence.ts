import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BrainMessage } from './model';

export interface BrainSessionRecord {
  readonly version: 1;
  readonly conversationId: string;
  readonly context: string;
  readonly messages: readonly BrainMessage[];
  readonly updatedAt: number;
}

export interface BrainSessionPersistence {
  load(
    conversationId: string
  ): Promise<BrainSessionRecord | undefined> | BrainSessionRecord | undefined;
  save(record: BrainSessionRecord): Promise<void> | void;
  clear(conversationId: string): Promise<void> | void;
}

export class MemoryBrainSessionPersistence implements BrainSessionPersistence {
  private readonly store = new Map<string, BrainSessionRecord>();

  load(conversationId: string): BrainSessionRecord | undefined {
    return this.store.get(conversationId);
  }

  save(record: BrainSessionRecord): void {
    this.store.set(record.conversationId, structuredClone(record));
  }

  clear(conversationId: string): void {
    this.store.delete(conversationId);
  }
}

export class FileBrainSessionPersistence implements BrainSessionPersistence {
  private readonly memoryFallback = new MemoryBrainSessionPersistence();

  constructor(
    private readonly directory: string,
    private readonly maxMessages = 20
  ) {}

  private resolveFilePath(conversationId: string): string {
    const hash = createHash('sha256').update(conversationId).digest('hex').slice(0, 16);
    const safePrefix = conversationId
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(-32)
      .replace(/^_+|_+$/g, '');
    const fileName = `${safePrefix || 'brain'}-${hash}.json`;
    return join(this.directory, fileName);
  }

  load(conversationId: string): BrainSessionRecord | undefined {
    try {
      const filePath = this.resolveFilePath(conversationId);
      if (!existsSync(filePath)) {
        return this.memoryFallback.load(conversationId);
      }
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.version === 1 &&
        typeof parsed.conversationId === 'string' &&
        typeof parsed.context === 'string' &&
        Array.isArray(parsed.messages)
      ) {
        return parsed as BrainSessionRecord;
      }
      return undefined;
    } catch {
      return this.memoryFallback.load(conversationId);
    }
  }

  save(record: BrainSessionRecord): void {
    // Keep bounded messages to protect both disk and LLM context window
    const boundedMessages = record.messages.slice(-this.maxMessages).map((msg, index, arr) => {
      // If older tool message (not in the last 2 turns), compact bulky observations
      if (msg.role === 'tool' && index < arr.length - 2 && msg.text.length > 500) {
        try {
          const parsed = JSON.parse(msg.text);
          if (typeof parsed.result === 'string' && parsed.result.length > 300) {
            return {
              ...msg,
              text: JSON.stringify({
                action: parsed.action,
                question: parsed.question,
                result: `${parsed.result.slice(0, 300)}... [condensé pour économiser les tokens]`,
              }),
            };
          }
        } catch {
          return {
            ...msg,
            text: `${msg.text.slice(0, 300)}... [condensé]`,
          };
        }
      }
      return msg;
    });

    const cleanRecord: BrainSessionRecord = {
      version: 1,
      conversationId: record.conversationId,
      context: record.context,
      messages: boundedMessages,
      updatedAt: record.updatedAt,
    };

    this.memoryFallback.save(cleanRecord);

    try {
      if (!existsSync(this.directory)) {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      }
      const filePath = this.resolveFilePath(record.conversationId);
      writeFileSync(filePath, JSON.stringify(cleanRecord, null, 2), 'utf-8');
    } catch {
      // Memory fallback retains the session even if disk fails
    }
  }

  clear(conversationId: string): void {
    this.memoryFallback.clear(conversationId);
    try {
      const filePath = this.resolveFilePath(conversationId);
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    } catch {
      // Ignore filesystem errors during clear
    }
  }
}
