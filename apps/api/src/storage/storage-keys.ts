import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

/** What a stored file is for; the second part of its key. */
export type StorageKind = 'documents' | 'assets';

const MAX_NAME_LENGTH = 100;

/** The part of the key space one workspace owns. */
export function workspacePrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/`;
}

/**
 * A file name safe to put in a key: no folders, no "..", only letters,
 * digits, ".", "_" and "-". The original name is kept in the database
 * (e.g. KnowledgeSource.fileName) for display.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-');
  // Keep the extension even when nothing of the name survives (a name in
  // Bangla becomes "file.pdf"), and never start with "." or "-".
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? '';
  const stem = cleaned
    .slice(0, cleaned.length - ext.length)
    .replace(/^[.-]+|[.-]+$/g, '');
  return `${stem || 'file'}${ext}`.slice(-MAX_NAME_LENGTH);
}

/**
 * A new, unique key inside the workspace's part of the bucket:
 * `workspaces/<workspaceId>/<kind>/<uuid>/<file name>`.
 */
export function newKey(
  workspaceId: string,
  kind: StorageKind,
  fileName: string,
): string {
  return `${workspacePrefix(workspaceId)}${kind}/${randomUUID()}/${safeFileName(fileName)}`;
}

/**
 * Refuses a key outside the workspace's part of the bucket. It's a 404,
 * as for any other workspace's resource (W4): the file "doesn't exist"
 * for this workspace.
 */
export function assertWorkspaceKey(workspaceId: string, key: string): void {
  const segments = key.split('/');
  if (
    !key.startsWith(workspacePrefix(workspaceId)) ||
    segments.some((s) => s === '' || s === '.' || s === '..')
  ) {
    throw new NotFoundException('File not found');
  }
}
