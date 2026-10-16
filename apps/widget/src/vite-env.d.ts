/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin, e.g. `https://api.example.com` (no `/v1`). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
