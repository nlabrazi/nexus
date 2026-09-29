/** Application-provided metadata for discussion, never authority to access a project. */
export interface ConversationProjectContext {
  readonly name: string;
  readonly branch?: string;
  readonly preferences?: string;
  readonly decisionsSummary?: string;
}

export interface ConversationInput {
  /** Nexus dialogue identifier, independent of any coding agent session identifier. */
  readonly conversationId: string;
  readonly message: string;
  readonly project?: ConversationProjectContext;
}

export interface ConversationReply {
  /** User-facing text. A reply does not grant permission to execute an action. */
  readonly text: string;
}

/**
 * Owns the dialogue state, clarification and synthesis for a Nexus conversation.
 * Technical operations belong to a separate, controlled coding agent tool bridge.
 */
export interface ConversationalAgent {
  /**
   * Handles one user message. Implementations must reject an aborted turn and
   * prevent further tool dispatch for that turn after cancellation.
   */
  respond(input: ConversationInput, signal: AbortSignal): Promise<ConversationReply>;
}
