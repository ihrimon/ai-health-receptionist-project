"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders `children` only once the placeholder is about to scroll into view,
 * so a section below the first screen starts its API calls when the visitor
 * gets near it, not on page load. It stays rendered after that. The
 * placeholder keeps a fixed height so the page doesn't jump.
 *
 * Without IntersectionObserver (old browsers, tests) it renders at once.
 */
export function LazyInView({
  children,
  placeholder,
  rootMargin = "200px",
}: {
  children: ReactNode;
  /** Shown until the section is near the screen (a skeleton of the same height). */
  placeholder: ReactNode;
  /** How early to start loading, before the section is actually visible. */
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, rootMargin]);

  return seen ? <>{children}</> : <div ref={ref}>{placeholder}</div>;
}
