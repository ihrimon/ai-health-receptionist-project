import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { runWithTenant } from '../tenancy/tenant-context';
import {
  assertWorkspaceKey,
  newKey,
  safeFileName,
  workspacePrefix,
} from './storage-keys';
import { S3_CLIENT, StorageService } from './storage.service';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: WS, userId: 'user-1', role: 'ADMIN' }, fn);

describe('storage keys', () => {
  it("puts every key inside the workspace's prefix", () => {
    const key = newKey(WS, 'documents', 'Return policy.pdf');
    expect(key).toMatch(
      new RegExp(
        `^workspaces/${WS}/documents/[0-9a-f-]{36}/Return-policy\\.pdf$`,
      ),
    );
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\rina\\price list.csv', 'price-list.csv'],
    ['.hidden', 'file.hidden'],
    ['মূল্য তালিকা.pdf', 'file.pdf'],
    ['', 'file'],
  ])('cleans the file name %p', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it("refuses another workspace's key, or one that climbs out (404)", () => {
    const own = newKey(WS, 'documents', 'a.pdf');
    expect(() => assertWorkspaceKey(WS, own)).not.toThrow();
    expect(() => assertWorkspaceKey(OTHER, own)).toThrow(NotFoundException);
    expect(() =>
      assertWorkspaceKey(
        WS,
        `${workspacePrefix(WS)}../${OTHER}/documents/a.pdf`,
      ),
    ).toThrow(NotFoundException);
    expect(() =>
      assertWorkspaceKey(WS, `${workspacePrefix(WS)}documents//a.pdf`),
    ).toThrow(NotFoundException);
  });
});

describe('StorageService', () => {
  let service: StorageService;
  let send: jest.Mock;
  let createBucket: boolean;

  beforeEach(async () => {
    createBucket = true;
    send = jest.fn().mockResolvedValue({});
    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: { send } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'storage.createBucket' ? createBucket : undefined,
            getOrThrow: () => 'test-bucket',
          },
        },
      ],
    }).compile();
    service = module.get(StorageService);
  });

  const commands = () =>
    send.mock.calls.map(([command]) => command as { input: object });

  it("stores a file under the workspace's prefix", async () => {
    const key = await inTenant(() =>
      service.put('documents', 'faq.md', Buffer.from('# FAQ'), 'text/markdown'),
    );

    expect(key.startsWith(workspacePrefix(WS))).toBe(true);
    const put = commands().find((c) => c instanceof PutObjectCommand);
    expect(put?.input).toEqual({
      Bucket: 'test-bucket',
      Key: key,
      Body: Buffer.from('# FAQ'),
      ContentType: 'text/markdown',
    });
  });

  it('creates a missing bucket once when allowed', async () => {
    send.mockImplementation((command: object) =>
      command instanceof HeadBucketCommand
        ? Promise.reject(new Error('NotFound'))
        : Promise.resolve({}),
    );

    await inTenant(() =>
      service.put('documents', 'a.txt', Buffer.from('a'), 'text/plain'),
    );
    await inTenant(() =>
      service.put('documents', 'b.txt', Buffer.from('b'), 'text/plain'),
    );

    expect(
      commands().filter((c) => c instanceof CreateBucketCommand),
    ).toHaveLength(1);
  });

  it('leaves buckets alone when bucket creation is off', async () => {
    createBucket = false;

    await inTenant(() =>
      service.put('documents', 'a.txt', Buffer.from('a'), 'text/plain'),
    );

    expect(commands().some((c) => c instanceof HeadBucketCommand)).toBe(false);
  });

  it('reads a file back as a buffer', async () => {
    const key = newKey(WS, 'documents', 'a.txt');
    send.mockResolvedValue({
      Body: {
        transformToByteArray: () => Promise.resolve(Buffer.from('hello')),
      },
    });

    await expect(inTenant(() => service.get(key))).resolves.toEqual(
      Buffer.from('hello'),
    );
    expect(commands()[0]).toBeInstanceOf(GetObjectCommand);
  });

  it('is a 404 for a missing file', async () => {
    send.mockRejectedValue(new NoSuchKey({ message: 'gone', $metadata: {} }));

    await expect(
      inTenant(() => service.get(newKey(WS, 'documents', 'a.txt'))),
    ).rejects.toThrow(NotFoundException);
  });

  it("won't read or delete another workspace's file", async () => {
    const foreign = newKey(OTHER, 'documents', 'secret.pdf');

    await expect(inTenant(() => service.get(foreign))).rejects.toThrow(
      NotFoundException,
    );
    await expect(inTenant(() => service.delete(foreign))).rejects.toThrow(
      NotFoundException,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('deletes a file of the workspace', async () => {
    const key = newKey(WS, 'documents', 'a.txt');

    await inTenant(() => service.delete(key));

    expect(commands()[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(commands()[0].input).toEqual({ Bucket: 'test-bucket', Key: key });
  });
});
