import type { ChatStreamEvent } from '@brainstack/shared';
import { defaultChatbotConfig } from '@brainstack/shared';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import {
  checkCase,
  knownAmounts,
  missedTargets,
  summarize,
} from '../../src/eval/eval-checks';
import type {
  CaseOutcome,
  CaseVerdict,
  EvalCase,
  FixtureCompany,
} from '../../src/eval/eval-types';
import { WorkspaceRole } from '../../src/generated/prisma/client';
import { CustomAnswersService } from '../../src/modules/knowledge-base/custom-answers.service';
import { FaqsService } from '../../src/modules/knowledge-base/faqs.service';
import { KnowledgeSourcesService } from '../../src/modules/knowledge-base/knowledge-sources.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { KnowledgeService } from '../../src/modules/knowledge/knowledge.service';
import { LlmKeysService } from '../../src/modules/llm-keys/llm-keys.service';
import { LlmChatClient } from '../../src/modules/llm/llm-chat.client';
import { PreviewChatService } from '../../src/modules/preview-chat/preview-chat.service';
import { ProductsService } from '../../src/modules/products/products.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { runWithTenant } from '../../src/tenancy/tenant-context';
import { clothing } from './fixtures/clothing';
import { electronics } from './fixtures/electronics';
import { services } from './fixtures/services';

/**
 * The chat answer-quality check (M3-15 to M3-19). Three fixture companies
 * live side by side in one database; every case goes through the real
 * pipeline (custom answers, hybrid retrieval, grounding, product tools).
 *
 *   pnpm --filter api eval
 *
 * Without a key the model is a stand-in: it always asks for a product
 * search, then says "stub". That still judges everything the pipeline
 * decides itself (what is retrieved, what reaches the model, fallbacks,
 * custom answers, isolation); only the wording of real answers is skipped.
 * With a key it is judged too:
 *
 *   EVAL_PROVIDER=openai EVAL_API_KEY=sk-... EVAL_MODEL=gpt-4o-mini \
 *     pnpm --filter api eval
 *
 * Not part of CI: the first run downloads the embedding model (~90 MB) and
 * a real run costs money.
 */
const COMPANIES: FixtureCompany[] = [clothing, electronics, services];

const PROVIDER = process.env.EVAL_PROVIDER;
const API_KEY = process.env.EVAL_API_KEY;
const MODEL = process.env.EVAL_MODEL;
const REAL_MODEL = Boolean(PROVIDER && API_KEY && MODEL);

interface ChatMessage {
  role: string;
  content?: string | null;
}

/** The stand-in model: asks for a product search, then answers "stub". */
async function* stubStream(
  credentials: { id: string; model: string }[],
  messages: ChatMessage[],
  tools?: unknown[],
) {
  await Promise.resolve();
  const credential = credentials[0];
  const done = (message: object) => ({
    type: 'done',
    message,
    credentialId: credential.id,
    model: credential.model,
  });
  const lookedUp = messages.some((m) => m.role === 'tool');
  // The visitor's text arrives wrapped in <visitor_message> tags.
  const asked = (
    [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  ).replace(/<\/?visitor_message>/g, '');
  if (tools?.length && !lookedUp) {
    yield done({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_eval',
          type: 'function',
          function: {
            name: 'search_products',
            arguments: JSON.stringify({ query: asked }),
          },
        },
      ],
    });
    return;
  }
  yield { type: 'text', text: 'Stub answer.' };
  yield done({ role: 'assistant', content: 'Stub answer.' });
}

