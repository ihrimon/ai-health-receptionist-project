/**
 * Deep equality for JSON values, ignoring object key order: Postgres jsonb
 * reorders keys, so a draft and its published copy can differ in order only.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = Object.keys(aObj);
  return (
    keys.length === Object.keys(bObj).length &&
    keys.every((k) => Object.hasOwn(bObj, k) && sameJson(aObj[k], bObj[k]))
  );
}
