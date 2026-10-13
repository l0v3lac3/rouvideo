/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Client URL of the Convex deployment (`.convex.cloud`). */
  readonly VITE_CONVEX_URL?: string;
  /** HTTP actions URL of the Convex deployment (`.convex.site`) — the player API. */
  readonly VITE_CONVEX_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
