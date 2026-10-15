import { sameJson } from './same-json';

describe('sameJson', () => {
  it('ignores object key order', () => {
    expect(
      sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }),
    ).toBe(true);
  });

  it('notices changed values, keys and array order', () => {
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 1 })).toBe(false);
    expect(sameJson({ a: null }, { b: null })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});
