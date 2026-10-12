import {
  generateChatbotPublicId,
  slugify,
  withRandomSuffix,
} from './workspace-ids';

// Same pattern as the workspaces_slug_format CHECK in the migration.
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('workspace ids', () => {
  describe('generateChatbotPublicId', () => {
    it('is "cb_" plus 16 alphanumeric characters', () => {
      expect(generateChatbotPublicId()).toMatch(/^cb_[0-9a-zA-Z]{16}$/);
    });

    it('differs between calls', () => {
      expect(generateChatbotPublicId()).not.toBe(generateChatbotPublicId());
    });
  });

  describe('slugify', () => {
    it.each([
      ['Acme Shop', 'acme-shop'],
      ['  Café   Délice!! ', 'cafe-delice'],
      ['Shop #1 — Dhaka', 'shop-1-dhaka'],
      ['---', 'workspace'],
      ['ঢাকা শপ', 'workspace'],
    ])('%j → %j', (name, expected) => {
      expect(slugify(name)).toBe(expected);
    });

    it('caps long names without leaving a trailing hyphen', () => {
      const slug = slugify(`${'a'.repeat(49)} bcd`);
      expect(slug).toBe('a'.repeat(49));
      expect(slug).toMatch(SLUG_FORMAT);
    });
  });

  describe('withRandomSuffix', () => {
    it('keeps the slug format and fits the 60-character column', () => {
      const slug = withRandomSuffix(slugify('x'.repeat(100)));
      expect(slug).toMatch(SLUG_FORMAT);
      expect(slug.length).toBeLessThanOrEqual(60);
    });
  });
});
