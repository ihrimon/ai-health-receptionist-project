import { PrismaPg } from '@prisma/adapter-pg';
import { currentSystemReason, currentTenant } from '../tenancy/tenant-context';

/**
 * Row-Level Security support (M7-1, decision T4).
 *
 * Postgres policies on every tenant table compare `workspace_id` with the
 * transaction setting `app.workspace_id` (or allow everything when
 * `app.rls_bypass` is 'on'). This wrapper around Prisma's pg adapter sets
 * those two settings with `set_config(…, true)`: transaction-local, so they
 * vanish at COMMIT/ROLLBACK and can never leak to the next user of a pooled
 * connection.
 *
 * - Inside a tenant request/job (AsyncLocalStorage context): every query
 *   runs in a transaction that starts with the setting. A query that Prisma
 *   already runs in a transaction (interactive `$transaction`, nested
 *   writes, batches) gets the setting once, at the start.
 * - Inside `runAsSystem`: same, with the bypass on.
 * - Outside both: nothing is set, so tenant tables return no rows and refuse
 *   writes (fail closed). Queries on platform tables (users, sessions…) are
 *   untouched and cost nothing extra.
 */
type Adapter = Awaited<ReturnType<PrismaPg['connect']>>;
type Query = Parameters<Adapter['queryRaw']>[0];
type Tx = Awaited<ReturnType<Adapter['startTransaction']>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STRING_ARG = { scalarType: 'string', arity: 'scalar' } as const;

/** The settings query for the current context, or null when there is none. */
export function rlsSettingsQuery(): Query | null {
  const system = currentSystemReason() !== undefined;
  const workspaceId = currentTenant()?.workspaceId ?? '';
  if (!system && !workspaceId) return null;
  if (workspaceId && !UUID.test(workspaceId)) {
    // Refuse instead of letting Postgres fail on the uuid cast later.
    throw new Error('Invalid workspace id in the tenant context');
  }
  return {
    sql: "SELECT set_config('app.workspace_id', $1, true), set_config('app.rls_bypass', $2, true)",
    args: [workspaceId, system ? 'on' : 'off'],
    argTypes: [STRING_ARG, STRING_ARG],
  };
}

const NO_ARGS = { args: [], argTypes: [] };

/**
 * The pg adapter's `commit()`/`rollback()` only give the connection back to
 * the pool; Prisma's own transaction manager sends COMMIT/ROLLBACK first
 * (the adapter reports `usePhantomQuery: false`). A transaction we open
 * ourselves has to do the same.
 */
async function end(tx: Tx, how: 'COMMIT' | 'ROLLBACK'): Promise<void> {
  try {
    await tx.executeRaw({ sql: how, ...NO_ARGS });
  } finally {
    if (how === 'COMMIT') await tx.commit();
    else await tx.rollback();
  }
}

async function applySettings(tx: Tx): Promise<void> {
  const settings = rlsSettingsQuery();
  if (settings) await tx.queryRaw(settings);
}

class RlsAdapter {
  readonly provider: Adapter['provider'];
  readonly adapterName: Adapter['adapterName'];

  constructor(private readonly inner: Adapter) {
    this.provider = inner.provider;
    this.adapterName = inner.adapterName;
  }

  /** Runs one statement; in a tenant/system context inside its own transaction. */
  private async scoped<T>(
    run: (target: Pick<Adapter, 'queryRaw' | 'executeRaw'>) => Promise<T>,
  ): Promise<T> {
    if (rlsSettingsQuery() === null) return run(this.inner);
    const tx = await this.inner.startTransaction();
    let result: T;
    try {
      await applySettings(tx);
      result = await run(tx);
    } catch (err) {
      await end(tx, 'ROLLBACK').catch(() => undefined);
      throw err;
    }
    await end(tx, 'COMMIT');
    return result;
  }

  queryRaw(query: Query): ReturnType<Adapter['queryRaw']> {
    return this.scoped((t) => t.queryRaw(query));
  }

  executeRaw(query: Query): ReturnType<Adapter['executeRaw']> {
    return this.scoped((t) => t.executeRaw(query));
  }

  async startTransaction(
    ...args: Parameters<Adapter['startTransaction']>
  ): Promise<Tx> {
    const tx = await this.inner.startTransaction(...args);
    try {
      await applySettings(tx);
    } catch (err) {
      await end(tx, 'ROLLBACK').catch(() => undefined);
      throw err;
    }
    return tx;
  }

  executeScript(script: string): ReturnType<Adapter['executeScript']> {
    return this.inner.executeScript(script);
  }

  getConnectionInfo(): ReturnType<NonNullable<Adapter['getConnectionInfo']>> {
    return this.inner.getConnectionInfo();
  }

  dispose(): ReturnType<Adapter['dispose']> {
    return this.inner.dispose();
  }
}

/** Wraps a PrismaPg factory so its adapters set the RLS settings. */
export class RlsPrismaPg {
  readonly provider: PrismaPg['provider'];
  readonly adapterName: string;

  constructor(private readonly inner: PrismaPg) {
    this.provider = inner.provider;
    this.adapterName = inner.adapterName;
  }

  async connect(): Promise<RlsAdapter> {
    return new RlsAdapter(await this.inner.connect());
  }
}
