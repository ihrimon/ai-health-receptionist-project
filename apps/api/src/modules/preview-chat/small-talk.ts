/**
 * Greetings, thanks and goodbyes need no knowledge, so a question like
 * these still goes to the model when nothing relevant was found (M3-10).
 * A message counts when it is only small-talk phrases, one after another
 * ("hello, how are you?"). Short on purpose: anything else in the message
 * makes it a real question.
 */
const PHRASES = [
  'hi',
  'hello',
  'hey',
  'hiya',
  'hola',
  'yo',
  'salam',
  'assalamualaikum',
  'good (morning|afternoon|evening|day)',
  'thanks',
  'thank you',
  'thx',
  'ok',
  'okay',
  'cool',
  'great',
  'nice',
  'bye',
  'goodbye',
  'see you',
  'how are you( doing)?( today)?',
  'how is it going',
  'hows it going',
  'how do you do',
  'whats up',
  'sup',
  'nice to meet you',
  'who are you',
  'what can you (do|help me with|help with)',
  'help',
];
const SUFFIX = '( (there|again|so much|a lot|you|everyone|team|bot))?';
const PHRASE = `(${PHRASES.join('|')})${SUFFIX}`;
const SMALL_TALK = new RegExp(`^${PHRASE}( ${PHRASE})*$`);

/**
 * Questions about the business itself ("tell me about your company") are
 * answered from the company settings, which the prompt always carries, so
 * they need no knowledge match either.
 */
const ABOUT_BUSINESS =
  /^((can you )?tell me( more)? about|what is|whats|who is|who are|info about|information about)( (you|yourself|your (company|business|shop|store|brand|team)|this (company|business|shop|store|brand)))$/;

function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSmallTalk(message: string): boolean {
  const normalized = normalize(message);
  return (
    normalized.length > 0 &&
    (SMALL_TALK.test(normalized) || ABOUT_BUSINESS.test(normalized))
  );
}
