import { logger } from '../logging/logger';
import { BrainDecision, BrainMessage, BrainModel } from './model';
import { ConversationProjectContext } from './types';

export interface OllamaBrainModelOptions {
  readonly host?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fallbackToGemini?: boolean;
}

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.6:27b-mtp-q4_K_M';
const DEFAULT_TIMEOUT_MS = 60_000;

export const BRAIN_INSTRUCTIONS = [
  'Tu es Nexus Brain, un assistant de brainstorming et d’exploration technique intelligent et polyvalent.',
  'Réponds en français, avec clarté, concision et pertinence.',
  'Ton rôle est de discuter, explorer des idées, analyser des projets et concevoir des solutions avec l’utilisateur.',
  'Tu ne modifies pas de code et tu n’exécutes pas de modifications directes : ce rôle est réservé aux agents d’implémentation (Codex et Antigravity).',
  'Tu n’es soumis à aucune limitation de dossier : tu peux explorer et inspecter n’importe quel dossier librement sur la machine.',
  'Par défaut, ton espace de référence démarre dans le répertoire de code (/code ou ~/code).',
  'Tu disposes des capacités Nexus décrites ci-dessous.',
  'IMPORTANT : Tu dois répondre UNIQUEMENT par un objet JSON respectant le format :',
  '{"action": "<nom_action>", "text": "<ton_message_ou_argument>"}',
  'Actions autorisées :',
  '- "reply" : pour discuter, échanger, répondre à l’utilisateur ou formuler des conseils ;',
  '- "get_project_status" : pour connaître le projet actuellement actif et sa branche Git ;',
  '- "list_projects" : pour lister tous les projets et répertoires disponibles dans l’espace de code ;',
  '- "switch_project" : pour basculer le contexte sur un autre projet ou dossier (text contient le nom, id ou chemin) ;',
  '- "inspect_project" : pour inspecter le code d’un dossier ou projet en lecture seule (text contient la question ou JSON { question, project }) ;',
  '- "get_project_memory" : pour consulter les décisions architecturales consignées ;',
  '- "record_decision" : pour consigner une décision technique validée (JSON { title, decision, context? }).',
  'Nexus demandera systématiquement une autorisation ou consentement explicite à l’utilisateur avant toute inspection de projet.',
  'Si toolsAllowed est false, réponds avec action "reply".',
].join('\n');

const VALID_ACTIONS = new Set<BrainDecision['action']>([
  'reply',
  'get_project_status',
  'inspect_project',
  'get_project_memory',
  'record_decision',
  'list_projects',
  'switch_project',
]);

export async function listOllamaModels(host = DEFAULT_OLLAMA_HOST): Promise<string[]> {
  const url = `${host.replace(/\/+$/, '')}/api/tags`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    throw new Error(`Ollama tags HTTP ${res.status}`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string; model: string }> };
  if (!data?.models || !Array.isArray(data.models)) {
    return [];
  }
  return data.models.map((m) => m.name || m.model);
}

export async function checkOllamaAvailable(host = DEFAULT_OLLAMA_HOST): Promise<boolean> {
  try {
    const models = await listOllamaModels(host);
    return models.length > 0;
  } catch {
    return false;
  }
}

export class OllamaBrainModel implements BrainModel {
  private host: string;
  private modelName: string;
  private readonly timeoutMs: number;
  private readonly fallbackToGemini: boolean;

  constructor(options?: OllamaBrainModelOptions) {
    this.host =
      options?.host ||
      process.env.OLLAMA_HOST ||
      process.env.OLLAMA_BASE_URL ||
      DEFAULT_OLLAMA_HOST;
    this.modelName = options?.model || process.env.NEXUS_BRAIN_MODEL || DEFAULT_MODEL;
    this.timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fallbackToGemini = options?.fallbackToGemini ?? true;
  }

  getModel(): string {
    return this.modelName;
  }

  setModel(model: string): void {
    this.modelName = model;
  }

  getHost(): string {
    return this.host;
  }

  setHost(host: string): void {
    this.host = host;
  }

  async decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    signal.throwIfAborted();

    try {
      return await this.callOllama(messages, project, toolsAllowed, signal);
    } catch (ollamaErr: unknown) {
      if (signal.aborted) {
        throw ollamaErr;
      }

      if (this.fallbackToGemini) {
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
        if (geminiKey) {
          try {
            return await this.callGeminiFallback(
              messages,
              project,
              toolsAllowed,
              signal,
              geminiKey
            );
          } catch (geminiErr: unknown) {
            logger.warn('Brain', 'gemini_fallback', { provider: 'gemini', status: 'failed' });
          }
        }
      }

      const errMessage = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
      throw new Error(
        `Impossible de contacter le moteur Nexus Brain local (Ollama sur ${this.host}) : ${errMessage}. Vérifiez qu'Ollama est lancé via "ollama serve".`
      );
    }
  }

  private async callOllama(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    const url = `${this.host.replace(/\/+$/, '')}/api/chat`;

    const projectContextStr = project
      ? `\nContexte projet : ${project.name} (branche: ${project.branch ?? 'aucune'})`
      : '\nAucun projet spécifique ciblé (espace racine /code)';

    const systemPrompt = `${BRAIN_INSTRUCTIONS}${projectContextStr}\nOutils autorisés : ${toolsAllowed ? 'oui' : 'non'}.`;

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      chatMessages.push({
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: msg.text,
      });
    }

    const payload = {
      model: this.modelName,
      messages: chatMessages,
      format: 'json',
      stream: false,
      options: {
        temperature: 0.3,
      },
    };

    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status} (${response.statusText}): ${errorText}`);
    }

    const result = (await response.json()) as {
      message?: { content?: string };
    };

    const rawContent = result.message?.content?.trim() || '';
    return this.parseDecisionJson(rawContent);
  }

  private async callGeminiFallback(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal,
    apiKey: string
  ): Promise<BrainDecision> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const projectContextStr = project
      ? `\nContexte projet : ${project.name} (branche: ${project.branch ?? 'aucune'})`
      : '\nAucun projet spécifique ciblé (espace racine /code)';

    const systemPrompt = `${BRAIN_INSTRUCTIONS}${projectContextStr}\nOutils autorisés : ${toolsAllowed ? 'oui' : 'non'}.`;

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return this.parseDecisionJson(rawContent);
  }

  private parseDecisionJson(rawContent: string): BrainDecision {
    if (!rawContent) {
      return {
        action: 'reply',
        text: 'Je n’ai pas pu générer de réponse intelligible.',
      };
    }

    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const action = String(parsed.action || 'reply') as BrainDecision['action'];
      const text = typeof parsed.text === 'string' ? parsed.text : JSON.stringify(parsed);

      if (VALID_ACTIONS.has(action)) {
        return { action, text };
      }
      return { action: 'reply', text };
    } catch {
      // Fallback if model returned plain conversational text instead of JSON
      return { action: 'reply', text: rawContent };
    }
  }
}
