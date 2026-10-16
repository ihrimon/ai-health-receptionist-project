/**
 * Where the widget finds its chatbot and the API.
 *
 * - The chatbot comes from the page's own path, `/w/<publicId>`: the
 *   loader opens the iframe on that URL, and the server-served page
 *   (M4-19) keeps the same path, so nothing has to be injected into the
 *   HTML. Anything else under the path (a trailing slash, `?host=…` for
 *   M4-14) is ignored.
 * - The API is fixed per build (`VITE_API_URL`), like the dashboard's
 *   `NEXT_PUBLIC_API_URL`: the files are static and the same for every
 *   company. Unset, a production build calls the origin it was served
 *   from (the API serves this page, M4-19), and `vite dev` the local API.
 */
export function publicIdFrom(pathname: string): string | null {
  const match = /\/w\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function apiBaseFrom(apiUrl: string | undefined, fallback: string): string {
  return `${(apiUrl || fallback).replace(/\/+$/, "")}/v1`;
}

export const API_BASE = apiBaseFrom(
  import.meta.env.VITE_API_URL,
  import.meta.env.DEV ? "http://localhost:3001" : location.origin,
);
