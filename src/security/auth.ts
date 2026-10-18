import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface RateLimiterOptions {
  /** Maximum number of failed attempts allowed before blocking. Default: 5. */
  readonly maxAttempts?: number;
  /** Window duration in milliseconds. Default: 5 minutes. */
  readonly windowMs?: number;
  /** Block duration in milliseconds once limit is reached. Default: 15 minutes. */
  readonly blockDurationMs?: number;
}

interface AttemptRecord {
  failures: number;
  blockedUntil?: number;
  lastAttemptAt: number;
}

export class AuthRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    this.blockDurationMs = options.blockDurationMs ?? 15 * 60 * 1000;
  }

  isBlocked(ip: string, now = Date.now()): boolean {
    const record = this.attempts.get(ip);
    if (!record) {
      return false;
    }
    if (record.blockedUntil && record.blockedUntil > now) {
      return true;
    }
    if (record.blockedUntil && record.blockedUntil <= now) {
      this.attempts.delete(ip);
      return false;
    }
    if (now - record.lastAttemptAt > this.windowMs) {
      this.attempts.delete(ip);
      return false;
    }
    return false;
  }

  recordFailure(ip: string, now = Date.now()): { blocked: boolean; remainingAttempts: number } {
    const record = this.attempts.get(ip) ?? { failures: 0, lastAttemptAt: now };

    if (now - record.lastAttemptAt > this.windowMs) {
      record.failures = 0;
    }

    record.failures += 1;
    record.lastAttemptAt = now;

    if (record.failures >= this.maxAttempts) {
      record.blockedUntil = now + this.blockDurationMs;
      this.attempts.set(ip, record);
      return { blocked: true, remainingAttempts: 0 };
    }

    this.attempts.set(ip, record);
    return { blocked: false, remainingAttempts: this.maxAttempts - record.failures };
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip);
  }

  clear(): void {
    this.attempts.clear();
  }
}

export class AuthGuard {
  private readonly validTokens: Set<string>;
  private readonly rateLimiter: AuthRateLimiter;

  constructor(tokens: readonly string[], rateLimiter = new AuthRateLimiter()) {
    const sanitized = tokens.map((t) => t.trim()).filter((t) => t.length > 0);
    if (!sanitized.length) {
      throw new Error('Au moins un jeton d’authentification doit être configuré.');
    }
    this.validTokens = new Set(sanitized);
    this.rateLimiter = rateLimiter;
  }

  getTokens(): readonly string[] {
    return [...this.validTokens];
  }

  isIpBlocked(ip: string): boolean {
    return this.rateLimiter.isBlocked(ip);
  }

  /**
   * Constant-time comparison between two strings to prevent timing attacks.
   */
  private safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Verifies an auth token against valid tokens using timing-safe comparison.
   * Tracks rate limiting per IP address.
   */
  verifyToken(token: string | undefined, clientIp: string): { ok: boolean; blocked?: boolean } {
    if (this.rateLimiter.isBlocked(clientIp)) {
      return { ok: false, blocked: true };
    }

    if (!token || typeof token !== 'string') {
      const { blocked } = this.rateLimiter.recordFailure(clientIp);
      return { ok: false, blocked };
    }

    const trimmed = token.replace(/^Bearer\s+/i, '').trim();
    if (!trimmed) {
      const { blocked } = this.rateLimiter.recordFailure(clientIp);
      return { ok: false, blocked };
    }

    let matched = false;
    for (const valid of this.validTokens) {
      if (this.safeEquals(trimmed, valid)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      this.rateLimiter.recordSuccess(clientIp);
      return { ok: true };
    }

    const { blocked } = this.rateLimiter.recordFailure(clientIp);
    return { ok: false, blocked };
  }
}

/**
 * Resolves or generates a secure random 256-bit authentication token in ~/.nexus/daemon.token
 */
export function getOrCreateDaemonToken(explicitToken?: string): string {
  if (explicitToken?.trim()) {
    return explicitToken.trim();
  }

  const tokenPath = join(homedir(), '.nexus', 'daemon.token');
  if (existsSync(tokenPath)) {
    try {
      const stored = readFileSync(tokenPath, 'utf-8').trim();
      if (stored.length >= 16) {
        return stored;
      }
    } catch {}
  }

  const generated = randomBytes(32).toString('hex');
  try {
    mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
    writeFileSync(tokenPath, generated, { mode: 0o600 });
  } catch {}

  return generated;
}
