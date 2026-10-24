import { defaultChatbotConfig } from '@brainstack/shared';
import {
  CONTACT_FOLLOW_UP,
  followUpAsked,
  givesContactDetails,
  lastWasFollowUp,
} from './contact-follow-up';

const config = defaultChatbotConfig('Acme');
config.business.contact.email = 'info@acme.test';
config.business.contact.phone = '+1 (347) 433 0432';

describe('givesContactDetails', () => {
  it("is true when the answer has the company's email or phone", () => {
    expect(givesContactDetails('Write to info@acme.test', config, false)).toBe(
      true,
    );
    expect(givesContactDetails('Call 347-433-0432 today', config, false)).toBe(
      true,
    );
  });

  it('is true for the contact-us link set on the chatbot', () => {
    const withLink = structuredClone(config);
    withLink.behavior.handoff = {
      type: 'url',
      value: 'https://acme.test/contact',
      label: null,
    };
    expect(
      givesContactDetails('Use https://acme.test/contact', withLink, false),
    ).toBe(true);
  });

  it('counts any link only when the visitor asked to be contacted', () => {
    const answer = 'Fill in https://forms.test/abc';
    expect(givesContactDetails(answer, config, true)).toBe(true);
    expect(givesContactDetails(answer, config, false)).toBe(false);
  });

  it('is false for an ordinary answer', () => {
    expect(givesContactDetails('We open at nine.', config, true)).toBe(false);
  });
});

describe('the follow-up in a conversation', () => {
  const asked = [
    { role: 'user' as const, text: 'How do I reach you?' },
    { role: 'assistant' as const, text: 'Email us.' },
    { role: 'assistant' as const, text: CONTACT_FOLLOW_UP },
  ];

  it('knows it was asked, and that it was the last thing said', () => {
    expect(followUpAsked(asked)).toBe(true);
    expect(lastWasFollowUp(asked)).toBe(true);
    expect(lastWasFollowUp([...asked, { role: 'user', text: 'yes' }])).toBe(
      true,
    );
    expect(
      lastWasFollowUp([...asked, { role: 'assistant', text: 'Glad to help.' }]),
    ).toBe(false);
    expect(followUpAsked([])).toBe(false);
  });
});
