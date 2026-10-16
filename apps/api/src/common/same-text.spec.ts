import { plain, sameText } from './same-text';

describe('sameText', () => {
  const fallback = "I'm not sure about that. Please contact our team.";

  it('ignores typographic quotes, spacing and a closing full stop', () => {
    expect(
      sameText(
        'I’m not sure about that.\u00a0Please contact our team',
        fallback,
      ),
    ).toBe(true);
    expect(
      sameText(
        "  i'm NOT sure about that. Please   contact our team!",
        fallback,
      ),
    ).toBe(true);
  });

  it('still tells different sentences apart', () => {
    expect(sameText("I'm not sure about that.", fallback)).toBe(false);
    expect(sameText('Yes, we deliver.', fallback)).toBe(false);
  });
});

describe('plain', () => {
  it('turns non-breaking hyphens and spaces into ordinary ones', () => {
    expect(plain('12\u2011month\u202fwarranty')).toBe('12-month warranty');
  });
});
