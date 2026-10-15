import { Test } from '@nestjs/testing';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import {
  type AnswerDetails,
  ConversationsService,
  type RecordTurn,
} from './conversations.service';

describe('ConversationsService', () => {
  const db = {
    conversation: { create: jest.fn(), updateMany: jest.fn() },
    message: { createMany: jest.fn() },
  };
  let service: ConversationsService;

  const answer: AnswerDetails = {
    content: '30 days.',
    sources: [{ title: 'Returns', page: 2, similarity: 0.81 }],
    answeredBy: 'llm',
    model: 'gpt',
    tokensIn: 120,
    tokensOut: 8,
    latencyMs: 640,
  };
  const turn: RecordTurn = {
    chatbotId: 'bot-1',
    visitorId: 'visitor-1',
    isPreview: false,
    versionId: 'ver-1',
    userText: 'Can I return it?',
    answer,
  };
  const record = (t: RecordTurn) =>
    runWithTenant(
      { workspaceId: 'ws-1', userId: 'u-1', role: WorkspaceRole.VIEWER },
      () => service.recordTurn(t),
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    db.conversation.create.mockResolvedValue({ id: 'conv-new' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: TENANT_PRISMA, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(ConversationsService);
  });

  it('starts a conversation with the visitor message and the answer', async () => {
    await expect(record(turn)).resolves.toBe('conv-new');

    const [[args]] = db.conversation.create.mock.calls as [
      [
        {
          data: {
            workspaceId: string;
            messageCount: number;
            isPreview: boolean;
            versionId: string;
            messages: {
              create: { workspaceId: string; role: string; content: string }[];
            };
          };
        },
      ],
    ];
    expect(args.data).toMatchObject({
      workspaceId: 'ws-1',
      messageCount: 2,
      isPreview: false,
      versionId: 'ver-1',
    });
    expect(args.data.messages.create).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-1',
        role: 'USER',
        content: 'Can I return it?',
      }),
      expect.objectContaining({
        workspaceId: 'ws-1',
        role: 'ASSISTANT',
        content: '30 days.',
        answeredBy: 'llm',
        model: 'gpt',
        tokensIn: 120,
        tokensOut: 8,
        latencyMs: 640,
      }),
    ]);
  });

  it("continues the same visitor's conversation", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 1 });

    await expect(record({ ...turn, conversationId: 'conv-1' })).resolves.toBe(
      'conv-1',
    );

    expect(db.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'conv-1',
          chatbotId: 'bot-1',
          visitorId: 'visitor-1',
          isPreview: false,
        },
      }),
    );
    expect(db.message.createMany).toHaveBeenCalledTimes(1);
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("starts a new conversation when the ID is another visitor's or unknown", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      record({ ...turn, conversationId: 'conv-other' }),
    ).resolves.toBe('conv-new');

    expect(db.message.createMany).not.toHaveBeenCalled();
    expect(db.conversation.create).toHaveBeenCalledTimes(1);
  });
});
