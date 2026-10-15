import { BadRequestException } from '@nestjs/common';

/** Where the next page starts: after this row in (createdAt, id) order. */
export interface ProductCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Opaque paging cursor (D-2 §1). It holds the last row's own sort values,
 * so the next page is a plain keyset query on the caller's rows; nothing
 * is looked up by ID, so a cursor can't reveal anything about another
 * workspace's products.
 */
export function encodeCursor(cursor: ProductCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
  ).toString('base64url');
}

export function decodeCursor(value: string): ProductCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [createdAt, id] = parsed as unknown[];
      const date = new Date(String(createdAt));
      if (typeof id === 'string' && UUID.test(id) && !isNaN(date.getTime())) {
        return { createdAt: date, id };
      }
    }
  } catch {
    // Falls through to the 400 below.
  }
  throw new BadRequestException('Invalid cursor');
}
