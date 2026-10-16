import { isSmallTalk } from './small-talk';

describe('isSmallTalk', () => {
  it.each([
    'Hi',
    'hello there!',
    'Good morning',
    'thanks!!',
    'Thank you so much',
    'ok',
    'What can you do?',
    'What can you help me with?',
    'bye',
    'Hello, how are you?',
    'Hi there! How are you doing today?',
    'hey whats up',
    'Good morning, how is it going?',
    'ok thanks, bye',
    'Nice to meet you',
    'Tell me about your company',
    'Can you tell me more about your shop?',
    'Who are you?',
  ])('treats "%s" as small talk', (message) => {
    expect(isSmallTalk(message)).toBe(true);
  });

  it.each([
    'Hi, what is the price of the ZX-9000?',
    'Do you ship abroad?',
    'thanks but can I return it',
    'What is the capital of France?',
    'Hello, how are you? Do you have saree?',
    'Tell me about your delivery',
    'What is your return policy?',
    '',
    '???',
  ])('treats "%s" as a real question', (message) => {
    expect(isSmallTalk(message)).toBe(false);
  });
});
