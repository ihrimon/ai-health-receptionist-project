import { useEffect, useState } from "preact/hooks";
import { connectHost, type HostConnection, type HostWindow } from "./host";

export interface Host {
  /** The line to the loader; null on a page opened on its own (or until connected). */
  connection: HostConnection | null;
  /** The loader has answered, so it can open and close the chat. */
  embedded: boolean;
  /** The chat panel is showing on the host page. */
  open: boolean;
  /** Goes up each time the panel opens, so the message box can take focus. */
  opened: number;
}

/** The loader's side of the chat window (M4-10): its open state and a way to post to it. */
export function useHost(win: HostWindow): Host {
  const [connection, setConnection] = useState<HostConnection | null>(null);
  const [state, setState] = useState({ embedded: false, open: false, opened: 0 });

  useEffect(() => {
    const link = connectHost(win, (message) =>
      setState((s) => ({
        embedded: true,
        open: message.open,
        opened: message.open && !s.open ? s.opened + 1 : s.opened,
      })),
    );
    setConnection(link);
    return () => link?.disconnect();
  }, [win]);

  return { connection, ...state };
}
