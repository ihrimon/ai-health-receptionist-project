import { wantsToBeContacted } from './contact-intent';

describe('wantsToBeContacted', () => {
  it.each([
    'I want to book a service',
    'Can I get a quote?',
    'please call me tomorrow',
    "I'd like to speak with someone",
    'I am interested in your Growth package',
    'How do I sign up?',
    'Can I schedule a consultation',
    'I want to order this',
    'Is there a demo?',
  ])('says yes to %s', (message) => {
    expect(wantsToBeContacted(message)).toBe(true);
  });

  it.each([
    'What are your opening hours?',
    'Do you ship abroad?',
    'hello',
    'Thanks!',
    'Tell me about pricing',
  ])('says no to %s', (message) => {
    expect(wantsToBeContacted(message)).toBe(false);
  });
});
