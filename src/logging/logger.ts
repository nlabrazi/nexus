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
}

export type LogSink = (record: LogRecord) => void;
const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  constructor(
    private readonly sink: LogSink = (record) => {
      process.stderr.write(`${JSON.stringify(record)}\n`);
    },
    private readonly level: LogLevel = 'info'
  ) {}

  debug(component: string, operation: string, fields: LogFields = {}): void {
    this.write('debug', component, operation, fields);
  }

  info(component: string, operation: string, fields: LogFields = {}): void {
    this.write('info', component, operation, fields);
  }

  warn(component: string, operation: string, fields: LogFields = {}): void {
    this.write('warn', component, operation, fields);
  }

  error(component: string, operation: string, fields: LogFields = {}): void {
    this.write('error', component, operation, fields);
  }

  private write(level: LogLevel, component: string, operation: string, fields: LogFields): void {
    if (levels[level] < levels[this.level]) return;
    // Pick fields explicitly: a wider object passed at runtime must not leak its other fields.
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      component,
      operation,
      provider: fields.provider,
      model: fields.model,
      status: fields.status,
      durationMs: fields.durationMs,
      taskId: fields.taskId,
      count: fields.count,
    };
    try {
      this.sink(record);
    } catch {
      // Diagnostics must never prevent a task or its text fallback from completing.
    }
  }
}

export const logger = new Logger(
  undefined,
  process.env.NEXUS_LOG_LEVEL === 'debug' ? 'debug' : 'info'
);
