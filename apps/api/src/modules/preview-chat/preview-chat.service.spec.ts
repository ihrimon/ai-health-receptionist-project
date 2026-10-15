import { defaultChatbotConfig } from '@brainstack/shared';
import { Test } from '@nestjs/testing';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { LlmChatClient } from '../llm/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../llm/llm-key-manager';
import { ConversationsService } from '../conversations/conversations.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LlmKeysService } from '../llm-keys/llm-keys.service';
import {
  KEYS_EXHAUSTED_REPLY,
  NO_CREDENTIALS_REPLY,
  PREVIEW_RATE_LIMIT,
  PreviewChatService,
} from './preview-chat.service';

describe('PreviewChatService', () => {
  const config = defaultChatbotConfig('Rina Shop');
  const chatbot = { draft: jest.fn() };
  const knowledge = { search: jest.fn() };
  const llm = { completeWith: jest.fn() };
  const keys = { activeCredentials: jest.fn(), markUsed: jest.fn() };
  const ownKey = {
    id: 'key-1',
    provider: 'openai',
    apiKey: 'sk-own',
    model: 'gpt',
  };
  const rateLimit = { consume: jest.fn() };
  const conversations = { recordTurn: jest.fn() };
  let service: PreviewChatService;

  beforeEach(async () => {
    jest.resetAllMocks();
    chatbot.draft.mockResolvedValue({ id: 'bot-1', config });
    knowledge.search.mockResolvedValue([
      {
        content: '30 days.',
        metadata: { title: 'Returns', headingPath: [], page: 2 },
        similarity: 0.8123,
      },
    ]);
    llm.completeWith.mockResolvedValue({
      message: { role: 'assistant', content: ' 30 days. ' },
      credentialId: 'key-1',
      model: 'gpt',
      usage: { inputTokens: 120, outputTokens: 8 },
    });
    conversations.recordTurn.mockResolvedValue('conv-1');
    keys.activeCredentials.mockResolvedValue([ownKey]);
    keys.markUsed.mockResolvedValue(undefined);
    rateLimit.consume.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PreviewChatService,
        { provide: ChatbotService, useValue: chatbot },
        { provide: KnowledgeService, useValue: knowledge },
        { provide: LlmChatClient, useValue: llm },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: LlmKeysService, useValue: keys },
        { provide: ConversationsService, useValue: conversations },
      ],
    }).compile();
    service = moduleRef.get(PreviewChatService);
  });

  const send = () =>
    service.send('user-1', { message: 'Can I return it?', history: [] });

  it("answers with the LLM's reply and the chunks it was given", async () => {
    await expect(send()).resolves.toEqual({
      reply: '30 days.',
      sources: [{ title: 'Returns', page: 2, similarity: 0.81 }],
      conversationId: 'conv-1',
    });
    expect(knowledge.search).toHaveBeenCalledWith('bot-1', 'Can I return it?');
    const [[credentials, messages]] = llm.completeWith.mock
      .calls as unknown[][];
    expect(credentials).toEqual([ownKey]);
    expect(JSON.stringify(messages)).toContain('30 days.');
    expect(keys.markUsed).toHaveBeenCalledWith('key-1');
  });

  it('is off without a key of its own: no search, no LLM call', async () => {
    keys.activeCredentials.mockResolvedValue([]);
    await expect(send()).resolves.toEqual({
      reply: NO_CREDENTIALS_REPLY,
      sources: [],
      conversationId: null,
    });
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(llm.completeWith).not.toHaveBeenCalled();
    expect(conversations.recordTurn).not.toHaveBeenCalled();
  });

  it('stores the turn as a preview conversation with how the answer was made', async () => {
    await service.send('user-1', {
      message: 'Can I return it?',
      history: [],
      conversationId: 'conv-0',
    });

    expect(conversations.recordTurn).toHaveBeenCalledWith({
      chatbotId: 'bot-1',
      conversationId: 'conv-0',
      visitorId: 'user-1',
      isPreview: true,
      versionId: null,
      userText: 'Can I return it?',
      answer: {
        content: '30 days.',
        sources: [{ title: 'Returns', page: 2, similarity: 0.81 }],
        answeredBy: 'llm',
        model: 'gpt',
        tokensIn: 120,
        tokensOut: 8,
        latencyMs: expect.any(Number) as number,
      },
    });
  });

  it('still answers when storing fails', async () => {
    conversations.recordTurn.mockRejectedValue(new Error('db down'));
    await expect(send()).resolves.toMatchObject({
      reply: '30 days.',
      conversationId: null,
    });
  });

  it('counts each message against the per-user limit first', async () => {
    rateLimit.consume.mockRejectedValue(new Error('429'));
    await expect(send()).rejects.toThrow('429');
    expect(rateLimit.consume).toHaveBeenCalledWith({
      key: 'preview:user:user-1',
      ...PREVIEW_RATE_LIMIT,
    });
    expect(llm.completeWith).not.toHaveBeenCalled();
  });

  it('falls back to the configured message on an empty reply', async () => {
    llm.completeWith.mockResolvedValue({
      message: { role: 'assistant', content: '  ' },
      credentialId: 'key-1',
    });
    expect((await send()).reply).toBe(config.behavior.fallbackMessage);
    expect(conversations.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: expect.objectContaining({ answeredBy: 'fallback' }) as object,
      }),
    );
  });

  it('explains a missing LLM key instead of failing', async () => {
    llm.completeWith.mockRejectedValue(new NoLlmCredentialsConfiguredError());
    expect((await send()).reply).toBe(NO_CREDENTIALS_REPLY);
  });

  it('asks to retry when every key is exhausted', async () => {
    llm.completeWith.mockRejectedValue(new AllLlmKeysExhaustedError());
    expect((await send()).reply).toBe(KEYS_EXHAUSTED_REPLY);
    expect(conversations.recordTurn).not.toHaveBeenCalled();
  });

  it('lets other errors through', async () => {
    llm.completeWith.mockRejectedValue(new Error('boom'));
    await expect(send()).rejects.toThrow('boom');
  });
});
