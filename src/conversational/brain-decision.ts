import { BrainDecision } from './model';
import { ConversationProjectContext } from './types';

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

export function brainSystemPrompt(
  project: ConversationProjectContext | undefined,
  toolsAllowed: boolean
): string {
  const parts: string[] = [BRAIN_INSTRUCTIONS];
  if (project) {
    parts.push(`Contexte projet : ${project.name} (branche: ${project.branch ?? 'aucune'})`);
    if (project.decisionsSummary) {
      parts.push(`Décisions architecturales actives consignées :\n${project.decisionsSummary}`);
    }
  } else {
    parts.push('Aucun projet spécifique ciblé (espace racine /code)');
  }
  parts.push(`Outils autorisés : ${toolsAllowed ? 'oui' : 'non'}.`);
  return parts.join('\n\n');
}

export function parseBrainDecision(
  raw: string,
  toolsAllowed: boolean,
  strict = true
): BrainDecision {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    if (strict) { throw new Error('Invalid decision JSON'); }
    return { action: 'reply', text: raw || 'Je n’ai pas pu générer de réponse intelligible.' };
  }
  if (!parsed || typeof parsed !== 'object') { throw new Error('Invalid decision'); }
  const value = parsed as Record<string, unknown>;
  const action = value.action as BrainDecision['action'];
  if (!VALID_ACTIONS.has(action) || typeof value.text !== 'string' || !value.text.trim()) {
    if (strict) { throw new Error('Invalid decision shape'); }
    return { action: 'reply', text: typeof value.text === 'string' ? value.text : raw };
  }
  if (!toolsAllowed && action !== 'reply') { throw new Error('Tools are disabled'); }
  return { action, text: value.text };
}
