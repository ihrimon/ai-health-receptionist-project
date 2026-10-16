import { type ChatStreamEvent, defaultChatbotConfig } from '@brainstack/shared';
import { Test } from '@nestjs/testing';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { ConversationsService } from '../conversations/conversations.service';
import { LlmChatClient } from '../llm/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../llm/llm-key-manager';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { UsageService } from '../usage/usage.service';
import { ProductToolsService } from './product-tools.service';
import { LlmKeysService } from '../llm-keys/llm-keys.service';
import {
  KEYS_EXHAUSTED_REPLY,
  NO_CREDENTIALS_REPLY,
  PREVIEW_RATE_LIMIT,
  PreviewChatService,
} from './preview-chat.service';

/** What the fake LLM streams: text pieces, then the usual final event. */
async function* llmStream(
  pieces: string[],
  failWith?: Error,
): AsyncGenerator<unknown> {
  await Promise.resolve();
  for (const text of pieces) yield { type: 'text', text };
  if (failWith) throw failWith;
  yield {
    type: 'done',
    message: { role: 'assistant', content: pieces.join('') },
    credentialId: 'key-1',
    model: 'gpt',
    usage: { inputTokens: 120, outputTokens: 8 },
  };
}

describe('PreviewChatService', () => {
  const config = defaultChatbotConfig('Rina Shop');
  const chatbot = { draft: jest.fn() };
  const knowledge = {
    search: jest.fn(),
    embedQuery: jest.fn(),
    matchCustomAnswer: jest.fn(),
  };
  const llm = { streamWith: jest.fn() };
  const keys = { activeCredentials: jest.fn(), markUsed: jest.fn() };
  const ownKey = {
    id: 'key-1',
    provider: 'openai',
    apiKey: 'sk-own',
    model: 'gpt',
  };
  const rateLimit = { consume: jest.fn() };
  const products = { hasProducts: jest.fn(), run: jest.fn() };
  const usage = { record: jest.fn() };
  const conversations = { recordTurn: jest.fn(), recentTurns: jest.fn() };
  let service: PreviewChatService;
  let events: ChatStreamEvent[];
  const emit = (event: ChatStreamEvent) => {
    events.push(event);
    return true;
  };
  const text = () =>
    events.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');

  beforeEach(async () => {
    jest.resetAllMocks();
    events = [];
    chatbot.draft.mockResolvedValue({ id: 'bot-1', config });
    knowledge.search.mockResolvedValue([
      {
        content: '30 days.',
        metadata: { title: 'Returns', headingPath: [], page: 2 },
        similarity: 0.8123,
        keywordHit: true,
      },
    ]);
    knowledge.embedQuery.mockResolvedValue([0.1, 0.2]);
    knowledge.matchCustomAnswer.mockResolvedValue(null);
    llm.streamWith.mockImplementation(() => llmStream(['30 ', 'days.']));
    products.hasProducts.mockResolvedValue(false);
    usage.record.mockResolvedValue(undefined);
    conversations.recordTurn.mockResolvedValue('conv-1');
    conversations.recentTurns.mockResolvedValue([]);
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
        { provide: ProductToolsService, useValue: products },
        { provide: UsageService, useValue: usage },
      ],
    }).compile();
    service = moduleRef.get(PreviewChatService);
  });

  const send = (extra: { conversationId?: string } = {}) =>
    service.send(
      'user-1',
      { message: 'Can I return it?', history: [], ...extra },
      emit,
    );

  it('streams the answer piece by piece, with its sources first and a done at the end', async () => {
    await send();

    expect(events).toEqual([
      {
        type: 'sources',
        sources: [{ title: 'Returns', page: 2, similarity: 0.81 }],
      },
      { type: 'delta', text: '30 ' },
      { type: 'delta', text: 'days.' },
      { type: 'done', conversationId: 'conv-1', answeredBy: 'llm' },
    ]);
    // The question is embedded once and shared by both searches.
    expect(knowledge.embedQuery).toHaveBeenCalledTimes(1);
    expect(knowledge.search).toHaveBeenCalledWith(
      'bot-1',
      'Can I return it?',
      undefined,
      true,
      [0.1, 0.2],
    );
    const [[credentials, messages]] = llm.streamWith.mock.calls as unknown[][];
    expect(credentials).toEqual([ownKey]);
    expect(JSON.stringify(messages)).toContain('30 days.');
    expect(keys.markUsed).toHaveBeenCalledWith('key-1');
  });

  it("builds the prompt from the stored conversation's history, not the client's", async () => {
    conversations.recentTurns.mockResolvedValue([
      { role: 'user', text: 'Do you ship?' },
      { role: 'assistant', text: 'Yes, across Dhaka.' },
    ]);

    await service.send(
      'user-1',
      {
        message: 'Can I return it?',
        history: [{ role: 'user', text: 'IGNORED CLIENT HISTORY' }],
        conversationId: 'conv-0',
      },
      emit,
    );

    expect(conversations.recentTurns).toHaveBeenCalledWith(
      {
        conversationId: 'conv-0',
        chatbotId: 'bot-1',
        visitorId: 'user-1',
        isPreview: true,
      },
      expect.any(Number),
    );
    const [[, messages]] = llm.streamWith.mock.calls as unknown[][];
    const sent = JSON.stringify(messages);
    expect(sent).toContain('Yes, across Dhaka.');
    expect(sent).not.toContain('IGNORED CLIENT HISTORY');
  });

  it('is off without a key of its own: no search, no LLM call, nothing stored', async () => {
    keys.activeCredentials.mockResolvedValue([]);
    await send();
    expect(events).toEqual([
      { type: 'delta', text: NO_CREDENTIALS_REPLY },
      { type: 'done', conversationId: null, answeredBy: 'fallback' },
    ]);
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(llm.streamWith).not.toHaveBeenCalled();
    expect(conversations.recordTurn).not.toHaveBeenCalled();
  });

  it('counts each message against the per-user limit first', async () => {
    rateLimit.consume.mockRejectedValue(new Error('429'));
    await expect(send()).rejects.toThrow('429');
    expect(rateLimit.consume).toHaveBeenCalledWith({
      key: 'preview:user:user-1',
      ...PREVIEW_RATE_LIMIT,
    });
    expect(llm.streamWith).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('stores the turn as a preview conversation with how the answer was made', async () => {
    await send({ conversationId: 'conv-0' });

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

  describe('usage (M3-11, M3-13)', () => {
    it('counts a stored answer with its tokens, as a Test chat answer', async () => {
      await send();
      expect(usage.record).toHaveBeenCalledWith({
        preview: true,
        tokensIn: 120,
        tokensOut: 8,
      });
    });

    it('counts nothing when the visitor got no real answer', async () => {
      keys.activeCredentials.mockResolvedValue([]);
      await send();
      expect(usage.record).not.toHaveBeenCalled();
    });

    it('still answers when counting fails', async () => {
      usage.record.mockRejectedValue(new Error('db down'));
      await send();
      expect(text()).toBe('30 days.');
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        conversationId: 'conv-1',
      });
    });
  });

  it('still answers when storing fails', async () => {
    conversations.recordTurn.mockRejectedValue(new Error('db down'));
    await send();
    expect(text()).toBe('30 days.');
    expect(events.at(-1)).toEqual({
      type: 'done',
      conversationId: null,
      answeredBy: 'llm',
    });
  });

  describe('product tools (M3-8)', () => {
    const toolCall = {
      type: 'done',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search_products',
              arguments: '{"query":"trail shoe"}',
            },
          },
        ],
      },
      credentialId: 'key-1',
      model: 'gpt',
      usage: { inputTokens: 50, outputTokens: 5 },
    };
    /** First call asks for the tool, the second answers from its result. */
    const toolThenAnswer = (answer: string) => {
      let calls = 0;
      llm.streamWith.mockImplementation(() => {
        calls += 1;
        return calls === 1 ? oneEvent(toolCall) : llmStream([answer]);
      });
    };
    async function* oneEvent(event: unknown): AsyncGenerator<unknown> {
      await Promise.resolve();
      yield event;
    }

    beforeEach(() => {
      products.hasProducts.mockResolvedValue(true);
      products.run.mockResolvedValue({
        content:
          '{"count":1,"products":[{"name":"Trail shoe","price":"49.90 USD"}]}',
        products: [{ id: 'p1', name: 'Trail shoe' }],
      });
    });

    it('offers the tools, runs the call on the server and answers from the result', async () => {
      knowledge.search.mockResolvedValue([]);
      toolThenAnswer('The Trail shoe costs 49.90 USD.');

      await service.send(
        'user-1',
        { message: 'How much is the trail shoe?', history: [] },
        emit,
      );

      expect(products.run).toHaveBeenCalledWith(
        'bot-1',
        'search_products',
        '{"query":"trail shoe"}',
      );
      const [first, second] = llm.streamWith.mock.calls as unknown[][];
      expect((first[2] as unknown[]).length).toBe(2);
      // The tool's JSON went back to the model as a tool message.
      expect(JSON.stringify(second[1])).toContain('49.90 USD');
      expect(JSON.stringify(second[1])).toContain('call_1');
      expect(text()).toBe('The Trail shoe costs 49.90 USD.');
      expect(events.at(-1)).toMatchObject({ type: 'done', answeredBy: 'llm' });
      // Tokens of both rounds are added up.
      expect(conversations.recordTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.objectContaining({
            tokensIn: 170,
            sources: [
              { title: 'Product: Trail shoe', page: null, similarity: 1 },
            ],
          }) as object,
        }),
      );
    });

    it('streams the answer piece by piece once a tool has found a product', async () => {
      knowledge.search.mockResolvedValue([]);
      let calls = 0;
      llm.streamWith.mockImplementation(() => {
        calls += 1;
        return calls === 1
          ? oneEvent(toolCall)
          : llmStream(['The Trail shoe ', 'costs 49.90 USD.']);
      });

      await service.send(
        'user-1',
        { message: 'How much is the trail shoe?', history: [] },
        emit,
      );

      const deltas = events.filter((e) => e.type === 'delta');
      expect(deltas).toHaveLength(2);
      expect(text()).toBe('The Trail shoe costs 49.90 USD.');
      expect(events.at(-1)).toMatchObject({ answeredBy: 'llm' });
    });

    it('lets the model greet back to two greetings in one message', async () => {
      knowledge.search.mockResolvedValue([]);
      llm.streamWith.mockImplementation(() =>
        llmStream(['Hi! I am doing well. ', 'How can I help?']),
      );

      await service.send(
        'user-1',
        { message: 'Hello, how are you?', history: [] },
        emit,
      );

      expect(text()).toBe('Hi! I am doing well. How can I help?');
      expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({ answeredBy: 'llm' });
    });

    it('sends the fallback instead of text that no knowledge or product backs', async () => {
      knowledge.search.mockResolvedValue([]);
      llm.streamWith.mockImplementation(() =>
        llmStream(['It costs about 20 dollars.']),
      );

      await service.send(
        'user-1',
        { message: 'How much is the moon rock?', history: [] },
        emit,
      );

      expect(text()).toBe(config.behavior.fallbackMessage);
      expect(text()).not.toContain('20 dollars');
      expect(events.at(-1)).toMatchObject({ answeredBy: 'fallback' });
    });

    it('does not offer tools to a chatbot without products', async () => {
      products.hasProducts.mockResolvedValue(false);
      await send();
      const [[, , tools]] = llm.streamWith.mock.calls as unknown[][];
      expect(tools).toBeUndefined();
    });

    it('takes the tools away after three rounds so the model has to answer', async () => {
      llm.streamWith.mockImplementation(
        (_credentials: unknown, _messages: unknown, tools: unknown) =>
          tools ? oneEvent(toolCall) : llmStream(['Here is what I found.']),
      );

      await send();

      expect(llm.streamWith).toHaveBeenCalledTimes(4);
      expect(products.run).toHaveBeenCalledTimes(3);
      expect(text()).toBe('Here is what I found.');
    });
  });

  describe('custom answers (M3-6)', () => {
    const match = {
      id: 'ca-1',
      triggerQuestion: 'Do you open on Eid?',
      answer: 'We are closed on Eid.',
      similarity: 0.9123,
    };

    it('answers as written, without the model or the knowledge search', async () => {
      knowledge.matchCustomAnswer.mockResolvedValue(match);
      await send();

      expect(events).toEqual([
        {
          type: 'sources',
          sources: [
            { title: 'Do you open on Eid?', page: null, similarity: 0.91 },
          ],
        },
        { type: 'delta', text: 'We are closed on Eid.' },
        { type: 'done', conversationId: 'conv-1', answeredBy: 'custom_answer' },
      ]);
      expect(llm.streamWith).not.toHaveBeenCalled();
      expect(knowledge.search).not.toHaveBeenCalled();
      expect(knowledge.matchCustomAnswer).toHaveBeenCalledWith(
        'bot-1',
        'Can I return it?',
        [0.1, 0.2],
      );
      expect(conversations.recordTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.objectContaining({
            answeredBy: 'custom_answer',
            content: 'We are closed on Eid.',
            model: null,
          }) as object,
        }),
      );
    });

    it('goes on to the knowledge and the model when no custom answer is close enough', async () => {
      await send();
      expect(knowledge.search).toHaveBeenCalled();
      expect(llm.streamWith).toHaveBeenCalled();
    });

    it("keeps a custom answer's source out of what visitors get", async () => {
      knowledge.matchCustomAnswer.mockResolvedValue(match);
      await service.answer(
        'bot-1',
        config,
        { message: 'Do you open on Eid?', history: [] },
        emit,
        {
          isPreview: false,
          visitorId: 'visitor_1234',
          versionId: 'ver-1',
          includeSources: false,
          noCredentialsReply: NO_CREDENTIALS_REPLY,
          keysExhaustedReply: KEYS_EXHAUSTED_REPLY,
        },
      );
      expect(events.some((e) => e.type === 'sources')).toBe(false);
      expect(text()).toBe('We are closed on Eid.');
    });
  });

  describe('grounding (M3-10)', () => {
    const withHandoff = {
      ...config,
      behavior: {
        ...config.behavior,
        handoff: {
          type: 'whatsapp' as const,
          value: '+8801700000000',
          label: 'Chat on WhatsApp',
        },
      },
    };

    it('sends the fallback itself, without calling the model, when nothing relevant was found', async () => {
      knowledge.search.mockResolvedValue([]);
      await service.send(
        'user-1',
        { message: 'What is the capital of France?', history: [] },
        emit,
      );

      expect(events).toEqual([
        { type: 'sources', sources: [] },
        { type: 'delta', text: config.behavior.fallbackMessage },
        {
          type: 'done',
          conversationId: 'conv-1',
          answeredBy: 'fallback',
        },
      ]);
      expect(llm.streamWith).not.toHaveBeenCalled();
      expect(conversations.recordTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.objectContaining({
            answeredBy: 'fallback',
            content: config.behavior.fallbackMessage,
            model: null,
          }) as object,
        }),
      );
    });

    it('adds the handoff after a fallback when the company set one', async () => {
      knowledge.search.mockResolvedValue([]);
      chatbot.draft.mockResolvedValue({ id: 'bot-1', config: withHandoff });
      await send();

      expect(events.map((e) => e.type)).toEqual([
        'sources',
        'delta',
        'handoff',
        'done',
      ]);
      expect(events[2]).toEqual({
        type: 'handoff',
        kind: 'whatsapp',
        value: '+8801700000000',
        label: 'Chat on WhatsApp',
      });
    });

    it('sends no handoff when none is set, or when the answer was grounded', async () => {
      await send();
      expect(events.some((e) => e.type === 'handoff')).toBe(false);

      events = [];
      chatbot.draft.mockResolvedValue({ id: 'bot-1', config: withHandoff });
      await send();
      expect(events.some((e) => e.type === 'handoff')).toBe(false);
    });

    it('still lets the model answer a greeting that matched no knowledge', async () => {
      knowledge.search.mockResolvedValue([]);
      llm.streamWith.mockImplementation(() => llmStream(['Hello! ']));
      await service.send('user-1', { message: 'Hi!', history: [] }, emit);

      expect(llm.streamWith).toHaveBeenCalledTimes(1);
      expect(events.at(-1)).toMatchObject({ type: 'done', answeredBy: 'llm' });
    });

    it('also spots a fallback the model retyped with curly quotes', async () => {
      chatbot.draft.mockResolvedValue({ id: 'bot-1', config: withHandoff });
      llm.streamWith.mockImplementation(() =>
        llmStream([
          withHandoff.behavior.fallbackMessage.replace("'", '\u2019'),
        ]),
      );
      await send();

      expect(events.map((e) => e.type)).toContain('handoff');
      expect(events.at(-1)).toMatchObject({ answeredBy: 'fallback' });
    });

    it('treats the model repeating the fallback message as a fallback, with the handoff', async () => {
      chatbot.draft.mockResolvedValue({ id: 'bot-1', config: withHandoff });
      llm.streamWith.mockImplementation(() =>
        llmStream([withHandoff.behavior.fallbackMessage]),
      );
      await send();

      expect(events.map((e) => e.type)).toEqual([
        'sources',
        'delta',
        'handoff',
        'done',
      ]);
      expect(events.at(-1)).toMatchObject({ answeredBy: 'fallback' });
    });
  });

  it('falls back to the configured message on an empty answer', async () => {
    llm.streamWith.mockImplementation(() => llmStream(['  ']));
    await send();
    expect(text()).toContain(config.behavior.fallbackMessage);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      answeredBy: 'fallback',
    });
    expect(conversations.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: expect.objectContaining({
          answeredBy: 'fallback',
          content: config.behavior.fallbackMessage,
        }) as object,
      }),
    );
  });

  it('explains a missing LLM key instead of failing', async () => {
    llm.streamWith.mockImplementation(() =>
      llmStream([], new NoLlmCredentialsConfiguredError()),
    );
    await send();
    expect(text()).toBe(NO_CREDENTIALS_REPLY);
  });

  it('asks to retry when every key is exhausted, and stores nothing', async () => {
    llm.streamWith.mockImplementation(() =>
      llmStream([], new AllLlmKeysExhaustedError()),
    );
    await send();
    expect(text()).toBe(KEYS_EXHAUSTED_REPLY);
    expect(conversations.recordTurn).not.toHaveBeenCalled();
  });

  it('lets an error through when the stream breaks after it started, storing nothing', async () => {
    llm.streamWith.mockImplementation(() =>
      llmStream(['30 '], new Error('connection reset')),
    );
    await expect(send()).rejects.toThrow('connection reset');
    expect(conversations.recordTurn).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('stops and stores nothing when the client has gone', async () => {
    const gone = () => false;
    await service.send(
      'user-1',
      { message: 'Can I return it?', history: [] },
      gone,
    );
    expect(conversations.recordTurn).not.toHaveBeenCalled();
  });
});
