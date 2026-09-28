import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger, LogRecord, LogSink } from './logger';

/** Small synchronous writes: bounded files, no unbounded in-memory queue on disk failure. */
export function createRotatingLogSink(
  directory: string,
  maxBytes = 1_048_576,
  backups = 3
): LogSink {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 128 ||
    !Number.isSafeInteger(backups) ||
    backups < 1 ||
    backups > 10
  ) {
    throw new Error('Invalid log rotation limits');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const append = (name: string, line: string) => {
    const path = join(directory, name);
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > maxBytes) {
      rmSync(`${path}.${backups}`, { force: true });
      for (let index = backups - 1; index >= 1; index--) {
        if (existsSync(`${path}.${index}`)) renameSync(`${path}.${index}`, `${path}.${index + 1}`);
      }
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, line, { mode: 0o600 });
  };
  return (record: LogRecord) => {
    const line = `${JSON.stringify(record)}\n`;
    // Oversized events are replaced, not truncated into invalid JSON.
    const bounded =
      Buffer.byteLength(line) <= maxBytes
        ? line
        : `${JSON.stringify({
            timestamp: record.timestamp,
            level: record.level,
            component: 'Logger',
            operation: 'oversized_record',
          })}\n`;
    append('nexus.log', bounded);
    if (record.level === 'error' || record.error) append('error.log', bounded);
  };
}

let logDirectory: string | undefined;
let persistenceAvailable = false;
let removeSink: (() => void) | undefined;

export function getLoggingStatus(): { directory?: string; available: boolean } {
  return { directory: logDirectory, available: persistenceAvailable };
}

export function initializeLogging(
  role: 'core' | 'desktop' | 'extension',
  baseDirectory?: string
): () => void {
  removeSink?.();
  logDirectory = join(
    process.env.NEXUS_LOG_DIR || baseDirectory || join(homedir(), '.nexus', 'logs'),
    role
  );
  persistenceAvailable = false;
  logger.setLevel(process.env.NEXUS_LOG_LEVEL === 'debug' ? 'debug' : 'info');
  try {
    const sink = createRotatingLogSink(logDirectory);
    persistenceAvailable = true;
    removeSink = logger.addSink((record) => {
      if (!persistenceAvailable) return;
      try {
        sink(record);
      } catch {
        persistenceAvailable = false;
        logger.warn('Logger', 'persist', { status: 'unavailable' });
      }
    });
  } catch {
    logger.warn('Logger', 'initialize', { status: 'unavailable' });
  }
  return () => {
    removeSink?.();
    removeSink = undefined;
    persistenceAvailable = false;
  };
}