function textOf(messages: ChatMessage[]): string {
  return messages
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

describe('Chat answer quality', () => {
  let moduleClose: () => Promise<void>;
  let prisma: PrismaService;
  let preview: PreviewChatService;
  let knowledge: KnowledgeService;
  let embedding: EmbeddingService;
  const workspaces = new Map<
    FixtureCompany['key'],
    { workspaceId: string; botId: string; userId: string }
  >();
  /** What the model was sent during the case that is running. */
  let sentToModel: ChatMessage[][] = [];

  const inWorkspace = <T>(
    company: FixtureCompany,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const w = workspaces.get(company.key)!;
    return runWithTenant(
      {
        workspaceId: w.workspaceId,
        userId: w.userId,
        role: WorkspaceRole.OWNER,
      },
      fn,
    );
  };

  async function waitFor(what: string, check: () => Promise<boolean>) {
    for (let i = 0; i < 1200; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function seed(company: FixtureCompany): Promise<void> {
    const owner = await prisma.user.create({
      data: {
        email: `eval-${company.key}-${Date.now()}@example.test`,
        name: `Eval ${company.key}`,
        passwordHash: 'not-used',
      },
    });
    const workspace = await moduleRefGet(WorkspacesService).createWithOwner({
      name: `Eval ${company.name} ${Date.now()}`,
      ownerUserId: owner.id,
    });
    workspaces.set(company.key, {
      workspaceId: workspace.id,
      botId: workspace.chatbots[0].id,
      userId: owner.id,
    });

    await inWorkspace(company, async () => {
      const faqs = moduleRefGet(FaqsService);
      const sources = moduleRefGet(KnowledgeSourcesService);
      const custom = moduleRefGet(CustomAnswersService);
      const products = moduleRefGet(ProductsService);
      for (const faq of company.faqs) await faqs.create(faq);
      for (const policy of company.policies) {
        await sources.createText({
          type: 'POLICY',
          title: policy.title,
          content: policy.content,
        });
      }
      for (const answer of company.customAnswers) {
        await custom.create({ ...answer, isActive: true });
      }
      for (const product of company.products) {
        await products.create({
          name: product.name,
          sku: product.sku,
          price: product.price,
          category: product.category,
          description: product.description,
          stockStatus: product.stockStatus,
          currency: company.currency,
          attributes: {},
          isActive: true,
        });
      }
    });

    const { workspaceId } = workspaces.get(company.key)!;
    await waitFor(`${company.name} to be indexed`, async () => {
      const [chunks, answers, products] = await Promise.all([
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM knowledge_chunks
          WHERE workspace_id = ${workspaceId}::uuid`,
        prisma.customAnswer.count({
          where: { workspaceId, embeddingModel: { not: null } },
        }),
        prisma.product.count({
          where: { workspaceId, embeddingModel: { not: null } },
        }),
      ]);
      return (
        Number(chunks[0].n) >= company.faqs.length + company.policies.length &&
        answers === company.customAnswers.length &&
        products === company.products.length
      );
    });
  }

  let moduleRefGet: <T>(token: new (...args: never[]) => T) => T;

  beforeAll(
    async () => {
      let builder = Test.createTestingModule({ imports: [AppModule] })
        // Chat runs on the workspace's key: here, the eval's own.
        .overrideProvider(LlmKeysService)
        .useValue({
          activeCredentials: () =>
            Promise.resolve([
              {
                id: 'eval-key',
                provider: PROVIDER ?? 'openai',
                apiKey: API_KEY ?? 'stub',
                model: MODEL ?? 'stub-model',
              },
            ]),
          markUsed: () => Promise.resolve(),
        });
      if (!REAL_MODEL) {
        builder = builder
          .overrideProvider(LlmChatClient)
          .useValue({ streamWith: stubStream });
      }
      const moduleRef = await builder.compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      moduleClose = () => app.close();
      moduleRefGet = (token) => app.get(token as never);
      prisma = app.get(PrismaService);
      preview = app.get(PreviewChatService);
      knowledge = app.get(KnowledgeService);
      embedding = app.get(EmbeddingService);

      // Record what is sent to the model, real or stand-in.
      const llm = app.get(LlmChatClient);
      const streamWith = llm.streamWith.bind(llm) as (
        ...args: unknown[]
      ) => AsyncIterable<unknown>;
      (llm as unknown as { streamWith: unknown }).streamWith = (
        credentials: unknown,
        messages: ChatMessage[],
        tools?: unknown,
      ) => {
        sentToModel.push([...messages]);
        return streamWith(credentials, messages, tools);
      };

      for (const company of COMPANIES) await seed(company);
    },
    20 * 60 * 1000,
  );

  afterAll(async () => {
    await moduleClose();
  });

  async function run(
    company: FixtureCompany,
    c: EvalCase,
  ): Promise<CaseOutcome> {
    sentToModel = [];
    const events: ChatStreamEvent[] = [];
    const w = workspaces.get(company.key)!;
    const config = {
      ...defaultChatbotConfig(company.name),
    };
    config.business.description = company.description;
    config.business.currency = company.currency;

    await inWorkspace(company, () =>
      preview.answer(
        w.botId,
        config,
        { message: c.question, history: [] },
        (event) => {
          events.push(event);
          return true;
        },
        {
          isPreview: true,
          visitorId: 'eval',
          versionId: null,
          includeSources: false,
          noCredentialsReply: 'NO_KEY',
          keysExhaustedReply: 'KEYS_EXHAUSTED',
        },
      ),
    );

    const done = events.find((e) => e.type === 'done');
    const calls = sentToModel;
    const lastCall = calls.at(-1) ?? [];
    const toolMessage = lastCall.find((m) => m.role === 'tool');
    let productFirst: string | null = null;
    if (toolMessage && typeof toolMessage.content === 'string') {
      try {
        const parsed = JSON.parse(toolMessage.content) as {
          products?: { name: string }[];
        };
        productFirst = parsed.products?.[0]?.name ?? null;
      } catch {
        productFirst = null;
      }
    }
    return {
      answeredBy: done && done.type === 'done' ? done.answeredBy : null,
      reply: events.map((e) => (e.type === 'delta' ? e.text : '')).join(''),
      modelContext: calls.map(textOf).join('\n'),
      productFirst,
      realModel: REAL_MODEL,
    };
  }

  /**
   * How close the question was to the company's knowledge and to its
   * custom answers, whatever the pipeline decided: the numbers to tune
   * KNOWLEDGE_MIN_SIMILARITY and KNOWLEDGE_CUSTOM_ANSWER_THRESHOLD with.
   */
  async function closeness(company: FixtureCompany, question: string) {
    const w = workspaces.get(company.key)!;
    const vector = await embedding.embed(question);
    const literal = `[${vector.join(',')}]`;
    const [chunks, answers] = await Promise.all([
      inWorkspace(company, () =>
        knowledge.search(w.botId, question, 1, false, vector),
      ),
      prisma.$queryRaw<{ sim: number }[]>`
        SELECT 1 - (embedding <=> ${literal}::vector) AS sim
        FROM custom_answers WHERE chatbot_id = ${w.botId}::uuid
        ORDER BY embedding <=> ${literal}::vector LIMIT 1`,
    ]);
    return {
      chunk: chunks[0] ? Number(chunks[0].similarity) : null,
      keyword: chunks[0]?.keywordHit ?? false,
      custom: answers[0] ? Number(answers[0].sim) : null,
    };
  }

  it(
    'meets the M3 targets',
    async () => {
      const verbose = Boolean(process.env.EVAL_VERBOSE);
      const results: { case: EvalCase; verdict: CaseVerdict }[] = [];
      const lines: string[] = [];
      for (const company of COMPANIES) {
        const amounts = knownAmounts(company);
        for (const c of company.cases) {
          const outcome = await run(company, c);
          const verdict = checkCase(c, outcome, amounts);
          results.push({ case: c, verdict });
          if (verbose || !verdict.pass) {
            const near = await closeness(company, c.question);
            const sim = (n: number | null) =>
              n === null ? '  -  ' : n.toFixed(2);
            const numbers = `chunk ${sim(near.chunk)}${near.keyword ? ' +word' : ''}  custom ${sim(near.custom)}`;
            if (verbose) {
              lines.push(
                `DIAG ${verdict.pass ? 'ok  ' : 'FAIL'} ${c.id} [${c.category}] ${numbers}`,
              );
            }
            if (!verdict.pass) {
              lines.push(
                `FAIL ${c.id} [${c.category}] "${c.question}"\n     ${verdict.failures.join('; ')}\n     ${numbers}\n     answered by ${outcome.answeredBy}: ${outcome.reply.slice(0, 120)}`,
              );
            }
          }
        }
      }

      const summary = summarize(results);
      const header = [
        `\nChat answer quality: ${REAL_MODEL ? `real model ${PROVIDER}/${MODEL}` : 'stand-in model (answer wording not judged)'}`,
        `cases ${summary.total}, judged ${summary.total - summary.skipped}, passed ${summary.passed}, pass rate ${(summary.passRate * 100).toFixed(1)}%`,
        `cross-tenant leaks ${summary.leaks}, invented prices ${summary.inventedPrices}`,
        ...Object.entries(summary.byCategory).map(
          ([name, row]) =>
            `  ${name.padEnd(14)} ${row.passed}/${row.total - row.skipped}${row.skipped ? ` (${row.skipped} skipped)` : ''}`,
        ),
      ];
      console.log([...header, ...lines].join('\n'));

      expect(missedTargets(summary)).toEqual([]);
    },
    60 * 60 * 1000,
  );
});
