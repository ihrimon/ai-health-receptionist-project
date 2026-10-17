import type { LeadSummary } from '@brainstack/shared';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { requireTenant, runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { EmailService, type OutgoingEmail } from '../email/email.service';
import { leadEmailHtml, leadEmailSubject } from './lead-email';
import { LeadNotifyProcessor } from './lead-notify.processor';
import { LeadNotifyQueue } from './lead-notify.queue';
import { LeadNotifyService } from './lead-notify.service';
import { LeadsService } from './leads.service';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';

const LEAD = '33333333-3333-4333-8333-333333333333';
const CONVO = '22222222-2222-4222-8222-222222222222';

const summary = (extra: Partial<LeadSummary> = {}): LeadSummary => ({
  id: LEAD,
  chatbotId: 'bot-1',
  conversationId: CONVO,
  name: 'Ana',
  email: 'ana@example.com',
  phone: '+8801711000000',
  answers: [{ questionId: 'budget', question: 'Your budget?', answer: '5000' }],
  sourceUrl: 'https://shop.example/pricing',
  createdAt: '2026-10-17T10:00:00.000Z',
  ...extra,
});

describe('lead email (M5-6)', () => {
  const input = (lead: LeadSummary) => ({
    lead,
    botName: 'Shop <Bot>',
    dashboardUrl: 'https://app.example/',
  });

  it('shows the bot, the details, the answers with their question text and the links', () => {
    const html = leadEmailHtml(input(summary()));
    expect(html).toContain('Shop &lt;Bot&gt;');
    expect(html).toContain('Ana');
    expect(html).toContain('ana@example.com');
    expect(html).toContain('+8801711000000');
    expect(html).toContain('Your budget?');
    expect(html).toContain('5000');
    expect(html).toContain('https://shop.example/pricing');
    expect(html).toContain(
      `href="https://app.example/app/conversations/${CONVO}"`,
    );
    expect(html).toContain('href="https://app.example/app/leads"');
  });

  it('escapes everything the visitor typed and never links the source page', () => {
    const html = leadEmailHtml(
      input(
        summary({
          name: '<script>alert(1)</script>',
          phone: null,
          answers: [
            {
              questionId: 'q1',
              question: 'Say "hi" & <b>more</b>',
              answer: `<img src=x onerror=alert('x')>`,
            },
            { questionId: 'gone', question: null, answer: 'old answer' },
          ],
          sourceUrl: 'javascript:alert(1)"><a href="https://evil.example',
        }),
      ),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>more');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="https://evil.example');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Say &quot;hi&quot; &amp; &lt;b&gt;more&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(&#39;x&#39;)&gt;');
    // A question since removed from the config still shows its answer.
    expect(html).toContain('Question gone');
    expect(html).not.toContain('Phone');
  });

  it('has no conversation link once the chat is deleted', () => {
    const html = leadEmailHtml(input(summary({ conversationId: null })));
    expect(html).not.toContain('/app/conversations/');
    expect(html).toContain('/app/leads');
  });

  it('keeps the subject on one line', () => {
    expect(
      leadEmailSubject(input(summary({ name: 'Ana\r\nBcc: x@evil.example' }))),
    ).toBe('New lead from Shop <Bot>: Ana Bcc: x@evil.example');
    expect(
      leadEmailSubject(
        input(summary({ name: null, email: null, phone: '+8801711000000' })),
      ),
    ).toBe('New lead from Shop <Bot>: +8801711000000');
    expect(
      leadEmailSubject(input(summary({ name: 'x'.repeat(300) }))).length,
    ).toBe(150);
  });
});

describe('LeadNotifyService (M5-6)', () => {
  const db = {
    lead: { findFirst: jest.fn(), updateMany: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
  };
  const leads = { summary: jest.fn() };
  /** Fake transport: records the emails, sends nothing. */
  const sent: OutgoingEmail[] = [];
  const email = {
    send: jest.fn((message: OutgoingEmail) => {
      sent.push(message);
      return Promise.resolve(true);
    }),
  };
  let service: LeadNotifyService;

  const leadRow = (extra: object = {}) => ({
    notifiedAt: null,
    conversation: { isPreview: false },
    chatbot: {
      draftConfig: { identity: { botName: 'Draft name' } },
      publishedVersion: { config: { identity: { botName: 'Shop Bot' } } },
    },
    ...extra,
  });

  /** The lead row in the database: `notified_at` claims are real here. */
  let notifiedAt: Date | null;

  const notify = () =>
    runWithTenant(
      { workspaceId: 'ws-1', userId: 'system:lead-notify', role: 'OWNER' },
      () => service.notify(LEAD),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    sent.length = 0;
    notifiedAt = null;
    db.lead.findFirst.mockImplementation(() =>
      Promise.resolve(leadRow({ notifiedAt })),
    );
    db.lead.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { notifiedAt?: null };
        data: { notifiedAt: Date | null };
      }) => {
        if ('notifiedAt' in where && notifiedAt !== null) {
          return Promise.resolve({ count: 0 });
        }
        notifiedAt = data.notifiedAt;
        return Promise.resolve({ count: 1 });
      },
    );
    db.workspaceMember.findMany.mockResolvedValue([
      { user: { email: 'owner1@example.com' } },
      { user: { email: 'owner2@example.com' } },
    ]);
    leads.summary.mockResolvedValue(summary());
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadNotifyService,
        { provide: TENANT_PRISMA, useValue: db },
        { provide: LeadsService, useValue: leads },
        { provide: EmailService, useValue: email },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://app.example' },
        },
      ],
    }).compile();
    service = moduleRef.get(LeadNotifyService);
  });

  it('emails the confirmed owners once, with the live bot name', async () => {
    await expect(notify()).resolves.toBe('sent');
    expect(db.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'OWNER', user: { emailVerifiedAt: { not: null } } },
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['owner1@example.com', 'owner2@example.com']);
    expect(sent[0].subject).toBe('New lead from Shop Bot: Ana');
    expect(sent[0].html).toContain('Your budget?');
    expect(notifiedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a second run (retry or duplicate job) sends nothing', async () => {
    await notify();
    await expect(notify()).resolves.toBe('already-notified');
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('two jobs at once still send one email (the claim decides)', async () => {
    // Both read the lead before either claimed it.
    db.lead.findFirst.mockResolvedValue(leadRow());
    const results = await Promise.all([notify(), notify()]);
    expect(results.sort()).toEqual(['already-notified', 'sent']);
    expect(email.send).toHaveBeenCalledTimes(1);
  });

  it('gives the claim back and throws when the send fails, so the queue retries', async () => {
    email.send.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(notify()).rejects.toThrow('SMTP down');
    expect(notifiedAt).toBeNull();

    await expect(notify()).resolves.toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('marks nothing when email is disabled', async () => {
    email.send.mockResolvedValueOnce(false);
    await expect(notify()).resolves.toBe('email-disabled');
    expect(notifiedAt).toBeNull();
  });

  it('never emails for a Test chat lead or a lead it cannot see', async () => {
    db.lead.findFirst.mockResolvedValueOnce(
      leadRow({ conversation: { isPreview: true } }),
    );
    await expect(notify()).resolves.toBe('skipped');
    db.lead.findFirst.mockResolvedValueOnce(null);
    await expect(notify()).resolves.toBe('skipped');
    expect(email.send).not.toHaveBeenCalled();
    expect(db.lead.updateMany).not.toHaveBeenCalled();
  });

  it('sends nothing when no owner has a confirmed email', async () => {
    db.workspaceMember.findMany.mockResolvedValue([]);
    await expect(notify()).resolves.toBe('no-recipients');
    expect(email.send).not.toHaveBeenCalled();
    expect(notifiedAt).toBeNull();
  });

  it('falls back to the draft name, then a generic one', async () => {
    db.lead.findFirst.mockResolvedValueOnce(
      leadRow({
        chatbot: {
          draftConfig: { identity: { botName: 'Draft name' } },
          publishedVersion: null,
        },
      }),
    );
    await notify();
    expect(sent[0].subject).toBe('New lead from Draft name: Ana');
  });
});

describe('LeadNotifyQueue and LeadNotifyProcessor (M5-6)', () => {
  const boss = { send: jest.fn(), work: jest.fn() };
  const config = { get: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it('queues one job per lead with retries and the configured delay', async () => {
    config.get.mockReturnValue(60);
    const queue = new LeadNotifyQueue(boss as never, config as never);
    await queue.enqueue('ws-1', LEAD);
    expect(boss.send).toHaveBeenCalledWith(
      QUEUE_NAMES.LEAD_NOTIFY,
      { workspaceId: 'ws-1', leadId: LEAD },
      expect.objectContaining({
        startAfter: 60,
        retryLimit: 4,
        retryBackoff: true,
      }),
    );
  });

  it("never throws when the queue is down (the chat mustn't break)", async () => {
    boss.send.mockRejectedValue(new Error('connection refused'));
    const queue = new LeadNotifyQueue(boss as never, config as never);
    await expect(queue.enqueue('ws-1', LEAD)).resolves.toBeUndefined();
  });

  it("runs the job in the lead's workspace and rethrows failures for a retry", async () => {
    let seenWorkspace = '';
    const notifier = {
      notify: jest.fn(() => {
        seenWorkspace = requireTenant().workspaceId;
        return Promise.resolve('sent');
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadNotifyProcessor,
        { provide: LeadNotifyService, useValue: notifier },
        { provide: PG_BOSS, useValue: boss },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const processor = moduleRef.get(LeadNotifyProcessor);
    const job = { data: { workspaceId: 'ws-9', leadId: LEAD }, retryCount: 0 };

    await expect(processor.process(job)).resolves.toBe('sent');
    expect(seenWorkspace).toBe('ws-9');
    expect(notifier.notify).toHaveBeenCalledWith(LEAD);

    notifier.notify.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(processor.process(job)).rejects.toThrow('SMTP down');
  });
});
