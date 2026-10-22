import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  AgentContextSnapshot,
  DecisionRecordInput,
  ProjectDecision,
  ProjectMemorySnapshot,
} from './types';

import { KeyValueStorage } from '../runtime/types';

const INITIAL_HEADER = `# Mémoire de Décisions Nexus

Ce fichier consigne les décisions architecturales et choix techniques structurants du projet.
Nexus Brain et les agents s'y réfèrent pour conserver le contexte technique d'une session à l'autre.

## Décisions
`;

export const DEFAULT_GLOBAL_PERSONA = `# Persona & Directives Globales Nexus

- **Développeur** : Kaox (Architecte / Développeur Principal)
- **Langue** : Toujours répondre en Français clair, concis et technique.
- **Philosophie** : Privilégier des architectures simples, modulaires, typées strictement (TypeScript), sans code mort ni sur-ingénierie.
- **Mode Brainstorm** : Agir comme un partenaire d'architecture proactif, challenger les idées, retenir les décisions via record_decision et préparer des passes propres pour Codex / Antigravity / Claude.
- **Mode Code** : Aller droit au but, vérifier les effets de bord et maintenir les tests unitaires au vert.`;

export class ProjectMemory {
  constructor(private readonly storage?: KeyValueStorage) {}

  private memoryKey(rootPath: string): string {
    return `nexus.memory:${resolve(rootPath)}`;
  }

  private preferencesKey(rootPath: string): string {
    return `nexus.preferences:${resolve(rootPath)}`;
  }

  private personaKey(): string {
    return 'nexus.persona.global';
  }

  getMemoryPath(rootPath: string): string {
    return resolve(rootPath, '.nexus', 'memory.md');
  }

  hasMemory(rootPath: string): boolean {
    const stored = this.storage?.get(this.memoryKey(rootPath));
    if (typeof stored === 'string' && stored.trim().length > 0) {
      return true;
    }
    return existsSync(this.getMemoryPath(rootPath));
  }

  readMemory(rootPath: string): string {
    const key = this.memoryKey(rootPath);
    const stored = this.storage?.get(key);
    if (typeof stored === 'string' && stored.trim().length > 0) {
      return stored;
    }
    const filePath = this.getMemoryPath(rootPath);
    if (!existsSync(filePath)) {
      return '';
    }
    try {
      const diskContent = readFileSync(filePath, 'utf-8');
      if (diskContent.trim() && this.storage) {
        void this.storage.update(key, diskContent);
      }
      return diskContent;
    } catch {
      return '';
    }
  }

