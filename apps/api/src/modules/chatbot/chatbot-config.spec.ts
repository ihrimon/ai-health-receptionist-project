import {
  type ChatbotConfig,
  type HandoffType,
  type QuestionToAsk,
  chatbotConfigSchema,
  configPublishProblems,
  defaultChatbotConfig,
} from '@brainstack/shared';

// The shared ChatbotConfig schema (D-4 §3), tested here because the API is
// where it's enforced.

/** A config the tests may also break in ways the type forbids. */
type Editable = ChatbotConfig & { extra?: number };

const valid = (): Editable => defaultChatbotConfig('Acme');

/** Applies `change` to a fresh default config and returns the issue paths. */
function issuePaths(change: (c: Editable) => void): string[] {
  const config = valid();
  change(config);
  const result = chatbotConfigSchema.safeParse(config);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('chatbotConfigSchema', () => {
  it('accepts the default config', () => {
    expect(chatbotConfigSchema.safeParse(valid()).success).toBe(true);
  });

  it('trims text and stores blank optional fields as null', () => {
    const config = valid();
    config.identity.botName = '  Ava  ';
    config.business.contact.phone = '   ';
    config.business.currency = 'bdt';

    const parsed = chatbotConfigSchema.parse(config);

    expect(parsed.identity.botName).toBe('Ava');
    expect(parsed.business.contact.phone).toBeNull();
    expect(parsed.business.currency).toBe('BDT');
  });

  it('enforces the length limits', () => {
    expect(issuePaths((c) => (c.identity.botName = ''))).toEqual([
      'identity.botName',
    ]);
    expect(issuePaths((c) => (c.identity.botName = 'x'.repeat(41)))).toEqual([
      'identity.botName',
    ]);
    expect(
      issuePaths((c) => (c.behavior.instructions = 'x'.repeat(2001))),
    ).toEqual(['behavior.instructions']);
    expect(
      issuePaths((c) => (c.widget.quickReplies = ['a', 'b', 'c', 'd', 'e'])),
    ).toEqual(['widget.quickReplies']);
    expect(
      issuePaths(
        (c) => (c.behavior.avoidedTopics = Array<string>(21).fill('x')),
      ),
    ).toEqual(['behavior.avoidedTopics']);
  });

  it('rejects control characters, and line breaks in one-line fields', () => {
    expect(issuePaths((c) => (c.identity.botName = 'A\u0007va'))).toEqual([
      'identity.botName',
    ]);
    expect(issuePaths((c) => (c.identity.botName = 'A\nva'))).toEqual([
      'identity.botName',
    ]);
    expect(
      issuePaths((c) => (c.behavior.instructions = 'Line one\nLine two')),
    ).toEqual([]);
  });

  it('rejects unknown keys and a wrong schemaVersion', () => {
    expect(issuePaths((c) => (c.extra = 1))).toEqual(['']);
    expect(issuePaths((c) => (c.schemaVersion = 2 as 1))).toEqual([
      'schemaVersion',
    ]);
  });

  it('checks formats: currency, color, email, phone', () => {
    expect(issuePaths((c) => (c.business.currency = 'XYZ'))).toEqual([
      'business.currency',
    ]);
    expect(issuePaths((c) => (c.widget.primaryColor = 'teal'))).toEqual([
      'widget.primaryColor',
    ]);
    expect(issuePaths((c) => (c.business.contact.email = 'nope'))).toEqual([
      'business.contact.email',
    ]);
    expect(issuePaths((c) => (c.business.contact.phone = '12ab'))).toEqual([
      'business.contact.phone',
    ]);
    expect(
      issuePaths((c) => (c.business.contact.phone = '+880 1711-000000')),
    ).toEqual([]);
  });

  describe('social contacts (review item 8)', () => {
    it('accepts a chatbot saved before they existed', () => {
      const old = valid();
      delete old.business.contact.facebook;
      delete old.business.contact.linkedin;
      delete old.business.contact.instagram;
      expect(chatbotConfigSchema.safeParse(old).success).toBe(true);
    });

    it('takes a link for each, and turns a blank one into null', () => {
      const config = valid();
      config.business.contact.facebook = 'https://facebook.com/acme';
      config.business.contact.linkedin = '   ';
      const parsed = chatbotConfigSchema.parse(config);
      expect(parsed.business.contact.facebook).toBe(
        'https://facebook.com/acme',
      );
      expect(parsed.business.contact.linkedin).toBeNull();
    });

    it('rejects a value that is not a link', () => {
      expect(
        issuePaths((c) => (c.business.contact.instagram = '@acme')),
      ).toEqual(['business.contact.instagram']);
    });
  });

  describe('handoff', () => {
    const handoff = (type: HandoffType, value: string | null) =>
      issuePaths((c) => (c.behavior.handoff = { type, value, label: null }));

    it('needs a value that matches its type', () => {
      expect(handoff('email', 'team@acme.com')).toEqual([]);
      expect(handoff('email', 'acme.com')).toEqual(['behavior.handoff.value']);
      expect(handoff('url', 'https://acme.com/contact')).toEqual([]);
      expect(handoff('url', 'http://acme.com')).toEqual([
        'behavior.handoff.value',
      ]);
      expect(handoff('whatsapp', '+8801711000000')).toEqual([]);
      expect(handoff('phone', null)).toEqual(['behavior.handoff.value']);
    });

    it('has no value when the type is none', () => {
      expect(handoff('none', null)).toEqual([]);
      expect(handoff('none', 'team@acme.com')).toEqual([
        'behavior.handoff.value',
      ]);
    });
  });

  it('needs an icon URL for a custom launcher icon', () => {
    expect(issuePaths((c) => (c.widget.launcherIcon = 'custom'))).toEqual([
      'widget.launcherIconUrl',
    ]);
  });

  it('only accepts https image URLs', () => {
    expect(
      issuePaths((c) => (c.identity.avatarUrl = 'http://cdn.acme.com/a.png')),
    ).toEqual(['identity.avatarUrl']);
  });

  it('needs unique question IDs', () => {
    const question: QuestionToAsk = {
      id: 'q1',
      question: "What's your email?",
      field: 'email',
      required: true,
      askWhen: 'conversation_start',
    };
    expect(issuePaths((c) => (c.behavior.questionsToAsk = [question]))).toEqual(
      [],
    );
    expect(
      issuePaths((c) => (c.behavior.questionsToAsk = [question, question])),
    ).toEqual(['behavior.questionsToAsk']);
  });
});

describe('defaultChatbotConfig', () => {
  it('cuts a long company name to the 80 characters business.name allows', () => {
    const config = defaultChatbotConfig('A'.repeat(100));

    expect(config.business.name).toHaveLength(80);
    expect(chatbotConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('configPublishProblems', () => {
  it('needs a business description', () => {
    const config = valid();
    expect(configPublishProblems(config).map((p) => p.code)).toEqual([
      'BUSINESS_DESCRIPTION_MISSING',
    ]);

    config.business.description = 'We sell shoes.';
    expect(configPublishProblems(config)).toEqual([]);
  });
});
