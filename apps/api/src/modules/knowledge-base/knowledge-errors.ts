import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/** 409 when a chatbot already has as many items as the MVP allows. */
export function limitReached(what: string, max: number): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'LIMIT_REACHED',
    message: `A chatbot can have at most ${max} ${what}`,
    limit: max,
  });
}

/**
 * Runs an update/delete by ID and turns "no such row" into a 404. The
 * tenant client adds the workspace to the lookup, so another workspace's
 * row is "no such row" too (W4: 404, not 403).
 */
export async function orNotFound<T>(
  what: string,
  query: () => Promise<T>,
): Promise<T> {
  try {
    return await query();
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      throw new NotFoundException(`${what} not found`);
    }
    throw err;
  }
}
