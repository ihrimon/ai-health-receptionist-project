import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

async function check(overrides: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, {
    name: 'Rina',
    email: 'rina@example.com',
    password: 'correct horse battery',
    companyName: 'Acme',
    ...overrides,
  });
  const errors = await validate(dto);
  return { dto, failed: errors.map((e) => e.property) };
}

describe('RegisterDto', () => {
  it('accepts a valid signup', async () => {
    expect((await check({})).failed).toEqual([]);
  });

  it('trims and lowercases the email', async () => {
    const { dto, failed } = await check({ email: '  Rina@Example.COM ' });
    expect(failed).toEqual([]);
    expect(dto.email).toBe('rina@example.com');
  });

  it('trims the name and company name', async () => {
    const { dto } = await check({ name: '  Rina ', companyName: ' Acme  ' });
    expect(dto.name).toBe('Rina');
    expect(dto.companyName).toBe('Acme');
  });

  it.each([
    ['shorter than 10 characters', 'short pw'],
    ['longer than 128 characters', 'x'.repeat(129)],
    ['on the common-password list', 'Password123'],
    ['not a string', 1234567890],
  ])('rejects a password %s', async (_label, password) => {
    expect((await check({ password })).failed).toEqual(['password']);
  });

  it('rejects a blank company name and an invalid email', async () => {
    const { failed } = await check({ companyName: '   ', email: 'nope' });
    expect(failed.sort()).toEqual(['companyName', 'email']);
  });
});
