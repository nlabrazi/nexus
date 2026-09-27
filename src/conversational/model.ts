import { ConversationProjectContext } from './types';

export interface BrainMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
}

export interface BrainDecision {
  readonly action:
  | 'reply'
  | 'get_project_status'
  | 'inspect_project'
  | 'get_project_memory'
  | 'record_decision';
  readonly text: string;
}

export interface BrainModel {
  decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision>;
}
