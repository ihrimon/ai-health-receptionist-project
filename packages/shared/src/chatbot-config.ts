import { z } from 'zod';
import { optional, text } from './text';

/**
 * ChatbotConfig: everything a company can configure about its chatbot
 * (docs/design/d4-chatbot-config.md). The API validates drafts with this
 * schema, and the dashboard can reuse it for its forms.
 */

export const CHATBOT_CONFIG_SCHEMA_VERSION = 1;

const PHONE_CHARS = /^\+?[0-9 ()-]+$/;

/** Loose international phone check: digits, spaces, (), -, an optional +. */
export function isPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '').length;
  return PHONE_CHARS.test(value) && digits >= 6 && digits <= 15;
}

const phone = z.string().max(200).refine(isPhoneNumber, {
  message: 'Must be a phone number',
});

const email = z.email().max(200);

const httpsUrl = z.url({ protocol: /^https$/ }).max(500);

const isoCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => Intl.supportedValuesOf('currency').includes(code), {
    message: 'Must be a 3-letter ISO 4217 currency code',
  });

const topicList = z.array(text(1, 80)).max(20);

export const TONES = ['friendly', 'professional', 'casual'] as const;
export const HANDOFF_TYPES = [
  'none',
  'email',
  'phone',
  'whatsapp',
  'url',
] as const;

const questionToAskSchema = z.strictObject({
  /** Stable ID (lead.answers uses it as the key), e.g. a nanoid. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  question: text(1, 200),
  field: z.enum(['name', 'email', 'phone', 'custom']),
  required: z.boolean(),
  askWhen: z.enum([
    'conversation_start',
    'before_recommendation',
    'on_purchase_intent',
  ]),
});

const handoffSchema = z
  .strictObject({
    type: z.enum(HANDOFF_TYPES),
    value: optional(z.string().max(500)),
    label: optional(text(1, 40)),
  })
  .superRefine((handoff, ctx) => {
    const { type, value } = handoff;
    if (type === 'none') {
      if (value !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Must be empty when there is no handoff',
        });
      }
      return;
    }
    const valid =
      value !== null &&
      (type === 'email'
        ? email.safeParse(value).success
        : type === 'url'
          ? httpsUrl.safeParse(value).success
          : isPhoneNumber(value));
    if (!valid) {
      const expected =
        type === 'email'
          ? 'an email address'
          : type === 'url'
            ? 'an https URL'
            : 'a phone number';
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Must be ${expected}`,
      });
    }
  });

const widgetSchema = z
  .strictObject({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, {
      message: 'Must be a #RRGGBB color',
    }),
    position: z.enum(['right', 'left']),
    launcherIcon: z.enum(['chat', 'sparkle', 'help', 'custom']),
    /** Required when launcherIcon is 'custom'; comes from the upload API. */
    launcherIconUrl: optional(httpsUrl),
    headerTitle: text(1, 40),
    quickReplies: z.array(text(1, 60)).max(4),
    showBranding: z.boolean(),
  })
  .superRefine((widget, ctx) => {
    if (widget.launcherIcon === 'custom' && widget.launcherIconUrl === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['launcherIconUrl'],
        message: 'Upload an icon to use a custom launcher icon',
      });
    }
  });

export const chatbotConfigSchema = z.strictObject({
  schemaVersion: z.literal(CHATBOT_CONFIG_SCHEMA_VERSION),
  identity: z.strictObject({
    botName: text(1, 40),
    /** Our storage's https URL, from the upload API; never an outside URL. */
    avatarUrl: optional(httpsUrl),
    welcomeMessage: text(1, 300, true),
  }),
  business: z.strictObject({
    name: text(1, 80),
    description: text(0, 1000, true),
    websiteUrl: optional(z.url({ protocol: /^https?$/ }).max(200)),
    currency: isoCurrency,
    contact: z.strictObject({
      email: optional(email),
      phone: optional(phone),
      whatsapp: optional(phone),
      address: optional(text(1, 200, true)),
      hours: optional(text(1, 200)),
    }),
  }),
  behavior: z.strictObject({
    tone: z.enum(TONES),
    customToneNote: optional(text(1, 200)),
    instructions: text(0, 2000, true),
    /** Empty = anything about the business. */
    allowedTopics: topicList,
    avoidedTopics: topicList,
    questionsToAsk: z
      .array(questionToAskSchema)
      .max(5)
      .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, {
        message: 'Question IDs must be unique',
      }),
    fallbackMessage: text(1, 500, true),
    handoff: handoffSchema,
  }),
  widget: widgetSchema,
});

export type ChatbotConfig = z.output<typeof chatbotConfigSchema>;
export type Tone = ChatbotConfig['behavior']['tone'];
export type HandoffType = ChatbotConfig['behavior']['handoff']['type'];
export type QuestionToAsk = ChatbotConfig['behavior']['questionsToAsk'][number];

const BUSINESS_NAME_MAX = 80;

/** The draft a new workspace's chatbot starts with (D-4 §4). */
export function defaultChatbotConfig(companyName: string): ChatbotConfig {
  // Workspace names may be longer than business.name allows. Array.from
  // so an emoji at the cut isn't split in half.
  const name = Array.from(companyName.trim())
    .slice(0, BUSINESS_NAME_MAX)
    .join('')
    .trim();
  return {
    schemaVersion: CHATBOT_CONFIG_SCHEMA_VERSION,
    identity: {
      botName: 'Assistant',
      avatarUrl: null,
      welcomeMessage: 'Hi! 👋 How can I help you today?',
    },
    business: {
      name,
      description: '',
      websiteUrl: null,
      currency: 'USD',
      contact: {
        email: null,
        phone: null,
        whatsapp: null,
        address: null,
        hours: null,
      },
    },
    behavior: {
      tone: 'friendly',
      customToneNote: null,
      instructions: '',
      allowedTopics: [],
      avoidedTopics: [],
      questionsToAsk: [],
      fallbackMessage:
        "I'm not sure about that. Please contact our team and we'll help you out.",
      handoff: { type: 'none', value: null, label: null },
    },
    widget: {
      primaryColor: '#0F766E',
      position: 'right',
      launcherIcon: 'chat',
      launcherIconUrl: null,
      headerTitle: 'Assistant',
      quickReplies: ['What do you sell?', 'Delivery options', 'Return policy'],
      showBranding: true,
    },
  };
}

export interface PublishProblem {
  code: string;
  message: string;
}

/**
 * Reasons a config can't be published yet (D-4 §4), checked by the API and
 * shown next to the dashboard's Publish button. Knowledge-based rules need
 * the database, so the API adds those itself.
 */
export function configPublishProblems(config: ChatbotConfig): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (config.business.description === '') {
    problems.push({
      code: 'BUSINESS_DESCRIPTION_MISSING',
      message: 'Add a short description of your business.',
    });
  }
  return problems;
}
