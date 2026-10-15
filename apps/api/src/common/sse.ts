import type { ChatStreamEvent } from '@brainstack/shared';
import { Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Sends one event; false once the client has gone, so the caller can stop. */
export type EmitChatEvent = (event: ChatStreamEvent) => boolean;

const logger = new Logger('ChatStream');

/**
 * Runs `run` and streams what it emits as Server-Sent Events (D-2 §3.2).
 * The headers go out with the first event, so anything thrown before that
 * (a 404, a 429) is still a normal JSON error. Once the stream has
 * started, a failure becomes an `error` event instead.
 */
export async function streamChat(
  res: Response,
  run: (emit: EmitChatEvent) => Promise<void>,
): Promise<void> {
  let closed = false;
  res.on('close', () => {
    if (!res.writableEnded) closed = true;
  });

  const emit: EmitChatEvent = (event) => {
    if (closed) return false;
    if (!res.headersSent) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // Tell reverse proxies (nginx, Render) not to hold the stream back.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }
    const { type, ...data } = event;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  };

  try {
    await run(emit);
  } catch (err) {
    if (!res.headersSent) throw err;
    logger.error(`Chat stream failed: ${String(err)}`);
    emit({ type: 'error', message: 'Something went wrong. Please try again.' });
  }
  if (res.headersSent && !res.writableEnded) res.end();
}
