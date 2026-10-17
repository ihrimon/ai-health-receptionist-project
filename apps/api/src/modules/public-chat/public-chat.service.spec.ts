import {
  type ChatStreamEvent,
  defaultChatbotConfig,
  PUBLIC_CHAT_SIZES,
} from '@brainstack/shared';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { currentTenant } from '../../tenancy/tenant-context';
import { ConversationsService } from '../conversations/conversations.service';
import { PreviewChatService } from '../preview-chat/preview-chat.service';
import { ConversationTokenService } from './conversation-token.service';
import {
  PUBLIC_CHAT_LIMITS,
  PublicChatService,
  VISITOR_BUSY_REPLY,
  VISITOR_LIMIT_REPLY,
  VISITOR_UNAVAILABLE_REPLY,
} from './public-chat.service';

const CONVERSATION = '5b0d3c1e-7a5c-4b88-9f0a-0a6f2f7d9a11';

describe('PublicChatService', () => {
  const config = defaultChatbotConfig('Rina Shop');
  const liveRow = {
    id: 'bot-1',
    workspaceId: 'ws-1',
    status: 'ENABLED',
    workspace: { status: 'ACTIVE' },
    publishedVersion: { id: 'ver-1', config },
  };
  const prisma = { chatbot: { findUnique: jest.fn() } };
  const rateLimit = { consume: jest.fn() };
  const preview = { answer: jest.fn() };
  const conversations = {
    start: jest.fn(),
    find: jest.fn(),
    messages: jest.fn(),
  };
  const tokens = { sign: jest.fn(), verify: jest.fn() };
  let service: PublicChatService;
  let events: ChatStreamEvent[];
  const emit = (event: ChatStreamEvent) => {
    events.push(event);
    return true;
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    events = [];
    prisma.chatbot.findUnique.mockResolvedValue(liveRow);
    rateLimit.consume.mockResolvedValue(undefined);
    preview.answer.mockResolvedValue(undefined);
    conversations.start.mockResolvedValue(CONVERSATION);
    conversations.find.mockResolvedValue({
      id: CONVERSATION,
      visitorId: 'visitor_1234',
      messageCount: 2,
    });
    tokens.sign.mockReturnValue('signed-token');
    tokens.verify.mockReturnValue({
      conversationId: CONVERSATION,
      chatbotId: 'bot-1',
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: PreviewChatService, useValue: preview },
        { provide: ConversationsService, useValue: conversations },
        { provide: ConversationTokenService, useValue: tokens },
      ],
    }).compile();
    service = moduleRef.get(PublicChatService);
  });

  const send = (token: string | null = 'signed-token') =>
    service.send(CONVERSATION, token, '1.2.3.4', { message: 'Hi' }, emit);

  it('shows the published look and greeting', async () => {
    await expect(service.config('cb_abc')).resolves.toMatchObject({
      botName: config.identity.botName,
      welcomeMessage: config.identity.welcomeMessage,
      primaryColor: config.widget.primaryColor,
      position: config.widget.position,
      headerTitle: config.widget.headerTitle,
      launcherIcon: 'chat',
    });
  });

  it('sends the chosen launcher icon, and the default for a custom one', async () => {
    const withIcon = (launcherIcon: typeof config.widget.launcherIcon) => ({
      ...liveRow,
      publishedVersion: {
        id: 'ver-1',
        config: {
          ...config,
          widget: {
            ...config.widget,
            launcherIcon,
            launcherIconUrl:
              launcherIcon === 'custom' ? 'https://cdn.example/i.png' : null,
          },
        },
      },
    });
    prisma.chatbot.findUnique.mockResolvedValueOnce(withIcon('sparkle'));
    await expect(service.config('cb_abc')).resolves.toMatchObject({
      launcherIcon: 'sparkle',
    });
    prisma.chatbot.findUnique.mockResolvedValueOnce(withIcon('custom'));
    await expect(service.config('cb_abc')).resolves.toMatchObject({
      launcherIcon: 'chat',
    });
  });

  it.each([
    ['unknown', null],
    ['switched off', { ...liveRow, status: 'DISABLED' }],
    ['never published', { ...liveRow, publishedVersion: null }],
    [
      'in a suspended workspace',
      { ...liveRow, workspace: { status: 'SUSPENDED' } },
    ],
  ])('is a 404 for a chatbot that is %s', async (_, row) => {
    prisma.chatbot.findUnique.mockResolvedValue(row);
    await expect(service.config('cb_abc')).rejects.toThrow(NotFoundException);
    await expect(
      service.startConversation('cb_abc', '1.2.3.4', {
        visitorId: 'visitor_1234',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(send()).rejects.toThrow(NotFoundException);
    expect(preview.answer).not.toHaveBeenCalled();
  });

  describe('starting a conversation', () => {
    it("opens it in the chatbot's own workspace and returns its token", async () => {
      let tenant: unknown;
      conversations.start.mockImplementation(() => {
        tenant = currentTenant();
        return Promise.resolve(CONVERSATION);
      });

      await expect(
        service.startConversation('cb_abc', '1.2.3.4', {
          visitorId: 'visitor_1234',
          originUrl: 'https://shop.example.com/shoes',
        }),
      ).resolves.toEqual({
        conversationId: CONVERSATION,
        conversationToken: 'signed-token',
      });
      expect(tenant).toMatchObject({ workspaceId: 'ws-1' });
      expect(conversations.start).toHaveBeenCalledWith({
        chatbotId: 'bot-1',
        visitorId: 'visitor_1234',
        originUrl: 'https://shop.example.com/shoes',
        versionId: 'ver-1',
      });
      expect(tokens.sign).toHaveBeenCalledWith({
        conversationId: CONVERSATION,
        chatbotId: 'bot-1',
      });
    });

    it('limits new conversations per IP', async () => {
      rateLimit.consume.mockRejectedValue(new Error('429'));
      await expect(
        service.startConversation('cb_abc', '1.2.3.4', {
          visitorId: 'visitor_1234',
        }),
      ).rejects.toThrow('429');
      expect(rateLimit.consume).toHaveBeenCalledWith({
        key: 'public:new:1.2.3.4',
        ...PUBLIC_CHAT_LIMITS.newConversationHour,
      });
      expect(conversations.start).not.toHaveBeenCalled();
    });
  });

  describe('sending a message', () => {
    it.each([
      ['no token', null],
      ['a token that does not verify', 'forged'],
    ])('is a 401 with %s', async (_, token) => {
      tokens.verify.mockReturnValue(null);
      await expect(send(token)).rejects.toThrow(UnauthorizedException);
      expect(preview.answer).not.toHaveBeenCalled();
    });

    it("is a 401 with another conversation's token", async () => {
      tokens.verify.mockReturnValue({
        conversationId: '9c3a2f10-0000-4000-8000-000000000000',
        chatbotId: 'bot-1',
      });
      await expect(send()).rejects.toThrow(UnauthorizedException);
    });

    it("answers inside the conversation's workspace with the published config, without sources", async () => {
      let tenant: unknown;
      preview.answer.mockImplementation(() => {
        tenant = currentTenant();
        return Promise.resolve();
      });

      await send();

      expect(tenant).toMatchObject({ workspaceId: 'ws-1' });
      expect(preview.answer).toHaveBeenCalledWith(
        'bot-1',
        config,
        { message: 'Hi', history: [], conversationId: CONVERSATION },
        emit,
        expect.objectContaining({
          isPreview: false,
          visitorId: 'visitor_1234',
          versionId: 'ver-1',
          includeSources: false,
          noCredentialsReply: VISITOR_UNAVAILABLE_REPLY,
          keysExhaustedReply: VISITOR_BUSY_REPLY,
        }),
      );
    });

    it('is a 404 when the conversation is not this chatbot’s', async () => {
      conversations.find.mockResolvedValue(null);
      await expect(send()).rejects.toThrow(NotFoundException);
    });

    it('limits by conversation, IP and chatbot before calling the model', async () => {
      rateLimit.consume.mockRejectedValue(new Error('429'));
      await expect(send()).rejects.toThrow('429');
      expect(rateLimit.consume).toHaveBeenCalledWith(
        {
          key: `public:conv:${CONVERSATION}`,
          ...PUBLIC_CHAT_LIMITS.perConversationMinute,
        },
        { key: 'public:ip:1.2.3.4', ...PUBLIC_CHAT_LIMITS.perIpMinute },
        { key: 'public:ip-hour:1.2.3.4', ...PUBLIC_CHAT_LIMITS.perIpHour },
        { key: 'public:bot:bot-1', ...PUBLIC_CHAT_LIMITS.perBotMinute },
      );
      expect(preview.answer).not.toHaveBeenCalled();
    });

    it('points to the company, without the model, after 50 messages', async () => {
      conversations.find.mockResolvedValue({
        id: CONVERSATION,
        visitorId: 'visitor_1234',
        messageCount: PUBLIC_CHAT_SIZES.conversationMessages,
      });

      await send();

      expect(preview.answer).not.toHaveBeenCalled();
      expect(events).toEqual([
        { type: 'delta', text: VISITOR_LIMIT_REPLY },
        { type: 'done', conversationId: CONVERSATION, answeredBy: 'fallback' },
      ]);
    });
  });

  describe('history', () => {
    it("returns the conversation's messages for a valid token", async () => {
      conversations.messages.mockResolvedValue([
        {
          id: 'm1',
          role: 'user',
          text: 'Hi',
          createdAt: new Date('2026-10-16T08:00:00Z'),
        },
      ]);

      await expect(
        service.history(CONVERSATION, 'signed-token'),
      ).resolves.toEqual([
        {
          id: 'm1',
          role: 'user',
          text: 'Hi',
          createdAt: '2026-10-16T08:00:00.000Z',
        },
      ]);
    });

    it('is a 401 without a valid token', async () => {
      tokens.verify.mockReturnValue(null);
      await expect(service.history(CONVERSATION, null)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(conversations.messages).not.toHaveBeenCalled();
    });
  });
});
