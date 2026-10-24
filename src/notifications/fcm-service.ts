import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KeyValueStorage } from '../runtime/types';

interface ServiceAccountKey {
  project_id: string;
  private_key: string;
  client_email: string;
}

export class FcmService {
  private serviceAccount: ServiceAccountKey | null = null;
  private cachedToken: { token: string; expiresAt: number } | null = null;
  private storage: KeyValueStorage | null = null;
  private memoryTokens: Set<string> = new Set();

  constructor(options: { serviceAccountPath?: string; storage?: KeyValueStorage }) {
    this.storage = options.storage || null;
    const candidatePaths = [
      options.serviceAccountPath,
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      path.resolve(process.cwd(), 'firebase-service-account.json'),
      path.resolve(__dirname, '../firebase-service-account.json'),
      path.resolve(__dirname, '../../firebase-service-account.json'),
      path.resolve(os.homedir(), '.nexus/firebase-service-account.json'),
    ].filter((p): p is string => Boolean(p));

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        try {
          this.serviceAccount = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          break;
        } catch (e) {
          console.warn('[FCM] Failed to parse service account JSON:', e);
        }
      }
    }
  }

  public isConfigured(): boolean {
    return Boolean(
      this.serviceAccount?.project_id &&
        this.serviceAccount?.private_key &&
        this.serviceAccount?.client_email
    );
  }

  public async registerToken(token: string): Promise<void> {
    if (!token) return;
    this.memoryTokens.add(token);
    if (this.storage) {
      const stored = (this.storage.get('nexus:push_tokens') as string[] | undefined) || [];
      if (!stored.includes(token)) {
        stored.push(token);
        await this.storage.update('nexus:push_tokens', stored);
      }
    }
  }

  public async getTokens(): Promise<string[]> {
    if (this.storage) {
      const stored = (this.storage.get('nexus:push_tokens') as string[] | undefined) || [];
      for (const t of this.memoryTokens) {
        if (!stored.includes(t)) stored.push(t);
      }
      return stored;
    }
    return Array.from(this.memoryTokens);
  }

  public async removeToken(token: string): Promise<void> {
    this.memoryTokens.delete(token);
    if (this.storage) {
      const stored = (this.storage.get('nexus:push_tokens') as string[] | undefined) || [];
      const filtered = stored.filter((t: string) => t !== token);
      await this.storage.update('nexus:push_tokens', filtered);
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.isConfigured() || !this.serviceAccount) return null;
    const sa = this.serviceAccount;
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.token;
    }

    try {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
        'base64url'
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: sa.client_email,
          scope: 'https://www.googleapis.com/auth/firebase.messaging',
          aud: 'https://oauth2.googleapis.com/token',
          exp: now + 3600,
          iat: now,
        })
      ).toString('base64url');

      const signature = crypto
        .createSign('RSA-SHA256')
        .update(`${header}.${payload}`)
        .sign(sa.private_key, 'base64url');

      const jwt = `${header}.${payload}.${signature}`;
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
      });

      if (!res.ok) {
        console.warn('[FCM] OAuth error:', await res.text());
        return null;
      }

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        this.cachedToken = {
          token: data.access_token,
          expiresAt: now + (data.expires_in || 3600),
        };
        return data.access_token;
      }
    } catch (err) {
      console.warn('[FCM] Error requesting OAuth token:', err);
    }
    return null;
  }

  public async sendPush(notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<{ successCount: number; failureCount: number }> {
    const tokens = await this.getTokens();
    if (!tokens.length || !this.isConfigured() || !this.serviceAccount) {
      return { successCount: 0, failureCount: 0 };
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return { successCount: 0, failureCount: tokens.length };
    }

    const projectId = this.serviceAccount.project_id;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    let successCount = 0;
    let failureCount = 0;

    for (const token of tokens) {
      try {
        const dataPayload: Record<string, string> = {
          ...(notification.data || {}),
          title: notification.title,
          body: notification.body,
        };
        const payload = {
          message: {
            token,
            android: {
              priority: 'HIGH',
              ttl: '180s',
            },
            data: dataPayload,
          },
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          successCount++;
        } else {
          failureCount++;
          const errText = await res.text();
          console.warn(`[FCM] Send error for token ${token.substring(0, 10)}...:`, errText);
          if (errText.includes('UNREGISTERED') || errText.includes('INVALID_ARGUMENT')) {
            await this.removeToken(token);
          }
        }
      } catch (e) {
        failureCount++;
        console.warn(`[FCM] Network error sending to token:`, e);
      }
    }

    return { successCount, failureCount };
  }
}
