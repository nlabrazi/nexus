export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Deliberately excludes prompts, responses, credentials and raw provider payloads. */
export interface LogFields {
  readonly provider?: string;
  readonly model?: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly taskId?: string;
  readonly count?: number;
}

export interface LogRecord extends LogFields {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly component: string;
  readonly operation: string;
  readonly error?: { readonly type: string; readonly message: string; readonly stack?: string };
}

const secrets = new Set<string>();

export function registerLogSecret(value: string): void {
  if (value.trim()) secrets.add(value);
}

export function redactLogText(text: string): string {
  let result = text;
  const envSecrets = Object.entries(process.env)
    .filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY|AUTH/i.test(key))
    .flatMap(([, value]) => (value ? value.split(',') : []));
  for (const secret of [...secrets, ...envSecrets].sort((a, b) => b.length - a.length)) {
    if (secret.trim()) result = result.split(secret).join('[REDACTED]');
  }
  return result
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{15,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/([?&](?:key|token|api_key|secret)=)[^\s&#]+/gi, '$1[REDACTED]')
    .slice(0, 4000);
}

/** Only application-authored, content-free messages are safe to persist. */
export class DiagnosticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticError';
  }
}

function describeError(error: unknown): NonNullable<LogRecord['error']> {
  // SDK/process messages and causes can contain complete prompts or HTTP bodies.
  const stack =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 8)
          .join('\n')
      : undefined;
  return {
    type: error instanceof Error ? redactLogText(error.name) : 'UnknownError',
    message: error instanceof DiagnosticError ? redactLogText(error.message) : 'Operation failed',
    stack: stack ? redactLogText(stack) : undefined,
  };
}

export type LogSink = (record: LogRecord) => void;
const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private lastError?: LogRecord;
  private readonly extraSinks = new Set<LogSink>();
  constructor(
    private readonly sink: LogSink = (record) => {
      process.stderr.write(`${JSON.stringify(record)}\n`);
    },
    private level: LogLevel = 'info'
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  addSink(sink: LogSink): () => void {
    this.extraSinks.add(sink);
    return () => {
      this.extraSinks.delete(sink);
    };
  }

  debug(component: string, operation: string, fields: LogFields = {}): void {
    this.write('debug', component, operation, fields);
  }

  info(component: string, operation: string, fields: LogFields = {}): void {
    this.write('info', component, operation, fields);
  }

  warn(component: string, operation: string, fields: LogFields = {}, error?: unknown): void {
    this.write('warn', component, operation, fields, error);
  }

  error(component: string, operation: string, fields: LogFields = {}, error?: unknown): void {
    this.write(
      'error',
      component,
      operation,
      fields,
      error ?? new DiagnosticError('Operation failed')
    );
  }

  getLastError(): LogRecord | undefined {
    return this.lastError ? structuredClone(this.lastError) : undefined;
  }

  private write(
    level: LogLevel,
    component: string,
    operation: string,
    fields: LogFields,
    error?: unknown
  ): void {
    if (levels[level] < levels[this.level]) return;
    // Pick fields explicitly: a wider object passed at runtime must not leak its other fields.
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      component: redactLogText(component),
      operation: redactLogText(operation),
      provider: fields.provider === undefined ? undefined : redactLogText(fields.provider),
      model: fields.model === undefined ? undefined : redactLogText(fields.model),
      status: fields.status === undefined ? undefined : redactLogText(fields.status),
      durationMs: fields.durationMs,
      taskId: fields.taskId === undefined ? undefined : redactLogText(fields.taskId),
      count: fields.count,
      error: error === undefined ? undefined : describeError(error),
    };
    if (level === 'error' || record.error) this.lastError = structuredClone(record);
    for (const sink of [this.sink, ...this.extraSinks]) {
      try {
        sink(record);
      } catch {
        // A broken destination must not prevent other destinations or tasks from completing.
      }
    }
  }
}

export const logger = new Logger(
  undefined,
  process.env.NEXUS_LOG_LEVEL === 'debug' ? 'debug' : 'info'
);
