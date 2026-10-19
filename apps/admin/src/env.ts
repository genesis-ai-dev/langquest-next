export interface Env {
  SUPABASE_URL: string;
  /** The public key every app build carries; the page signs in with it, and the Worker checks sign-ins with it. */
  SUPABASE_ANON_KEY: string;
  /** `ref:name` pairs, comma-separated: the projects the Supabase section reports on. */
  SUPABASE_PROJECTS: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  /** Worker names, comma-separated, for the Cloudflare section. */
  CLOUDFLARE_WORKERS: string;
  /** The web app; its /version.json says which commit it runs. */
  APP_URL: string;
  /** owner/name on GitHub. */
  GITHUB_REPO: string;
  VERCEL_TEAM_ID: string;
  EXPO_PROJECT_ID: string;
  GOOGLE_PLAY_PACKAGE: string;
  /** The app's Apple id in App Store Connect (eas.json submit.production.ios.ascAppId). */
  APP_STORE_APP_ID: string;

  /** diag_reader's login (scripts/diag-access.sh): reads `diag` and nothing else, and cannot write. */
  DIAG_DATABASE_URL: string;
  /** Profile ids, comma-separated, of the people who may open the page; until it is set, no one can. */
  ADMIN_PROFILE_IDS?: string;

  // Optional, each read only by its own section (docs/admin.md says how to make one).
  /** Account Analytics Read, Workers Scripts Read, Workers CI Read. */
  ADMIN_CLOUDFLARE_TOKEN?: string;
  /** A Supabase access token: project health, Edge Functions and log counts. */
  ADMIN_SUPABASE_TOKEN?: string;
  ADMIN_VERCEL_TOKEN?: string;
  /** Read-only, for Actions runs; without it GitHub's anonymous limit applies, which a Worker shares. */
  ADMIN_GITHUB_TOKEN?: string;
  /** An Expo robot's access token, for builds, submissions and updates. */
  ADMIN_EXPO_TOKEN?: string;
  /** A Google service account's key file (JSON) that Play Console lets view app information. */
  ADMIN_GOOGLE_PLAY_KEY?: string;
  /** An App Store Connect API key as JSON: issuerId, keyId and the .p8 privateKey. */
  ADMIN_APP_STORE_KEY?: string;

  ADMIN_RATE_LIMIT?: RateLimit;
}

/** A comma-separated var as trimmed, non-empty items. */
export const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