  setRawMemory(rootPath: string, content: string): void {
    const normalized = content.trim() ? `${content.trim()}\n` : INITIAL_HEADER;
    if (this.storage) {
      void this.storage.update(this.memoryKey(rootPath), normalized);
    }
    try {
      const filePath = this.getMemoryPath(rootPath);
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, normalized, 'utf-8');
    } catch {
      // Upstash storage retains memory if disk write fails
    }
  }

  listDecisions(rootPath: string): readonly ProjectDecision[] {
    const content = this.readMemory(rootPath);
    if (!content) {
      return [];
    }
    return this.parseDecisions(content);
  }

  recordDecision(rootPath: string, input: DecisionRecordInput): ProjectDecision {
    const unwrapped = unwrapDecisionPayload(
      input.title,
      input.decision,
      input.context,
      input.status
    );
    const title = unwrapped.title.trim();
    if (!title) {
      throw new Error('Le titre de la décision ne peut pas être vide.');
    }
    const decisionText = unwrapped.decision.trim();
    if (!decisionText) {
      throw new Error('Le corps de la décision ne peut pas être vide.');
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const id = `dec-${now.getTime().toString(36)}-${randomUUID().slice(0, 4)}`;
    const status: ProjectDecision['status'] = unwrapped.status ?? 'accepted';
    const context = unwrapped.context?.trim();

    const decision: ProjectDecision = {
      id,
      date: dateStr,
      title,
      decision: decisionText,
      context: context || undefined,
      status,
    };

    let existingContent = this.readMemory(rootPath);
    if (!existingContent.trim()) {
      existingContent = INITIAL_HEADER;
    }

    const entryMarkdown = formatDecisionMarkdown(decision);
    const newContent = `${existingContent.trimEnd()}\n\n${entryMarkdown}\n`;
    this.setRawMemory(rootPath, newContent);

    return decision;
  }

  getPreferencesPath(rootPath: string): string {
    return resolve(rootPath, '.nexus', 'preferences.md');
  }

  getGlobalPreferencesPath(): string {
    return resolve(homedir(), '.nexus', 'preferences.md');
  }

  readGlobalPersona(): string {
    if (this.storage) {
      const stored = this.storage.get(this.personaKey());
      if (typeof stored === 'string') {
        return stored.trim();
      }
    }
    try {
      const globalPath = this.getGlobalPreferencesPath();
      if (existsSync(globalPath)) {
        const disk = readFileSync(globalPath, 'utf-8').trim();
        if (disk && this.storage) {
          void this.storage.update(this.personaKey(), disk);
        }
        return disk;
      }
    } catch {
      // Ignore filesystem errors
    }
    if (this.storage) {
      void this.storage.update(this.personaKey(), DEFAULT_GLOBAL_PERSONA);
      return DEFAULT_GLOBAL_PERSONA;
    }
    return '';
  }

  setGlobalPersona(content: string): void {
    const trimmed = content.trim();
    if (this.storage) {
      void this.storage.update(this.personaKey(), trimmed);
    }
  }

  readProjectPreferencesOnly(rootPath: string): string {
    const key = this.preferencesKey(rootPath);
    const stored = this.storage?.get(key);
    if (typeof stored === 'string') {
      return stored.trim();
    }
    try {
      const localPath = this.getPreferencesPath(rootPath);
      if (existsSync(localPath)) {
        const localContent = readFileSync(localPath, 'utf-8').trim();
        if (localContent && this.storage) {
          void this.storage.update(key, localContent);
        }
        return localContent;
      }
    } catch {
      // Ignore filesystem errors
    }
    return '';
  }

  readPreferences(rootPath: string): string {
    const parts: string[] = [];
    const globalContent = this.readGlobalPersona();
    if (globalContent) {
      parts.push(globalContent);
    }
    const localContent = this.readProjectPreferencesOnly(rootPath);
    if (localContent) {
      parts.push(localContent);
    }
    return parts.join('\n\n');
  }

  setPreferences(rootPath: string, content: string): void {
    const trimmed = content.trim();
    if (this.storage) {
      void this.storage.update(this.preferencesKey(rootPath), trimmed);
    }
    try {
      const filePath = this.getPreferencesPath(rootPath);
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, trimmed, 'utf-8');
    } catch {
      // Upstash storage retains preferences if disk write fails
    }
  }

  extractFreeformNotes(markdown: string): string {
    if (!markdown?.trim()) {
      return '';
    }
    const withoutStructured = markdown.replace(
      /###\s+\[\d{4}-\d{2}-\d{2}\]\s+[^\n]+[\s\S]*?(?=(?:###\s+\[\d{4}-\d{2}-\d{2}\]|$))/g,
      ''
    );
    const boilerplateLines = new Set(
      INITIAL_HEADER.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
    const remainingLines = withoutStructured
      .split('\n')
      .filter((line) => !boilerplateLines.has(line.trim()));
    return remainingLines.join('\n').trim();
  }

  formatActiveDecisions(rootPath: string, maxDecisions = 8, maxChars = 2000): string {
    const rawContent = this.readMemory(rootPath);
    const freeform = this.extractFreeformNotes(rawContent);
    const decisions = this.listDecisions(rootPath).filter((d) => d.status === 'accepted');
    if (decisions.length === 0 && !freeform) {
      return '';
    }
    const selected = decisions.slice(-maxDecisions);
    const formattedLines: string[] = [];
    let currentLength = 0;

    if (freeform) {
      const clippedNotes =
        freeform.length > maxChars ? `${freeform.slice(0, maxChars)}…` : freeform;
      formattedLines.push(clippedNotes);
      currentLength += clippedNotes.length + 1;
    }

    for (const d of selected) {
      const line = `• [${d.date}] ${d.title} : ${d.decision}${d.context ? ` (Contexte: ${d.context})` : ''}`;
      if (currentLength + line.length > maxChars && formattedLines.length > 0) {
        break;
      }
      formattedLines.push(line);
      currentLength += line.length + 1;
    }

    return formattedLines.join('\n');
  }

  buildAgentContext(rootPath: string): AgentContextSnapshot {
    const preferences = this.readPreferences(rootPath);
    const decisionsSummary = this.formatActiveDecisions(rootPath);
    const hasContext = Boolean(preferences.trim() || decisionsSummary.trim());
    return {
      rootPath,
      decisionsSummary,
      preferences,
      hasContext,
    };
  }

  augmentPrompt(prompt: string, rootPath?: string): string {
    const trimmed = prompt.trim();
    if (!trimmed || !rootPath || trimmed.startsWith('Reply only with:')) {
      return prompt;
    }
    if (trimmed.includes('[CONTEXTE PROJET & DIRECTIVES NEXUS]')) {
      return prompt;
    }

    const ctx = this.buildAgentContext(rootPath);
    if (!ctx.hasContext) {
      return prompt;
    }

    const sections: string[] = ['[CONTEXTE PROJET & DIRECTIVES NEXUS]'];
    if (ctx.preferences) {
      sections.push(`Directives et préférences du développeur :\n${ctx.preferences}`);
    }
    if (ctx.decisionsSummary) {
      sections.push(`Décisions architecturales actives validées :\n${ctx.decisionsSummary}`);
    }
    sections.push(
      'Consigne : Applique strictement ces choix et directives dans ta réponse ou ton implémentation.'
    );

    return `${sections.join('\n\n')}\n\n[DEMANDE UTILISATEUR]\n${trimmed}`;
  }

  getSnapshot(rootPath: string): ProjectMemorySnapshot {
    const filePath = this.getMemoryPath(rootPath);
    const exists = this.hasMemory(rootPath);
    const rawContent = this.readMemory(rootPath);
    const decisions = this.listDecisions(rootPath);
    const preferences = this.readPreferences(rootPath) || undefined;

    return {
      rootPath,
      memoryFilePath: filePath,
      exists,
      rawContent,
      decisions,
      preferences,
    };
  }

  clearMemory(rootPath: string): void {
    this.setRawMemory(rootPath, INITIAL_HEADER);
  }

  parseDecisions(markdown: string): readonly ProjectDecision[] {
    const decisions: ProjectDecision[] = [];
    const sectionRegex =
      /###\s+\[(\d{4}-\d{2}-\d{2})\]\s+([^\n]+)([\s\S]*?)(?=(?:###\s+\[\d{4}-\d{2}-\d{2}\]|$))/g;

    for (const match of markdown.matchAll(sectionRegex)) {
      const date = match[1];
      const title = match[2].trim();
      const body = match[3];

      const idMatch = /- \*\*ID\*\*\s*:\s*`?([^\n`]+)`?/i.exec(body);
      const statusMatch = /- \*\*Statut\*\*\s*:\s*([^\n]+)/i.exec(body);
      const decisionMatch = /- \*\*Décision\*\*\s*:\s*([^\n]+)/i.exec(body);
      const contextMatch = /- \*\*Contexte\*\*\s*:\s*([^\n]+)/i.exec(body);

      const id = idMatch ? idMatch[1].trim() : `dec-${date}-${title.slice(0, 10)}`;
      const rawStatus = statusMatch ? statusMatch[1].trim().toLowerCase() : 'accepted';
      const status: ProjectDecision['status'] =
        rawStatus.includes('superse') || rawStatus.includes('remplacé')
          ? 'superseded'
          : rawStatus.includes('deprecat') || rawStatus.includes('obsolète')
            ? 'deprecated'
            : 'accepted';

      const rawDecision = decisionMatch ? decisionMatch[1].trim() : body.trim();
      const rawContext = contextMatch ? contextMatch[1].trim() : undefined;
      const unwrapped = unwrapDecisionPayload(title, rawDecision, rawContext, status);

      decisions.push({
        id,
        date,
        title: unwrapped.title,
        decision: unwrapped.decision,
        context: unwrapped.context,
        status: unwrapped.status ?? status,
      });
    }

    return decisions;
  }
}

function unwrapDecisionPayload(
  rawTitle: string,
  rawDecision: string,
  rawContext?: string,
  rawStatus?: ProjectDecision['status']
): DecisionRecordInput {
  let currentTitle = rawTitle;
  let currentDecision = rawDecision;
  let currentContext = rawContext;
  let currentStatus = rawStatus;

  for (let depth = 0; depth < 3; depth++) {
    const trimmed = currentDecision.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      break;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        break;
      }
      if (parsed.text && typeof parsed.text === 'object' && !Array.isArray(parsed.text)) {
        const inner = parsed.text as Record<string, unknown>;
        if (typeof inner.title === 'string' && inner.title.trim()) {
          currentTitle = inner.title.trim();
        }
        if (typeof inner.context === 'string' && inner.context.trim()) {
          currentContext = inner.context.trim();
        }
        if (
          inner.status === 'superseded' ||
          inner.status === 'deprecated' ||
          inner.status === 'accepted'
        ) {
          currentStatus = inner.status;
        }
        if (typeof inner.decision === 'string' && inner.decision.trim()) {
          currentDecision = inner.decision.trim();
          continue;
        }
      }
      if (typeof parsed.text === 'string' && parsed.text.trim()) {
        currentDecision = parsed.text.trim();
        continue;
      }
      if (typeof parsed.decision === 'string' && parsed.decision.trim()) {
        if (typeof parsed.title === 'string' && parsed.title.trim()) {
          currentTitle = parsed.title.trim();
        }
        if (typeof parsed.context === 'string' && parsed.context.trim()) {
          currentContext = parsed.context.trim();
        }
        if (
          parsed.status === 'superseded' ||
          parsed.status === 'deprecated' ||
          parsed.status === 'accepted'
        ) {
          currentStatus = parsed.status;
        }
        currentDecision = parsed.decision.trim();
        continue;
      }
      break;
    } catch {
      break;
    }
  }

  return {
    title: currentTitle,
    decision: currentDecision,
    context: currentContext,
    status: currentStatus,
  };
}

function formatDecisionMarkdown(d: ProjectDecision): string {
  const statusLabel =
    d.status === 'superseded' ? 'remplacé' : d.status === 'deprecated' ? 'obsolète' : 'accepté';
  const lines = [
    `### [${d.date}] ${d.title}`,
    `- **ID** : \`${d.id}\``,
    `- **Statut** : ${statusLabel}`,
    `- **Décision** : ${d.decision}`,
  ];
  if (d.context) {
    lines.push(`- **Contexte** : ${d.context}`);
  }
  return lines.join('\n');
}
