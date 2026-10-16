import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_TOKEN_TTL_SECONDS,
  ConversationTokenService,
} from './conversation-token.service';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const claims = { conversationId: 'conv-1', chatbotId: 'bot-1' };

describe('ConversationTokenService', () => {
  const make = (secret = 'a-test-secret') =>
    new ConversationTokenService(
      config({ 'security.conversationTokenSecret': secret }),
    );

  it('round-trips the conversation and chatbot', () => {
    const service = make();
    expect(service.verify(service.sign(claims))).toEqual(claims);
  });

  it('rejects a token signed with another secret', () => {
    const token = make('secret-one').sign(claims);
    expect(make('secret-two').verify(token)).toBeNull();
  });

  it('rejects a token whose payload was changed', () => {
    const service = make();
    const [, signature] = service.sign(claims).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        c: 'conv-2',
        b: 'bot-1',
        e: Math.floor(Date.now() / 1000) + 1000,
      }),
    ).toString('base64url');
    expect(service.verify(`${forged}.${signature}`)).toBeNull();
  });

  it('expires after its lifetime', () => {
    const service = make();
    const start = 1_800_000_000_000;
    service.now = () => start;
    const token = service.sign(claims);

    service.now = () => start + (CONVERSATION_TOKEN_TTL_SECONDS - 1) * 1000;
    expect(service.verify(token)).toEqual(claims);
    service.now = () => start + (CONVERSATION_TOKEN_TTL_SECONDS + 1) * 1000;
    expect(service.verify(token)).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'not-base64.not-a-signature'])(
    'rejects the malformed token "%s"',
    (token) => {
      expect(make().verify(token)).toBeNull();
    },
  );

  it('uses a development secret outside production, and refuses in production without one', () => {
    const dev = new ConversationTokenService(
      config({ nodeEnv: 'development' }),
    );
    expect(dev.verify(dev.sign(claims))).toEqual(claims);

    const prod = new ConversationTokenService(
      config({ nodeEnv: 'production' }),
    );
    expect(() => prod.sign(claims)).toThrow(ServiceUnavailableException);
  });
});
