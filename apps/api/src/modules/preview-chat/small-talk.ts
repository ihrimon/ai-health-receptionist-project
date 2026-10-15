/**
 * Greetings, thanks and goodbyes need no knowledge, so a question like
 * these still goes to the model when nothing relevant was found (M3-10).
 * Short on purpose: anything longer or more specific is a real question.
 */
const SMALL_TALK =
  /^(hi|hello|hey|hiya|hola|yo|good (morning|afternoon|evening|day)|thanks|thank you|thx|ok|okay|cool|great|nice|bye|goodbye|see you|how are you|who are you|what can you do|help)( (there|again|so much|a lot|you|everyone|team|bot))?$/;

export function isSmallTalk(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 && SMALL_TALK.test(normalized);
}
