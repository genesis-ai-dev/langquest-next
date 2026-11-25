import { carriedApkBuiltMs } from '../server/carriedApk';

/*
 * When the Worker's carried file for this phone's versions was built, asked by a phone that keeps a
 * copy, so it can say a newer one is ready (docs/decisions/2026-11-19-carried-build-refreshed-daily.md,
 * amended 2026-11-25). Only Android's files import this (useCarriedApk.android.ts).
 */

/** How long an answer stands, so Download the install file, Sync and Share nearby ask once between them. */
export const ASK_AGAIN_MS = 10 * 60 * 1000;

let answer: { name: string; at: number; ms: number | null } | null = null;
let asking: Promise<number | null> | null = null;

/**
 * When the Worker's file for `name` was built (`carriedApkBuiltMs`), asked at most once in
 * ASK_AGAIN_MS; one question at a time. A failed one, as offline, is not kept, so the next screen asks again.
 */
export function builtOnServer(name: string, now = Date.now): Promise<number | null> {
  if (answer?.name === name && now() - answer.at < ASK_AGAIN_MS) return Promise.resolve(answer.ms);
  asking ??= carriedApkBuiltMs(name)
    .then((ms) => {
      answer = { name, at: now(), ms };
      return ms;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}
