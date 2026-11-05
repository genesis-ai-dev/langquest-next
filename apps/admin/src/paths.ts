/**
 * Where the page and its API live on next.langquest.org (docs/admin.md); the
 * page's script calls API_BASE too (page.ts, pageOps.ts). Kept out of
 * index.ts: the Workers runtime takes every export of the main module as an
 * entrypoint and refuses one that is not a handler.
 */
export const PAGE_PATH = '/ops-dashboard';
export const API_BASE = '/ops/api/';
