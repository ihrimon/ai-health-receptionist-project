import { defaultChatbotConfig } from '@brainstack/shared';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { currentTenant } from '../../tenancy/tenant-context';
import { PreviewChatService } from '../preview-chat/preview-chat.service';
import {
  PUBLIC_CHAT_LIMITS,
  PublicChatService,
  VISITOR_BUSY_REPLY,
  VISITOR_UNAVAILABLE_REPLY,
} from './public-chat.service';

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
  let service: PublicChatService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.chatbot.findUnique.mockResolvedValue(liveRow);
    rateLimit.consume.mockResolvedValue(undefined);
    preview.answer.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: PreviewChatService, useValue: preview },
      ],
    }).compile();
    service = moduleRef.get(PublicChatService);
  });

  const noEmit = () => true;
  const send = () =>
    service.send('cb_abc', '1.2.3.4', { message: 'Hi', history: [] }, noEmit);

  it('shows the published look and greeting', async () => {
    await expect(service.config('cb_abc')).resolves.toMatchObject({
      botName: config.identity.botName,
      welcomeMessage: config.identity.welcomeMessage,
      primaryColor: config.widget.primaryColor,
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
    await expect(send()).rejects.toThrow(NotFoundException);
    expect(preview.answer).not.toHaveBeenCalled();
  });

  it("answers inside the chatbot's own workspace with the published config, without sources", async () => {
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
      { message: 'Hi', history: [] },
      noEmit,
      expect.objectContaining({
        isPreview: false,
        visitorId: expect.any(String) as string,
        versionId: 'ver-1',
        includeSources: false,
      }),
    );
  });

  it("keeps the widget's visitor ID so a conversation can continue", async () => {
    await service.send(
      'cb_abc',
      '1.2.3.4',
      {
        message: 'Hi',
        history: [],
        visitorId: 'visitor_1234',
        conversationId: '5b0d3c1e-7a5c-4b88-9f0a-0a6f2f7d9a11',
      },
      noEmit,
    );

    expect(preview.answer).toHaveBeenCalledWith(
      'bot-1',
      config,
      expect.objectContaining({
        conversationId: '5b0d3c1e-7a5c-4b88-9f0a-0a6f2f7d9a11',
      }),
      noEmit,
      expect.objectContaining({ visitorId: 'visitor_1234', isPreview: false }),
    );
  });

  it('limits by IP and by chatbot before calling the LLM', async () => {
    rateLimit.consume.mockRejectedValue(new Error('429'));
    await expect(send()).rejects.toThrow('429');
    expect(rateLimit.consume).toHaveBeenCalledWith(
      { key: 'public:ip:1.2.3.4', ...PUBLIC_CHAT_LIMITS.perIpMinute },
      { key: 'public:ip-hour:1.2.3.4', ...PUBLIC_CHAT_LIMITS.perIpHour },
      { key: 'public:bot:bot-1', ...PUBLIC_CHAT_LIMITS.perBotMinute },
    );
    expect(preview.answer).not.toHaveBeenCalled();
  });

  it('gives the preview a visitor wording for a missing or exhausted key', async () => {
    await send();
    const [[, , , , context]] = preview.answer.mock.calls as [
      [unknown, unknown, unknown, unknown, Record<string, string>],
    ];
    expect(context.noCredentialsReply).toBe(VISITOR_UNAVAILABLE_REPLY);
    expect(context.keysExhaustedReply).toBe(VISITOR_BUSY_REPLY);
  });
});
