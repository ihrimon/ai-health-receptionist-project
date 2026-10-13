import {
  createCustomAnswerSchema,
  createFaqSchema,
  createTextSourceSchema,
  faqOrderSchema,
  updateFaqSchema,
  updateTextSourceSchema,
} from '@brainstack/shared';
import { randomUUID } from 'crypto';

// The shared knowledge request schemas, tested where they're enforced.

describe('knowledge schemas', () => {
  it('trims FAQ text and enforces its limits', () => {
    expect(
      createFaqSchema.parse({ question: ' Hours? ', answer: '9 to 5\nDaily' }),
    ).toEqual({ question: 'Hours?', answer: '9 to 5\nDaily' });
    expect(
      createFaqSchema.safeParse({ question: 'x'.repeat(501), answer: 'a' })
        .success,
    ).toBe(false);
    expect(
      createFaqSchema.safeParse({ question: 'q', answer: 'a'.repeat(4001) })
        .success,
    ).toBe(false);
    expect(
      createFaqSchema.safeParse({ question: 'Two\nlines', answer: 'a' })
        .success,
    ).toBe(false);
  });

  it('rejects an empty or unknown-field update', () => {
    expect(updateFaqSchema.safeParse({}).success).toBe(false);
    expect(updateFaqSchema.safeParse({ sortOrder: 3 }).success).toBe(false);
    expect(updateFaqSchema.parse({ answer: 'New' })).toEqual({ answer: 'New' });
  });

  it('needs unique UUIDs, at most the FAQ limit, to reorder', () => {
    const id = randomUUID();
    expect(faqOrderSchema.safeParse({ ids: [id] }).success).toBe(true);
    expect(faqOrderSchema.safeParse({ ids: [id, id] }).success).toBe(false);
    expect(faqOrderSchema.safeParse({ ids: ['faq-1'] }).success).toBe(false);
    expect(
      faqOrderSchema.safeParse({
        ids: Array.from({ length: 26 }, () => randomUUID()),
      }).success,
    ).toBe(false);
  });

  it('makes a new custom answer active by default', () => {
    expect(
      createCustomAnswerSchema.parse({ triggerQuestion: 'Q', answer: 'A' }),
    ).toEqual({ triggerQuestion: 'Q', answer: 'A', isActive: true });
  });

  it('accepts policy and text pages only, up to 50,000 characters', () => {
    const page = { title: 'Returns', content: '# Returns\n\n30 days.' };
    expect(
      createTextSourceSchema.safeParse({ type: 'POLICY', ...page }).success,
    ).toBe(true);
    expect(
      createTextSourceSchema.safeParse({ type: 'DOCUMENT', ...page }).success,
    ).toBe(false);
    expect(
      createTextSourceSchema.safeParse({
        type: 'TEXT',
        title: 'Big',
        content: 'x'.repeat(50_001),
      }).success,
    ).toBe(false);
  });

  it("doesn't let an update change a page's type", () => {
    expect(updateTextSourceSchema.safeParse({ type: 'TEXT' }).success).toBe(
      false,
    );
  });
});
