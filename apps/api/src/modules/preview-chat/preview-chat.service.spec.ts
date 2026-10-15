import { defaultChatbotConfig } from '@brainstack/shared';
import { Test } from '@nestjs/testing';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { LlmChatClient } from '../chat/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../chat/llm-key-manager';
import { KnowledgeService } from '../knowledge/knowledge.service';
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
  const llm = { complete: jest.fn() };
  const rateLimit = { consume: jest.fn() };
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
    llm.complete.mockResolvedValue({
      role: 'assistant',
      content: ' 30 days. ',
    });
    rateLimit.consume.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PreviewChatService,
        { provide: ChatbotService, useValue: chatbot },
        { provide: KnowledgeService, useValue: knowledge },
        { provide: LlmChatClient, useValue: llm },
        { provide: RateLimitService, useValue: rateLimit },
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
    });
    expect(knowledge.search).toHaveBeenCalledWith('bot-1', 'Can I return it?');
    const [[messages]] = llm.complete.mock.calls as unknown[][];
    expect(JSON.stringify(messages)).toContain('30 days.');
  });

  it('counts each message against the per-user limit first', async () => {
    rateLimit.consume.mockRejectedValue(new Error('429'));
    await expect(send()).rejects.toThrow('429');
    expect(rateLimit.consume).toHaveBeenCalledWith({
      key: 'preview:user:user-1',
      ...PREVIEW_RATE_LIMIT,
    });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('falls back to the configured message on an empty reply', async () => {
    llm.complete.mockResolvedValue({ role: 'assistant', content: '  ' });
    expect((await send()).reply).toBe(config.behavior.fallbackMessage);
  });

  it('explains a missing LLM key instead of failing', async () => {
    llm.complete.mockRejectedValue(new NoLlmCredentialsConfiguredError());
    expect((await send()).reply).toBe(NO_CREDENTIALS_REPLY);
  });

  it('asks to retry when every key is exhausted', async () => {
    llm.complete.mockRejectedValue(new AllLlmKeysExhaustedError());
    expect((await send()).reply).toBe(KEYS_EXHAUSTED_REPLY);
  });

  it('lets other errors through', async () => {
    llm.complete.mockRejectedValue(new Error('boom'));
    await expect(send()).rejects.toThrow('boom');
  });
});
