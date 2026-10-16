/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin, e.g. `https://api.example.com` (no `/v1`). */
  readonly VITE_API_URL?: string;
  /**
   * Where the loader opens the chat window (`<url>/w/<publicId>`), e.g. the
   * API that serves the page (M4-19); unset, the loader script's own origin.
   */
  readonly VITE_WIDGET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
