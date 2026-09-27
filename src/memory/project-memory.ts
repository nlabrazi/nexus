import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DecisionRecordInput, ProjectDecision, ProjectMemorySnapshot } from './types';

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

  getSnapshot(rootPath: string): ProjectMemorySnapshot {
    const filePath = this.getMemoryPath(rootPath);
    const exists = existsSync(filePath);
    const rawContent = this.readMemory(rootPath);
    const decisions = this.listDecisions(rootPath);

    return {
      rootPath,
      memoryFilePath: filePath,
      exists,
      rawContent,
      decisions,
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
