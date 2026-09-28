/** One user-facing state, with connection and active work taking priority. */
export function getAssistantState({ online, sending, busy, backend, speaking, failed }) {
  if (!online) return 'OFFLINE';
  if (sending || busy) return backend === 'codex' || backend === 'antigravity' ? 'CODING' : 'THINKING';
  if (speaking) return 'SPEAKING';
  if (failed) return 'ERROR';
  return 'READY';
}

export const assistantStateLabels = {
  READY: 'Prêt à recevoir votre message',
  THINKING: 'Nexus réfléchit',
  CODING: 'Votre agent travaille sur le code',
  SPEAKING: 'Lecture de la réponse',
  ERROR: 'La dernière demande a échoué',
  OFFLINE: 'Votre poste est hors ligne',
};


export function getInteractionMessage(task, backend) {
  if (!task) return 'Envoi de votre demande…';
  if (task.status === 'pending' || task.stage === 'starting') return 'Demande reçue…';
  if (task.status === 'cancelled') return 'Arrêt de la demande…';
  if (task.stage === 'inspecting') return 'Analyse du projet…';
  if (task.stage === 'synthesizing') return 'Préparation de la réponse…';
  return backend === 'brain' ? 'Nexus réfléchit…' : 'Votre agent travaille…';
}
