/**
 * The model is told never to write an em dash, but models slip. This swaps
 * it for a comma in what the visitor sees and what is stored (review item 17).
 * Only the model's own words go through it: a custom answer or the fallback
 * message is the company's text and stays word for word.
 */
const EM_DASH = /\s*[—―]\s*/g;

/** The whole text at once. */
export function withoutEmDashes(text: string): string {
  return text.replace(EM_DASH, ', ');
}

/**
 * The same for an answer that arrives in pieces. A dash and the spaces
 * around it can be split over several pieces, so trailing spaces are held
 * back until the next piece shows whether a dash follows.
 */
export class EmDashFilter {
  private heldSpace = '';
  private afterDash = false;

  push(piece: string): string {
    let text = this.heldSpace + piece;
    this.heldSpace = /\s*$/.exec(text)![0];
    text = text.slice(0, text.length - this.heldSpace.length);
    // The space after a dash we replaced is already in ", ".
    if (this.afterDash && text) {
      text = text.replace(/^\s+/, '');
      this.afterDash = false;
    }
    if (this.afterDash && !text) {
      this.heldSpace = '';
      return '';
    }
    const out = withoutEmDashes(text);
    if (/[—―]\s*$/.test(text)) this.afterDash = true;
    // A dash at the very end swallows the spaces held back after it.
    if (/[—―]$/.test(text)) this.heldSpace = '';
    return out;
  }
}
