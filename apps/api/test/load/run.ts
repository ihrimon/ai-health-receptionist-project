import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { SAMPLE_QUESTIONS } from '../../src/modules/knowledge/eval/sample-shop';
import { OUT_DIR, readManifest } from './load-env';

/**
 * Local load test (M7-5): many simulated visitors use the PUBLIC chat
 * endpoints of a locally running API in load-test mode (fake LLM):
 * GET config, start a conversation, send several messages (SSE), rate,
 * read the history.
 *
 *   pnpm --filter api test:load:seed            once
 *   pnpm --filter api build && pnpm --filter api test:load:api   (own terminal)
 *   pnpm --filter api test:load [--sessions 100] [--messages 4] [--think-ms 1000]
 *                               [--ramp-ms 5000] [--label text] [--base-url http://127.0.0.1:3101]
 *
 * It refuses any non-local base URL and aborts when an answer does not carry
 * the fake model's marker (so it can never have reached a real model).
 */

const FAKE_MARKER = 'LOADTEST:';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const num = (name: string, fallback: number) =>
  Number(arg(name, String(fallback)));

const SESSIONS = num('sessions', 100);
const MESSAGES = num('messages', 4);
const THINK_MS = num('think-ms', 1000);
const RAMP_MS = num('ramp-ms', 5000);
const LABEL = arg('label', 'run');
const BASE_URL = new URL(
  arg('base-url', process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3101'),
);

if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(BASE_URL.hostname)) {
  console.error(`Refusing to load-test ${BASE_URL.hostname}: local API only.`);
  process.exit(2);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

type Kind = 'config' | 'start' | 'message' | 'rating' | 'history';
interface Sample {
  kind: Kind;
  status: number;
  ms: number;
  ttftMs?: number;
  error?: string;
}
const samples: Sample[] = [];
const aborted = false as boolean;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Response {
  status: number;
  body: string;
  ttftMs?: number;
}

function request(
  method: 'GET' | 'POST',
  pathname: string,
  opts: { token?: string; body?: unknown; sse?: boolean } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const payload =
      opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        agent,
        hostname: BASE_URL.hostname,
        port: BASE_URL.port,
        path: `/v1${pathname}`,
        method,
        headers: {
          'X-Requested-With': 'fetch',
          ...(payload && {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
          ...(opts.token && { Authorization: `Bearer ${opts.token}` }),
        },
      },
      (res) => {
        let body = '';
        let ttftMs: number | undefined;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          // Time to first token: the first answer text event.
          if (
            opts.sse &&
            ttftMs === undefined &&
            body.includes('event: delta')
          ) {
            ttftMs = performance.now() - started;
          }
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, ttftMs }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function timed(
  kind: Kind,
  fn: () => Promise<Response>,
): Promise<Response | null> {
  const started = performance.now();
  try {
    const res = await fn();
    samples.push({
      kind,
      status: res.status,
      ms: performance.now() - started,
      ttftMs: res.ttftMs,
    });
    return res;
  } catch (err) {
    samples.push({
      kind,
      status: 0,
      ms: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const QUESTIONS = [
  ...SAMPLE_QUESTIONS.map((q) => q.question),
  'hello',
  'thanks!',
  'do you ship to Mars',
];

async function session(
  index: number,
  publicId: string,
  warmup = false,
): Promise<void> {
  await sleep(warmup ? 0 : (RAMP_MS * index) / SESSIONS);
  if (aborted) return;
  const visitorId = `load-${index}-${Math.random().toString(36).slice(2, 10)}`;

  await timed('config', () =>
    request('GET', `/public/chatbots/${publicId}/config`),
  );
  const started = await timed('start', () =>
    request('POST', `/public/chatbots/${publicId}/conversations`, {
      body: { visitorId },
    }),
  );
  if (!started || started.status !== 201) return;
  const { conversationId, conversationToken } = JSON.parse(started.body) as {
    conversationId: string;
    conversationToken: string;
  };

  for (let m = 0; m < MESSAGES && !aborted; m++) {
    await sleep(THINK_MS * (0.5 + Math.random()));
    const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    const res = await timed('message', () =>
      request('POST', `/public/conversations/${conversationId}/messages`, {
        token: conversationToken,
        body: { message: question },
        sse: true,
      }),
    );
    if (res?.status === 200) {
      // Retrieval-miss and small-talk answers come from the model too, but a
      // server fallback ("I don't have that information") may not: only a
      // run with NO fake answer at all is suspicious, checked at the end.
      if (res.body.includes(FAKE_MARKER)) fakeAnswers++;
      if (/event: error/.test(res.body)) streamErrors++;
    }
  }

  await timed('rating', () =>
    request('POST', `/public/conversations/${conversationId}/rating`, {
      token: conversationToken,
      body: { rating: 5 },
    }),
  );
  await timed('history', () =>
    request('GET', `/public/conversations/${conversationId}/messages`, {
      token: conversationToken,
    }),
  );
}

let fakeAnswers = 0;
let streamErrors = 0;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n);
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? NaN),
  };
}

async function main(): Promise<void> {
  const manifest = readManifest();
  const health = await fetch(new URL('/health', BASE_URL)).catch(() => null);
  if (!health?.ok) {
    console.error(
      `API not reachable at ${BASE_URL.origin} (GET /health failed).`,
    );
    process.exit(2);
  }

  console.log(
    `Load test "${LABEL}": ${SESSIONS} sessions x ${MESSAGES} messages, think ${THINK_MS} ms, ramp ${RAMP_MS} ms -> ${BASE_URL.origin}`,
  );
  console.log(
    `Seed: ${manifest.chunksInLoadWorkspace} chunks in the chatbot, ${manifest.chunksTotal} in ${manifest.workspaces} workspace(s)`,
  );
  // Warm-up, not measured: the first question loads the embedding model
  // (about a second of one-off work in the API process).
  await session(0, manifest.publicId, true);
  samples.length = 0;
  fakeAnswers = 0;
  streamErrors = 0;

  const started = performance.now();
  await Promise.all(
    Array.from({ length: SESSIONS }, (_, i) => session(i, manifest.publicId)),
  );
  const wallMs = performance.now() - started;

  const byKind = (kind: Kind) => samples.filter((s) => s.kind === kind);
  const report: Record<string, unknown> = {};
  console.log(
    '\nendpoint   requests  2xx  429  other  err   p50    p95    p99    max   (ms)',
  );
  for (const kind of [
    'config',
    'start',
    'message',
    'rating',
    'history',
  ] as Kind[]) {
    const rows = byKind(kind);
    const ok = rows.filter((s) => s.status >= 200 && s.status < 300);
    const limited = rows.filter((s) => s.status === 429).length;
    const failed = rows.filter((s) => s.status === 0).length;
    const other = rows.length - ok.length - limited - failed;
    const latency = summarize(ok.map((s) => s.ms));
    report[kind] = {
      requests: rows.length,
      ok: ok.length,
      rateLimited: limited,
      other,
      failed,
      latency,
    };
    console.log(
      `${kind.padEnd(10)} ${String(rows.length).padStart(8)} ${String(ok.length).padStart(4)} ${String(limited).padStart(4)} ${String(other).padStart(6)} ${String(failed).padStart(4)} ${String(latency.p50).padStart(5)} ${String(latency.p95).padStart(6)} ${String(latency.p99).padStart(6)} ${String(latency.max).padStart(6)}`,
    );
  }
  const messages = byKind('message').filter((s) => s.status === 200);
  const ttft = summarize(
    messages.flatMap((s) => (s.ttftMs === undefined ? [] : [s.ttftMs])),
  );
  console.log(
    `\nTime to first token (messages): p50 ${ttft.p50}  p95 ${ttft.p95}  p99 ${ttft.p99}  max ${ttft.max} ms`,
  );

  const total = samples.length;
  const non2xx = samples.filter((s) => s.status < 200 || s.status >= 300);
  const rateLimited = samples.filter((s) => s.status === 429).length;
  const errors = non2xx.length - rateLimited;
  const statuses: Record<string, number> = {};
  for (const s of non2xx) statuses[s.status] = (statuses[s.status] ?? 0) + 1;
  console.log(
    `Total requests ${total} in ${(wallMs / 1000).toFixed(1)} s (${(total / (wallMs / 1000)).toFixed(1)} req/s). ` +
      `Errors (not 2xx, not 429): ${errors} (${((errors / total) * 100).toFixed(2)}%). 429: ${rateLimited}. In-stream errors: ${streamErrors}.`,
  );
  if (non2xx.length) console.log('Non-2xx statuses:', JSON.stringify(statuses));
  const firstError = samples.find((s) => s.error);
  if (firstError) console.log('First network error:', firstError.error);

  if (messages.length > 0 && fakeAnswers === 0) {
    console.error(
      `\nNo answer carried the fake model marker "${FAKE_MARKER}": is the API running with LOAD_TEST_MODE (pnpm --filter api test:load:api)? Results are not valid.`,
    );
    process.exitCode = 3;
  }

  const result = {
    label: LABEL,
    at: new Date().toISOString(),
    config: {
      sessions: SESSIONS,
      messages: MESSAGES,
      thinkMs: THINK_MS,
      rampMs: RAMP_MS,
    },
    seed: manifest,
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memGb: Math.round(os.totalmem() / 1e9),
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
    },
    wallSeconds: Math.round(wallMs / 100) / 10,
    requests: total,
    requestsPerSecond: Math.round((total / (wallMs / 1000)) * 10) / 10,
    errors,
    errorRatePercent: Math.round((errors / total) * 10000) / 100,
    rateLimited,
    streamErrors,
    fakeAnswers,
    statuses,
    ttft,
    endpoints: report,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(
    OUT_DIR,
    `result-${LABEL.replace(/[^\w-]+/g, '_')}-${Date.now()}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`Saved ${file}`);
  agent.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
