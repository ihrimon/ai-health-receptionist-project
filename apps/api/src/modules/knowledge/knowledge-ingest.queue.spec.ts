import { QUEUE_NAMES } from '../../queue/queue.constants';
import { runWithTenant } from '../../tenancy/tenant-context';
import {
  INGEST_ATTEMPTS,
  KnowledgeIngestQueue,
} from './knowledge-ingest.queue';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

describe('KnowledgeIngestQueue', () => {
  const retries = {
    retryLimit: INGEST_ATTEMPTS - 1,
    retryDelay: 5,
    retryBackoff: true,
  };
  let boss: { send: jest.Mock; insert: jest.Mock };
  let queue: KnowledgeIngestQueue;

  beforeEach(() => {
    boss = {
      send: jest.fn().mockResolvedValue('job-1'),
      insert: jest.fn().mockResolvedValue(['job-1']),
    };
    queue = new KnowledgeIngestQueue(boss as never);
  });

  it('sends a job carrying the current workspace, with retries', async () => {
    await inTenant(() => queue.enqueue('faq', 'faq-1'));

    expect(boss.send).toHaveBeenCalledWith(
      QUEUE_NAMES.KNOWLEDGE_INGEST,
      { workspaceId: 'ws-1', kind: 'faq', id: 'faq-1' },
      retries,
    );
  });

  it('takes an explicit workspace outside a request (re-embed script)', async () => {
    await queue.enqueue('product', 'p-1', 'ws-9');

    expect(boss.send).toHaveBeenCalledWith(
      QUEUE_NAMES.KNOWLEDGE_INGEST,
      { workspaceId: 'ws-9', kind: 'product', id: 'p-1' },
      retries,
    );
  });

  it('inserts many jobs in one call, and none for an empty list', async () => {
    await inTenant(() => queue.enqueueMany('product', ['p-1', 'p-2']));
    await inTenant(() => queue.enqueueMany('product', []));

    expect(boss.insert).toHaveBeenCalledTimes(1);
    expect(boss.insert).toHaveBeenCalledWith(QUEUE_NAMES.KNOWLEDGE_INGEST, [
      { data: { workspaceId: 'ws-1', kind: 'product', id: 'p-1' }, ...retries },
      { data: { workspaceId: 'ws-1', kind: 'product', id: 'p-2' }, ...retries },
    ]);
  });
});
