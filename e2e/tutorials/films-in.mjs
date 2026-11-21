#!/usr/bin/env node
// Tells the app's Worker that new films are in the `tutorials` release
// (apps/web/worker/tutorialFilmed.ts, docs/tutorial-videos.md, decisions.md
// 192): its intake takes them in and chooses the wide ones for YouTube, and
// the publish job puts them up at once, not at the next scheduled time.
// GitHub's OIDC token says which workflow this is: the filming holds no key
// to production. A refusal only warns, as a late film only waits for the
// intake at five past midnight in California.
//
// With --languages it asks the same door which languages to film tonight (the
// ops dashboard's switches, ops.tutorial_filming) and prints them, separated
// by commas, or `none`; it prints nothing when it gets no answer, and the
// workflow then films NIGHTLY_LANGUAGES.
//
//   node e2e/tutorials/films-in.mjs     in tutorials.yml, with id-token: write
//   node e2e/tutorials/films-in.mjs --languages
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILMED_API = 'https://next.langquest.org/api/tutorial-filmed';

/** Asks GitHub for this job's OIDC token for the Worker, then knocks: the Worker's answer, or why there was none. */
export async function sayFilmsIn(env, fetcher = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return { ok: false, said: 'no GitHub OIDC token here: the job needs id-token: write' };
  try {
    const got = await fetcher(`${url}&audience=${encodeURIComponent(FILMED_API)}`, { headers: { authorization: `bearer ${bearer}` } });
    if (!got.ok) return { ok: false, said: `GitHub OIDC token: HTTP ${got.status}` };
    const { value } = await got.json();
    const res = await fetcher(FILMED_API, { method: 'POST', headers: { authorization: `Bearer ${value}` } });
    const text = (await res.text()).slice(0, 300);
    return res.ok ? { ok: true, said: text } : { ok: false, said: `${FILMED_API}: HTTP ${res.status} ${text}` };
  } catch (e) {
    return { ok: false, said: e instanceof Error ? e.message : String(e) };
  }
}

/** The languages the dashboard turned on: a list (maybe empty), or null with why there was no answer. */
export async function askLanguages(env, fetcher = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return { languages: null, said: 'no GitHub OIDC token here: the job needs id-token: write' };
  try {
    const got = await fetcher(`${url}&audience=${encodeURIComponent(FILMED_API)}`, { headers: { authorization: `bearer ${bearer}` } });
    if (!got.ok) return { languages: null, said: `GitHub OIDC token: HTTP ${got.status}` };
    const { value } = await got.json();
    const res = await fetcher(FILMED_API, { headers: { authorization: `Bearer ${value}` } });
    if (!res.ok) return { languages: null, said: `${FILMED_API}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}` };
    const body = await res.json();
    const good = Array.isArray(body?.languages) && body.languages.every((l) => typeof l === 'string' && /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(l));
    return good ? { languages: body.languages, said: 'ok' } : { languages: null, said: `${FILMED_API}: not a list of languages` };
  } catch (e) {
    return { languages: null, said: e instanceof Error ? e.message : String(e) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2] === '--languages') {
  const { languages, said } = await askLanguages(process.env);
  if (languages) console.log(languages.length ? languages.join(',') : 'none');
  else console.error(`::warning title=Filming languages not read::${said.replace(/\r?\n/g, ' ')}; filming NIGHTLY_LANGUAGES.`);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { ok, said } = await sayFilmsIn(process.env);
  console.log(ok ? `LangQuest takes the films in: ${said}` : `::warning title=Films not yet taken in::${said.replace(/\r?\n/g, ' ')}; the intake at midnight Pacific takes them in.`);
}
