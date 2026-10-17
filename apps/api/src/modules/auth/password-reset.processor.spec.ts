import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
import { AuthService } from './auth.service';
import { PasswordResetProcessor } from './password-reset.processor';
import { PasswordResetQueue } from './password-reset.queue';

describe('PasswordResetQueue and PasswordResetProcessor (M7-24)', () => {
  const sendPasswordReset = jest.fn();
  const send = jest.fn();
  const work = jest.fn();

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetQueue,
        PasswordResetProcessor,
        { provide: AuthService, useValue: { sendPasswordReset } },
        { provide: PG_BOSS, useValue: { send, work } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    return {
      queue: moduleRef.get(PasswordResetQueue),
      processor: moduleRef.get(PasswordResetProcessor),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sendPasswordReset.mockResolvedValue(undefined);
    send.mockResolvedValue('job-1');
  });

  it('queues only the address, with retries', async () => {
    const { queue } = await build();
    await queue.enqueue('rina@example.com');
    expect(send).toHaveBeenCalledWith(
      QUEUE_NAMES.PASSWORD_RESET,
      { email: 'rina@example.com' },
      expect.objectContaining({ retryLimit: 2 }),
    );
  });

  it('never throws when the queue is down', async () => {
    send.mockRejectedValue(new Error('db down'));
    const { queue } = await build();
    await expect(queue.enqueue('rina@example.com')).resolves.toBeUndefined();
  });

  it('runs the reset for the job and rethrows a failure for retry', async () => {
    const { processor } = await build();
    const job = { data: { email: 'rina@example.com' }, retryCount: 0 };
    await processor.process(job);
    expect(sendPasswordReset).toHaveBeenCalledWith('rina@example.com');

    sendPasswordReset.mockRejectedValue(new Error('SMTP down'));
    await expect(processor.process(job)).rejects.toThrow('SMTP down');
  });

  it('registers a worker on the password-reset queue at startup', async () => {
    const { processor } = await build();
    await processor.onApplicationBootstrap();
    expect(work).toHaveBeenCalledWith(
      QUEUE_NAMES.PASSWORD_RESET,
      expect.any(Object),
      expect.any(Function),
    );
  });
});
