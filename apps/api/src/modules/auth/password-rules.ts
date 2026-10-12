import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  MaxLength,
  MinLength,
  ValidateBy,
  ValidationOptions,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 10;
// argon2 hashes any length, but an unbounded input is a cheap way to burn
// server CPU.
export const PASSWORD_MAX_LENGTH = 128;

// Passwords of at least 10 characters that top breach lists. Small on
// purpose (D-2 §2.1); compared case-insensitively.
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '0987654321',
  '1111111111',
  '123456789a',
  '12345678910',
  '123123123123',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'qwertyuiop',
  'qwerty12345',
  'qwerty123456',
  'asdfghjkl1',
  'zxcvbnm123',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'iloveyou12',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'changeme123',
  'football123',
  'baseball123',
  'superman123',
  'princess123',
  'sunshine123',
  'monkey12345',
  'dragon12345',
  'abc1234567',
  'abcdefghij',
  'aaaaaaaaaa',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/** Rules for a new password: length plus the common-password list. */
export function IsAcceptablePassword(options?: ValidationOptions) {
  return applyDecorators(
    IsString(options),
    MinLength(PASSWORD_MIN_LENGTH, options),
    MaxLength(PASSWORD_MAX_LENGTH, options),
    ValidateBy(
      {
        name: 'isNotCommonPassword',
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' && !isCommonPassword(value),
          defaultMessage: () =>
            'This password is too common. Please choose another one.',
        },
      },
      options,
    ),
  );
}
