import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireTenant } from '../tenancy/tenant-context';
import { assertWorkspaceKey, newKey, type StorageKind } from './storage-keys';

export const S3_CLIENT = Symbol('S3_CLIENT');

/**
 * Tenant-scoped file storage (M2-9, M0 decision T9). Every key lives under
 * `workspaces/<current workspace>/`, built here from the tenant context, and
 * reads and deletes refuse keys outside it. So a key copied from another
 * workspace is a 404, like any other foreign resource.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {
    this.bucket = config.getOrThrow<string>('storage.bucket');
  }

  /** Stores a new file and returns its key (save it on the owning row). */
  async put(
    kind: StorageKind,
    fileName: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = newKey(requireTenant().workspaceId, kind, fileName);
    await this.ensureBucket();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  /** Reads a file of the current workspace; a missing one is a 404. */
  async get(key: string): Promise<Buffer> {
    assertWorkspaceKey(requireTenant().workspaceId, key);
    try {
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!object.Body) throw new NotFoundException('File not found');
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey)
        throw new NotFoundException('File not found');
      throw err;
    }
  }

  /** Deletes a file of the current workspace; deleting twice is fine. */
  async delete(key: string): Promise<void> {
    assertWorkspaceKey(requireTenant().workspaceId, key);
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Creates the bucket on first use when `storage.createBucket` is on (by
   * default outside production), so a fresh local MinIO needs no setup.
   * Lazy rather than at startup: the API (and its tests) must start
   * without storage running.
   */
  private ensureBucket(): Promise<void> {
    if (!this.config.get<boolean>('storage.createBucket')) {
      return Promise.resolve();
    }
    this.bucketReady ??= this.createBucketIfMissing().catch((err: unknown) => {
      this.bucketReady = undefined; // Try again on the next upload.
      throw err;
    });
    return this.bucketReady;
  }

  private async createBucketIfMissing(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket ${this.bucket}`);
    }
  }
}
