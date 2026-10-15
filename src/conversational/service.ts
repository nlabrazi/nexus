import { BrainSessionPersistence } from './persistence';
import { DecisionRecordInput } from '../memory/types';
import { BrainMessage, BrainModel } from './model';
import { CodingAgentTools } from './tools';
import { ConversationInput, ConversationReply, ConversationalAgent } from './types';

/** Small, bounded dialogue loop. Tool consent is handled by the application, never by the model. */
export class ConversationalService implements ConversationalAgent {
  private readonly conversations = new Map<string, { context: string; messages: BrainMessage[] }>();
  private running = false;

  constructor(
    private readonly model: BrainModel,
    private readonly tools: CodingAgentTools,
    private readonly persistence?: BrainSessionPersistence
  ) {}

  async clearConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
    if (this.persistence) {
      await this.persistence.clear(conversationId);
    }
  }

  getConversationMessages(conversationId: string): readonly BrainMessage[] | undefined {
    return this.conversations.get(conversationId)?.messages;
  }

  async respond(input: ConversationInput, signal: AbortSignal): Promise<ConversationReply> {
    signal.throwIfAborted();
    if (!input.conversationId.trim() || !input.message.trim() || input.message.length > 16000) {
      throw new Error('Le message ou l’identifiant de conversation est invalide.');
    }
    const trimmedMessage = input.message.trim();
    if (trimmedMessage.toLowerCase() === '/reset' || trimmedMessage.toLowerCase() === 'reset') {
      await this.clearConversation(input.conversationId);
      return {
        text: '🧠 Conversation Nexus Brain réinitialisée. Nouveau fil de discussion démarré.',
      };
    }
    if (this.running) {
      throw new Error('Une conversation Nexus est déjà en cours.');
    }
    this.running = true;
    try {
      const context = JSON.stringify(input.project ?? null);
      let previous = this.conversations.get(input.conversationId);
      if (!previous && this.persistence) {
        const persisted = await this.persistence.load(input.conversationId);
        if (persisted && persisted.context === context) {
          previous = { context: persisted.context, messages: [...persisted.messages] };
          this.conversations.set(input.conversationId, previous);
        }
      }
      const messages: BrainMessage[] = [
        ...(previous?.context === context ? previous.messages : []),
        { role: 'user', text: trimmedMessage },
      ];
      let inspected = false;
      for (let step = 0; step < 3; step++) {
        const decision = await this.model.decide(messages, input.project, step < 2, signal);
        signal.throwIfAborted();
        if (decision.action === 'reply') {
          if (!decision.text.trim()) {
            throw new Error('Nexus a renvoyé une réponse vide.');
          }
          messages.push({ role: 'assistant', text: decision.text });
          const boundedMessages = messages.slice(-20);
          this.conversations.delete(input.conversationId);
          this.conversations.set(input.conversationId, { context, messages: boundedMessages });
          if (this.conversations.size > 20) {
            this.conversations.delete(this.conversations.keys().next().value!);
          }
          if (this.persistence) {
            await this.persistence.save({
              version: 1,
              conversationId: input.conversationId,
              context,
              messages: boundedMessages,
              updatedAt: Date.now(),
            });
          }
          return { text: decision.text };
        }
        if (step === 2 || (decision.action === 'inspect_project' && inspected)) {
          throw new Error('Nexus a atteint la limite d’outils de ce tour. Reformulez la demande.');
        }
        let observation: string;
        try {
          if (decision.action === 'get_project_status') {
            observation = JSON.stringify(await this.tools.getProjectStatus(signal));
          } else if (decision.action === 'list_projects') {
            observation = JSON.stringify(await this.tools.listProjects(signal));
          } else if (decision.action === 'switch_project') {
            observation = JSON.stringify(await this.tools.switchProject(decision.text, signal));
          } else if (decision.action === 'inspect_project') {
            inspected = true;
            observation = await this.tools.inspectProject(decision.text, signal);
          } else if (decision.action === 'get_project_memory') {
            observation = JSON.stringify(await this.tools.getProjectMemory(signal));
          } else if (decision.action === 'record_decision') {
            let parsedInput: DecisionRecordInput;
            try {
              const obj = JSON.parse(decision.text);
              if (
                typeof obj === 'object' &&
                obj !== null &&
                typeof obj.title === 'string' &&
                typeof obj.decision === 'string'
              ) {
                parsedInput = {
                  title: obj.title,
                  decision: obj.decision,
                  context: typeof obj.context === 'string' ? obj.context : undefined,
                  status:
                    obj.status === 'superseded' || obj.status === 'deprecated'
                      ? obj.status
                      : 'accepted',
                };
              } else {
                throw new Error('Format invalide');
              }
            } catch {
              parsedInput = {
                title: 'Décision technique',
                decision: decision.text,
              };
            }
            observation = JSON.stringify(await this.tools.recordDecision(parsedInput, signal));
          } else {
            throw new Error('Outil Nexus inconnu.');
          }
        } catch (error) {
          signal.throwIfAborted();
          observation = `Échec de ${decision.action} : ${error instanceof Error ? error.message : 'outil indisponible'}`;
        }
        signal.throwIfAborted();
        messages.push({
          role: 'tool',
          text: JSON.stringify({
            action: decision.action,
            question: decision.text,
            result: observation.slice(0, 24000),
          }),
        });
      }
      throw new Error('Nexus n’a pas produit de réponse.');
    } finally {
      this.running = false;
    }
  }
}
