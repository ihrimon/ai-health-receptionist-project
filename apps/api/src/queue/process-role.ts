import type { ConfigService } from '@nestjs/config';

/**
 * Which part of the app one process runs (M7-7).
 * - `all` (default): HTTP API and background job workers together.
 * - `api`: HTTP API only; jobs are queued but never run here.
 * - `worker`: job workers only (entrypoint `dist/worker.js`, no HTTP port).
 */
export const PROCESS_ROLES = ['all', 'api', 'worker'] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

/** Parses PROCESS_ROLE; unset means `all`, an unknown value is an error. */
export function parseProcessRole(raw: string | undefined): ProcessRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'all';
  if ((PROCESS_ROLES as readonly string[]).includes(value)) {
    return value as ProcessRole;
  }
  throw new Error(
    `Invalid PROCESS_ROLE "${raw}". Use one of: ${PROCESS_ROLES.join(', ')}.`,
  );
}

/** Whether this process should register pg-boss workers. Defaults to yes. */
export function runsWorkers(config: Pick<ConfigService, 'get'>): boolean {
  return config.get<boolean>('queue.runWorkers') !== false;
}
