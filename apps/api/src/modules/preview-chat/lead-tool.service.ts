import {
  type ChatbotConfig,
  type LeadInput,
  leadInputSchema,
} from '@brainstack/shared';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { LeadsService } from '../leads/leads.service';
import type { ChatCompletionTool } from '../llm/providers/provider-adapter.types';

/**
 * The tool the model calls once the visitor has answered the chatbot's
 * "questions to ask" or left contact details (M5-4, FR-2.9, FR-4.7). The
 * workspace, chatbot and conversation are never arguments: the server
 * adds them, so a lead can only land in the chat it came from.
 */
export const CAPTURE_LEAD_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'capture_lead',
    description:
      'Save the contact details and answers the visitor has given, so the business can follow up. Call it as soon as the visitor answers one of the questions to ask or leaves their name, email or phone. Only pass what the visitor actually wrote; never guess or make up details.',
    parameters: {
      type: 'object',
      properties: {
        // null and missing mean the same: not given (see search_products).
        name: {
          type: ['string', 'null'],
          description: "The visitor's name, or null.",
        },
        email: {
          type: ['string', 'null'],
          description: "The visitor's email address, or null.",
        },
        phone: {
          type: ['string', 'null'],
          description: "The visitor's phone number, or null.",
        },
        answers: {
          type: ['array', 'null'],
          description:
            "Answers to the business's questions to ask, each with the question's id, or null.",
          items: {
            type: 'object',
            properties: {
              question_id: {
                type: 'string',
                description:
                  'The id of the question, as given in the settings.',
              },
              answer: {
                type: 'string',
                description: "The visitor's answer, in their words.",
              },
            },
            required: ['question_id', 'answer'],
          },
        },
      },
      required: [],
    },
  },
};

/**
 * Shows the visitor the widget's contact form (M7-41). It takes no
 * arguments: the form's fields are fixed, and what the visitor types goes
 * straight to the server, never through the model.
 */
export const SHOW_CONTACT_FORM_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'show_contact_form',
    description:
      'Show the visitor a short contact form (name, email or phone, and what they need) so the business can get back to them. Call it when the visitor wants to buy, book, order, get a quote or an appointment, or asks to be contacted or to speak to a person. Never call it for an ordinary question.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

/** What goes back to the model once the form is on the visitor's screen. */
export const CONTACT_FORM_RESULT = JSON.stringify({
  shown: true,
  note: 'The visitor now sees a short contact form below your message. Tell them in one short sentence to fill it in and that the team will get back to them. Do not ask for their name, email or phone in the chat.',
});

const captureArgs = z.object({
  name: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  answers: z
    .array(z.object({ question_id: z.string(), answer: z.string() }))
    .max(20)
    .nullish(),
});

/** Where the lead goes; all of it comes from the server, never the model. */
export interface LeadToolContext {
  chatbotId: string;
  /** The stored chat; null before a preview chat has its first turn. */
  conversationId: string | null;
  /** Dashboard Test chat: nothing is saved (decision M5-4). */
  isPreview: boolean;
  config: ChatbotConfig;
}

export interface LeadToolRun {
  /** What goes back to the model, as JSON text. */
  content: string;
  /** The details were valid (saved, or accepted by a preview chat). */
  accepted: boolean;
}

const THANKS =
  'Thank the visitor briefly and continue helping. Do not repeat their details back in full.';

/**
 * Runs capture_lead for one chatbot (M5-4). Must run in that workspace's
 * tenant context: LeadsService only finds the current workspace's
 * chatbots and conversations.
 */
@Injectable()
export class LeadToolService {
  private readonly logger = new Logger(LeadToolService.name);

  constructor(private readonly leads: LeadsService) {}

  /** The tool is offered only when the chatbot has questions to ask. */
  static offered(config: ChatbotConfig): boolean {
    return config.behavior.questionsToAsk.length > 0;
  }

  async run(context: LeadToolContext, rawArgs: string): Promise<LeadToolRun> {
    let args: unknown;
    try {
      args = JSON.parse(rawArgs || '{}');
    } catch {
      return failure('The arguments were not valid JSON.');
    }
    const parsed = captureArgs.safeParse(args);
    if (!parsed.success) return failure('Invalid arguments for capture_lead.');

    const input = toLeadInput(parsed.data, context.config);
    const valid = leadInputSchema.safeParse(input);
    if (!valid.success) {
      return failure(
        `Not saved: ${valid.error.issues.map((i) => i.message).join(', ')}. Ask the visitor to check it, once.`,
      );
    }

    if (context.isPreview) {
      return {
        content: JSON.stringify({
          saved: false,
          preview: true,
          note: `This is the business's test chat, so the details were not saved. ${THANKS}`,
        }),
        accepted: true,
      };
    }
    if (!context.conversationId) return failure('Not saved: no conversation.');

    try {
      await this.leads.create({
        ...input,
        chatbotId: context.chatbotId,
        conversationId: context.conversationId,
      });
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        this.logger.warn(`capture_lead not saved: ${err.message}`);
        return failure('Not saved.');
      }
      throw err;
    }
    return {
      content: JSON.stringify({ saved: true, note: THANKS }),
      accepted: true,
    };
  }
}

/**
 * The model's arguments as a lead. Answers count only for questions the
 * chatbot asks; an answer to a name, email or phone question fills that
 * field when the model left it out, and custom questions keep their id.
 */
export function toLeadInput(
  args: z.output<typeof captureArgs>,
  config: ChatbotConfig,
): LeadInput {
  const questions = new Map(
    config.behavior.questionsToAsk.map((q) => [q.id, q]),
  );
  const input: LeadInput = {
    ...(args.name ? { name: args.name } : {}),
    ...(args.email ? { email: args.email } : {}),
    ...(args.phone ? { phone: args.phone } : {}),
  };
  const answers: Record<string, string> = {};
  for (const { question_id, answer } of args.answers ?? []) {
    const question = questions.get(question_id);
    if (!question || !answer.trim()) continue;
    if (question.field === 'custom') answers[question.id] = answer;
    else input[question.field] ??= answer;
  }
  if (Object.keys(answers).length > 0) input.answers = answers;
  return input;
}

function failure(message: string): LeadToolRun {
  return { content: JSON.stringify({ error: message }), accepted: false };
}
