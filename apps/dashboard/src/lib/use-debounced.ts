import { useEffect, useState } from "react";

/**
 * `value` once it has stopped changing for `delayMs` (typing settles before
 * searching). The first value is returned at once, so a page's first request
 * starts on mount instead of after the delay, and a value that is equal to the
 * current one (compared as JSON) never produces a new object, so it never
 * triggers a second identical request. `value` should be plain data.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const key = JSON.stringify(value);
  const [settled, setSettled] = useState({ key, value });

  useEffect(() => {
    if (key === settled.key) return;
    const timer = setTimeout(
      () => setSettled({ key, value: JSON.parse(key) as T }),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [key, settled.key, delayMs]);

  return settled.value;
}
