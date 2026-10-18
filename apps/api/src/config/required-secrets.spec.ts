import { assertProductionSecrets } from './required-secrets';

const secrets = {
  LLM_KEY_ENCRYPTION_KEY: 'a'.repeat(44),
  CONVERSATION_TOKEN_SECRET: 'b'.repeat(44),
};

describe('assertProductionSecrets', () => {
  it('passes in production when both secrets are set', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', ...secrets }),
    ).not.toThrow();
  });

  it.each([['LLM_KEY_ENCRYPTION_KEY'], ['CONVERSATION_TOKEN_SECRET']] as const)(
    'refuses to start in production without %s',
    (name) => {
      expect(() =>
        assertProductionSecrets({
          NODE_ENV: 'production',
          ...secrets,
          [name]: undefined,
        }),
      ).toThrow(new RegExp(`${name}`));
    },
  );

  it('treats an empty or blank value as missing and names both when both are', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        LLM_KEY_ENCRYPTION_KEY: '',
        CONVERSATION_TOKEN_SECRET: '   ',
      }),
    ).toThrow(/LLM_KEY_ENCRYPTION_KEY, CONVERSATION_TOKEN_SECRET/);
  });

  it.each(['development', 'test', undefined])(
    'does not check anything when NODE_ENV is %s',
    (nodeEnv) => {
      expect(() =>
        assertProductionSecrets({ NODE_ENV: nodeEnv }),
      ).not.toThrow();
    },
  );
});
