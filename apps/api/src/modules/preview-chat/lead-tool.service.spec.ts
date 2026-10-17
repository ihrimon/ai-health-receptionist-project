import { defaultChatbotConfig } from '@brainstack/shared';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LeadsService } from '../leads/leads.service';
import {
  CAPTURE_LEAD_TOOL,
  type LeadToolContext,
  LeadToolService,
  toLeadInput,
} from './lead-tool.service';

const base = defaultChatbotConfig('Rina Shop');
const config = {
  ...base,
  behavior: {
    ...base.behavior,
    questionsToAsk: [
      {
        id: 'q-name',
        question: 'May I have your name?',
        field: 'name' as const,
        required: true,
        askWhen: 'conversation_start' as const,
      },
      {
        id: 'q-phone',
        question: 'Your phone number?',
        field: 'phone' as const,
        required: false,
        askWhen: 'on_purchase_intent' as const,
      },
      {
        id: 'q-size',
        question: 'Which size do you wear?',
        field: 'custom' as const,
        required: false,
        askWhen: 'before_recommendation' as const,
      },
    ],
  },
};

describe('LeadToolService', () => {
  const leads = { create: jest.fn() };
  let service: LeadToolService;
  const live: LeadToolContext = {
    chatbotId: 'bot-1',
    conversationId: 'conv-1',
    isPreview: false,
    config,
  };
  const result = (content: string) => JSON.parse(content) as object;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [LeadToolService, { provide: LeadsService, useValue: leads }],
    }).compile();
    service = moduleRef.get(LeadToolService);
  });

  it('never lets the model choose the workspace, chatbot or conversation', () => {
    const names = Object.keys(
      (CAPTURE_LEAD_TOOL.function!.parameters as { properties: object })
        .properties,
    );
    expect(names).toEqual(['name', 'email', 'phone', 'answers']);
    expect(CAPTURE_LEAD_TOOL.function!.name).toBe('capture_lead');
  });

  it('is offered only to a chatbot with questions to ask', () => {
    expect(LeadToolService.offered(base)).toBe(false);
    expect(LeadToolService.offered(config)).toBe(true);
  });

  it('saves the lead to the chat it came from', async () => {
    const run = await service.run(
      live,
      JSON.stringify({
        name: null,
        email: 'ana@example.com',
        answers: [
          { question_id: 'q-name', answer: 'Ana' },
          { question_id: 'q-size', answer: '41' },
        ],
      }),
    );
    expect(leads.create).toHaveBeenCalledWith({
      chatbotId: 'bot-1',
      conversationId: 'conv-1',
      name: 'Ana',
      email: 'ana@example.com',
      answers: { 'q-size': '41' },
    });
    expect(run.accepted).toBe(true);
    expect(result(run.content)).toMatchObject({ saved: true });
  });

  it('does not save from a preview chat, but tells the model it went fine', async () => {
    const run = await service.run(
      { ...live, isPreview: true, conversationId: null },
      '{"email":"ana@example.com"}',
    );
    expect(leads.create).not.toHaveBeenCalled();
    expect(run.accepted).toBe(true);
    expect(result(run.content)).toMatchObject({ saved: false, preview: true });
  });

  it('validates the arguments with leadInputSchema and saves nothing on bad input', async () => {
    for (const args of [
      'not json',
      '{"answers":"nope"}',
      '{"email":"not-an-email"}',
      '{"phone":"call me maybe"}',
      '{}',
      '{"answers":[{"question_id":"unknown","answer":"x"}]}',
    ]) {
      const run = await service.run(live, args);
      expect(run.accepted).toBe(false);
      expect(result(run.content)).toHaveProperty('error');
    }
    // Even a preview chat rejects invalid details, so the test chat
    // behaves like the real one.
    const preview = await service.run(
      { ...live, isPreview: true },
      '{"email":"nope"}',
    );
    expect(preview.accepted).toBe(false);
    expect(leads.create).not.toHaveBeenCalled();
  });

  it("reports another workspace's chatbot or conversation as not saved", async () => {
    leads.create.mockRejectedValue(
      new NotFoundException('Conversation not found'),
    );
    const run = await service.run(live, '{"name":"Mallory"}');
    expect(run.accepted).toBe(false);
    expect(result(run.content)).toEqual({ error: 'Not saved.' });
  });

  it('saves nothing without a conversation', async () => {
    const run = await service.run(
      { ...live, conversationId: null },
      '{"name":"Ana"}',
    );
    expect(run.accepted).toBe(false);
    expect(leads.create).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors', async () => {
    leads.create.mockRejectedValue(new Error('db down'));
    await expect(service.run(live, '{"name":"Ana"}')).rejects.toThrow(
      'db down',
    );
  });
});

describe('toLeadInput', () => {
  it('keeps the explicit field over an answer to the same field', () => {
    expect(
      toLeadInput(
        {
          phone: '+880 1711',
          answers: [
            { question_id: 'q-phone', answer: '999' },
            { question_id: 'q-size', answer: '  ' },
          ],
        },
        config,
      ),
    ).toEqual({ phone: '+880 1711' });
  });
});
