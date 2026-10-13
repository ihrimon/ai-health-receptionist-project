import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body with a zod schema (schemas shared with the
 * dashboard live in @brainstack/shared) and passes on the parsed value.
 * Use as `@Body(new ZodBodyPipe(schema)) body: z.output<typeof schema>`.
 *
 * The global ValidationPipe skips such bodies: their parameter type isn't a
 * class, so there's nothing for class-validator to check.
 *
 * Errors keep Nest's usual shape (`message`, read by the dashboard) and add
 * `code` and per-field `details` (D-2 §1).
 */
export class ZodBodyPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      message: details
        .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
        .join('; '),
      details,
    });
  }
}
