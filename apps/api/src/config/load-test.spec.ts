import configuration from './configuration';
import { loadTestConfigFromEnv } from './load-test';

describe('loadTestConfigFromEnv (M7-5)', () => {
  it('is off by default', () => {
    expect(loadTestConfigFromEnv({}).enabled).toBe(false);
    expect(loadTestConfigFromEnv({ NODE_ENV: 'production' }).enabled).toBe(
      false,
    );
  });

  it('turns on in development and test', () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(
        loadTestConfigFromEnv({ LOAD_TEST_MODE: 'true', NODE_ENV }).enabled,
      ).toBe(true);
    }
  });

  it.each(['true', 'TRUE', '1', 'yes', ' on '])(
    'refuses to start in production with LOAD_TEST_MODE=%s',
    (value) => {
      expect(() =>
        loadTestConfigFromEnv({
          LOAD_TEST_MODE: value,
          NODE_ENV: 'production',
        }),
      ).toThrow(/never be enabled/);
    },
  );

  it('treats NODE_ENV=production case-insensitively', () => {
    expect(() =>
      loadTestConfigFromEnv({
        LOAD_TEST_MODE: 'true',
        NODE_ENV: ' Production ',
      }),
    ).toThrow();
  });

  it('reads the fake latency and the rate-limit factor, ignoring bad values', () => {
    const config = loadTestConfigFromEnv({
      LOAD_TEST_MODE: '1',
      LOAD_TEST_FAKE_FIRST_TOKEN_MS: '50',
      LOAD_TEST_FAKE_TOKEN_MS: 'abc',
      LOAD_TEST_FAKE_TOKENS: '10',
      LOAD_TEST_RATE_LIMIT_FACTOR: '0.1',
    });
    expect(config).toMatchObject({
      fakeFirstTokenMs: 50,
      fakeTokenMs: 20,
      fakeTokens: 10,
      rateLimitFactor: 1,
    });
  });
});

describe('the app configuration in load-test mode (M7-5)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    // Production needs its secrets to get as far as the load-test check (M7-27).
    process.env.LLM_KEY_ENCRYPTION_KEY = 'test-key';
    process.env.CONVERSATION_TOKEN_SECRET = 'test-secret';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('cannot be built in production with the load-test flag, so the API never starts', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOAD_TEST_MODE = 'true';
    expect(() => configuration()).toThrow(/never be enabled/);
  });

  it('is fine in production without the flag', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LOAD_TEST_MODE;
    expect(configuration().loadTest.enabled).toBe(false);
  });
});
