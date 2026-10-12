import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/** Emails are trimmed and lowercased before validation and storage. */
export function EmailField() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail(),
    MaxLength(255),
  );
}
