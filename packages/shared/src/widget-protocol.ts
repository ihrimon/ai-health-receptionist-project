import type { LauncherIcon } from './public-chat';

/**
 * The postMessage protocol between the loader (`chatbot.js` on a company's
 * page) and the chat window in its iframe (M4-10). The widget and the
 * loader import only the types (this package's runtime would pull zod into
 * their bundles), so each side has its own few lines of runtime checks.
 *
 * Every message is `{ ns: "brainstack", v: 1, type, ...fields }`. A
 * receiver ignores anything with another `ns`, a `v` it doesn't know, an
 * unknown `type` or bad fields, so old and new loaders and widgets can
 * meet on one page without breaking each other.
 *
 * Origins: the loader posts only to the widget's origin and accepts only
 * messages from its own iframe on that origin. The widget's first message,
 * `ready`, carries no data and goes to `*` (it can't know the host yet);
 * the loader answers with `init`, which the widget accepts only from its
 * parent window, and from then on it posts only to that origin.
 */
export const WIDGET_PROTOCOL_NS = 'brainstack';
export const WIDGET_PROTOCOL_VERSION = 1;

/** Chat window → loader. */
export type WidgetToHostMessage =
  /** The window is listening; the loader answers with `init`. */
  | { type: 'ready' }
  /** The launcher's look, from the published config. Nothing private. */
  | {
      type: 'config';
      primaryColor: string;
      textColor: '#000000' | '#ffffff';
      position: 'left' | 'right';
      /** Added after v1 shipped, so optional: a loader shows 'chat' when it's missing or unknown. */
      launcherIcon?: LauncherIcon;
    }
  /** Open the chat (e.g. a link inside it asks for it). */
  | { type: 'open' }
  /** The visitor closed the chat (the close button or Escape). */
  | { type: 'close' }
  /** A wish for the panel size in px on a desktop; the loader clamps it, a phone stays full screen. */
  | { type: 'resize'; width: number; height: number }
  /** Answers that arrived while the chat was closed (0 clears the badge). */
  | { type: 'unread'; count: number };

/** Loader → chat window. */
export type HostToWidgetMessage =
  /** The answer to `ready`: the host page's origin is the sender's. */
  | { type: 'init'; open: boolean }
  /** The chat was opened or closed. */
  | { type: 'state'; open: boolean };

/** A message as it travels: the payload plus the namespace and version. */
export type WidgetEnvelope<T> = T & {
  ns: typeof WIDGET_PROTOCOL_NS;
  v: typeof WIDGET_PROTOCOL_VERSION;
};
