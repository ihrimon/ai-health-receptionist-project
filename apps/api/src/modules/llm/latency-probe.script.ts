/**
 * Chat speed probe (review item 20): how long each model takes to say its
 * first word and to finish, on a prompt shaped like a real chat turn (the
 * platform rules, company settings and three knowledge passages).
 *
 *   PROBE_KEY_GEMINI=... PROBE_KEY_GROQ=... \
 *     pnpm --filter api llm:latency gemini:gemini-3.1-flash-lite groq:llama-3.1-8b-instant
 *
 * Each target is `provider:model` (providers: gemini, groq, openai,
 * anthropic, openrouter, unorouter); its key comes from PROBE_KEY_<PROVIDER>.
 * `--runs N` sets the number of calls per model (default 6; the first is a
 * warm-up and is left out of the figures). Run it where the API runs (for
 * the real answer, on the host), since the distance to the provider is part
 * of the time. Nothing is stored; it only calls the providers with your keys.
 */
import { defaultChatbotConfig } from '@brainstack/shared';
import { LlmProvider } from '../../generated/prisma/client';
import type { KnowledgeMatch } from '../knowledge/knowledge.service';
import { buildPreviewMessages } from '../preview-chat/preview-prompt';
import { ProviderRegistry } from './providers/provider-registry';

const PASSAGES: [string, string][] = [
  [
    'Pricing',
    'Full packages: Lite is $9,999 setup and $1,999 a month for solo contractors and 1-2 trucks. Growth is $14,999 setup and $2,999 a month for 3-8 trucks or crews. Scale is $19,999 setup and $3,999 a month for 10+ trucks and multiple locations. All prices are in US dollars and a written proposal confirms scope first. Each service can also be bought on its own.',
  ],
  [
    'AI receptionist',
    'An AI receptionist answers calls or messages, collects the customer details and either handles simple questions or passes the conversation to a person. It is most useful for calls you cannot answer, like after hours or when you are on a job. Urgent calls are routed to your on-call contact with the details already collected, and a backup contact is used if nobody answers.',
  ],
  [
    'Billing and cancellation',
    'Agreements are month-to-month. Cancellation requires 45 days written notice. Setup and monthly retainer fees are non-refundable once work for that billing period has started. Monthly retainers cover ongoing AI usage, phone and messaging costs, carrier registration fees and regular automation updates. Overages are billed at cost plus standard carrier rates.',
  ],
];

const QUESTION = 'How much is the Growth package and is there a contract?';

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function main() {
  const args = process.argv.slice(2);
  const runsAt = args.indexOf('--runs');
  const runs = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 6;
  if (args.length === 0 || !(runs >= 2)) {
    console.log(
      'Usage: PROBE_KEY_<PROVIDER>=... pnpm --filter api llm:latency [--runs N] provider:model ...',
    );
    return;
  }

  const config = defaultChatbotConfig('KNKO Global');
  const matches: KnowledgeMatch[] = PASSAGES.map(([title, content]) => ({
    content,
    metadata: { title, headingPath: [] },
    similarity: 0.8,
    keywordHit: true,
  }));
  const messages = buildPreviewMessages(config, matches, [], QUESTION);
  const promptChars = messages.reduce(
    (n, m) => n + (typeof m.content === 'string' ? m.content.length : 0),
    0,
  );
  console.log(
    `Prompt: about ${Math.round(promptChars / 4)} tokens, ${runs} runs each.\n`,
  );

  const registry = new ProviderRegistry();
  console.log(
    'model'.padEnd(44) + 'first word (median / worst)   finished (median)',
  );
  for (const target of args) {
    const [name, ...rest] = target.split(':');
    const model = rest.join(':');
    const provider = LlmProvider[name as keyof typeof LlmProvider];
    const apiKey = process.env[`PROBE_KEY_${name.toUpperCase()}`];
    if (!provider || !model || !apiKey) {
      console.log(
        `${target.padEnd(44)}skipped (needs provider:model and PROBE_KEY_${name.toUpperCase()})`,
      );
      continue;
    }
    const adapter = registry.get(provider);
    const first: number[] = [];
    const total: number[] = [];
    let failure = '';
    for (let run = 0; run < runs; run++) {
      const started = performance.now();
      let firstAt = 0;
      try {
        for await (const event of adapter.stream({ apiKey, model, messages })) {
          if (event.type === 'text' && !firstAt)
            firstAt = performance.now() - started;
        }
      } catch (err) {
        failure = (err as Error).message.slice(0, 80);
        break;
      }
      if (run > 0) {
        first.push(firstAt);
        total.push(performance.now() - started);
      }
    }
    if (failure || first.length === 0) {
      console.log(`${target.padEnd(44)}failed: ${failure || 'no answer'}`);
      continue;
    }
    console.log(
      target.padEnd(44) +
        `${Math.round(median(first))} ms / ${Math.round(Math.max(...first))} ms`.padEnd(
          30,
        ) +
        `${Math.round(median(total))} ms`,
    );
  }
}

void main();
