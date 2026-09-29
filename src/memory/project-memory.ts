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

const INITIAL_HEADER = `# Mémoire de Décisions Nexus

Ce fichier consigne les décisions architecturales et choix techniques structurants du projet.
Nexus Brain et les agents s'y réfèrent pour conserver le contexte technique d'une session à l'autre.

## Décisions
`;

export class ProjectMemory {
  getMemoryPath(rootPath: string): string {
    return resolve(rootPath, '.nexus', 'memory.md');
  }

  hasMemory(rootPath: string): boolean {
    return existsSync(this.getMemoryPath(rootPath));
  }

  readMemory(rootPath: string): string {
    const filePath = this.getMemoryPath(rootPath);
    if (!existsSync(filePath)) {
      return '';
    }
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      return '';
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
    const title = input.title.trim();
    if (!title) {
      throw new Error('Le titre de la décision ne peut pas être vide.');
    }
    const decisionText = input.decision.trim();
    if (!decisionText) {
      throw new Error('Le corps de la décision ne peut pas être vide.');
    }

    const filePath = this.getMemoryPath(rootPath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const id = `dec-${now.getTime().toString(36)}-${randomUUID().slice(0, 4)}`;
    const status: ProjectDecision['status'] = input.status ?? 'accepted';
    const context = input.context?.trim();

    const decision: ProjectDecision = {
      id,
      date: dateStr,
      title,
      decision: decisionText,
      context: context || undefined,
      status,
    };

    let existingContent = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
    if (!existingContent.trim()) {
      existingContent = INITIAL_HEADER;
    }

    const entryMarkdown = formatDecisionMarkdown(decision);
    const newContent = `${existingContent.trimEnd()}\n\n${entryMarkdown}\n`;
    writeFileSync(filePath, newContent, 'utf-8');

    return decision;
  }

  getPreferencesPath(rootPath: string): string {
    return resolve(rootPath, '.nexus', 'preferences.md');
  }

  getGlobalPreferencesPath(): string {
    return resolve(homedir(), '.nexus', 'preferences.md');
  }

  readPreferences(rootPath: string): string {
    const parts: string[] = [];
    try {
      const globalPath = this.getGlobalPreferencesPath();
      if (existsSync(globalPath)) {
        const globalContent = readFileSync(globalPath, 'utf-8').trim();
        if (globalContent) parts.push(globalContent);
      }
    } catch {
      // Ignore filesystem errors
    }
    try {
      const localPath = this.getPreferencesPath(rootPath);
      if (existsSync(localPath)) {
        const localContent = readFileSync(localPath, 'utf-8').trim();
        if (localContent) parts.push(localContent);
      }
    } catch {
      // Ignore filesystem errors
    }
    return parts.join('\n\n');
  }

  setPreferences(rootPath: string, content: string): void {
    const filePath = this.getPreferencesPath(rootPath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content.trim(), 'utf-8');
  }

  formatActiveDecisions(rootPath: string, maxDecisions = 8, maxChars = 2000): string {
    const decisions = this.listDecisions(rootPath).filter((d) => d.status === 'accepted');
    if (decisions.length === 0) {
      return '';
    }
    const selected = decisions.slice(-maxDecisions);
    const formattedLines: string[] = [];
    let currentLength = 0;

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
    const exists = existsSync(filePath);
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
    const filePath = this.getMemoryPath(rootPath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, INITIAL_HEADER, 'utf-8');
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

      const decision = decisionMatch ? decisionMatch[1].trim() : body.trim();
      const context = contextMatch ? contextMatch[1].trim() : undefined;

      decisions.push({
        id,
        date,
        title,
        decision,
        context,
        status,
      });
    }

    return decisions;
  }
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
