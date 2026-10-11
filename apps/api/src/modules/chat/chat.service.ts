import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversationsService } from '../conversations/conversations.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from './llm-key-manager';
import { ChatTurn, LlmChatClient } from './llm-chat.client';

const CHAT_SESSION_PREFIX = 'chat-';
const LLM_UNAVAILABLE_REPLY =
  "Sorry, I'm having trouble processing that right now — could you try again in a moment?";
const EMPTY_REPLY_FALLBACK =
  "Sorry, could you say that again? I didn't catch a response there.";
const ALL_KEYS_EXHAUSTED_REPLY =
  "I'm getting a lot of requests right now — give me a moment and try again, we'll pick up right where we left off.";
const NO_CREDENTIALS_REPLY =
  "Sorry, the AI assistant isn't set up yet — an admin needs to add an API key under Settings.";

export interface ChatReply {
  sessionId: string;
  reply: string;
}

/**
 * Interim single-tenant RAG Q&A chat for the platform branch (M1): the
 * booking flow and its tools are gone, and M3 replaces this whole service
 * with the tenant-aware public-chat pipeline (docs/requirements.md §9).
 *
 * Every conversation is persisted from its first turn. Once a row exists
 * for the session it is the source of truth for history; the
 * caller-supplied `dto.transcript` is only used for a session the server
 * hasn't seen yet.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llmChatClient: LlmChatClient,
    private readonly conversationsService: ConversationsService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async sendMessage(dto: SendChatMessageDto): Promise<ChatReply> {
    const existingConversation = dto.sessionId
      ? await this.conversationsService.findByCallSid(
          this.toCallSid(dto.sessionId),
        )
      : null;
    const sessionId = dto.sessionId ?? randomUUID();

    const priorTranscript: ChatTurn[] = existingConversation
      ? ((existingConversation.transcript as ChatTurn[] | undefined) ?? [])
      : (dto.transcript ?? []);
    const transcript: ChatTurn[] = [
      ...priorTranscript,
      { role: 'user', text: dto.message },
    ];

    const referenceChunks = await this.getReferenceChunks(dto.message);
    const messages = this.llmChatClient.buildMessages(
      transcript,
      referenceChunks,
    );
    const { reply, succeeded } = await this.generateReply(messages);
    // A failed LLM call isn't persisted: the apology isn't a real answer,
    // and saving it would feed it back to the model as history on retry.
    if (!succeeded) {
      return { sessionId, reply };
    }

    const transcriptToSave = [
      ...transcript,
      { role: 'model', text: reply },
    ] as unknown as Record<string, unknown>[];
    const conversation =
      existingConversation ??
      (await this.conversationsService.create({
        callSid: this.toCallSid(sessionId),
      }));
    await this.conversationsService.appendTurn(conversation.id, {
      transcript: transcriptToSave,
    });

    return { sessionId, reply };
  }

  /**
   * Public — called from the chat UI's star-rating modal, which has no
   * admin session. Looked up by the chat sessionId (never the
   * conversation's internal id, which the caller never sees) so a rating
   * can only be attached to the conversation the rater was part of.
   */
  async rateConversation(sessionId: string, rating: number): Promise<void> {
    const conversation = await this.conversationsService.findByCallSid(
      this.toCallSid(sessionId),
    );
    if (!conversation) {
      throw new NotFoundException(`No conversation for session ${sessionId}`);
    }
    await this.conversationsService.rate(conversation.id, rating);
  }

  private async generateReply(
    messages: ReturnType<LlmChatClient['buildMessages']>,
  ): Promise<{ reply: string; succeeded: boolean }> {
    try {
      const message = await this.llmChatClient.complete(messages);
      // The model occasionally returns a completely empty completion (seen
      // from a free-tier model under load). Saving an empty reply would
      // re-send it on every later turn — see chat-turn.dto.ts.
      return {
        reply: message.content || EMPTY_REPLY_FALLBACK,
        succeeded: true,
      };
    } catch (err) {
      // A live LLM API call is an external dependency that can fail
      // transiently — reply gracefully instead of crashing the turn.
      // AllLlmKeysExhaustedError means LlmChatClient already tried every
      // configured credential; NoLlmCredentialsConfiguredError means
      // Settings is empty.
      this.logger.warn(
        `LlmChatClient.complete failed: ${(err as Error).message}`,
      );
      if (err instanceof NoLlmCredentialsConfiguredError) {
        return { reply: NO_CREDENTIALS_REPLY, succeeded: false };
      }
      if (err instanceof AllLlmKeysExhaustedError) {
        return { reply: ALL_KEYS_EXHAUSTED_REPLY, succeeded: false };
      }
      return { reply: LLM_UNAVAILABLE_REPLY, succeeded: false };
    }
  }

  private toCallSid(sessionId: string): string {
    return `${CHAT_SESSION_PREFIX}${sessionId}`;
  }

  private async getReferenceChunks(message: string): Promise<string[]> {
    try {
      const matches = await this.knowledgeService.search(message);
      return matches.map((match) => match.content);
    } catch (err) {
      // Chat should keep working without RAG context (e.g. the pgvector
      // migration not applied yet) rather than fail the turn.
      this.logger.warn(
        `Knowledge retrieval unavailable: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
