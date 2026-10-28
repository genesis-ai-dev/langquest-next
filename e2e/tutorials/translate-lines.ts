// Fills in e2e/tutorials/lines/<language>.json: each video's title and lines
// in every app language, for film.ts to say when TUTORIAL_LANGUAGE is set.
// Only lines a language lacks are translated, by Gemini in one batch job
// (a request per video and language), with the app's own words for what the
// lines name ("Tap Save Profile.") from its catalogs, so a video says what
// its screens show. The app's catalogs are machine translations approved as
// they are (decisions.md 81); these lines are made the same way.
//
//   npx tsx e2e/tutorials/translate-lines.ts [language ...]
//   TUTORIAL_TRANSLATE_SHOW=1 npx tsx e2e/tutorials/translate-lines.ts es   (what Gemini is asked)
//
// GEMINI_API_KEY is sent when it is set, as in gemini-voice.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UI_LANGUAGES } from '@langquest-next/core';
import { TUTORIALS } from './all';

const MODEL = process.env['TUTORIAL_TRANSLATE_MODEL'] ?? 'gemini-pro-latest';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (process.env['GEMINI_API_KEY']) headers['x-goog-api-key'] = process.env['GEMINI_API_KEY'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Catalog = { [key: string]: string | Catalog };
const catalog = (code: string) => JSON.parse(readFileSync(path.join('apps', 'mobile', 'src', 'i18n', `${code}.json`), 'utf8')) as Catalog;
function flat(c: Catalog, prefix = '', into = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(c)) typeof v === 'string' ? into.set(prefix + k, v) : flat(v, `${prefix}${k}.`, into);
  return into;
}
const linesFile = (code: string) => path.join('e2e', 'tutorials', 'lines', `${code}.json`);
const english = flat(catalog('en'));

/** The app's words that a video's lines name, with what the app says for each in this language. */
function glossary(lines: string[], target: Map<string, string>): string[] {
  const said = new Map<string, Set<string>>();
  for (const [key, en] of english) {
    const words = en.trim();
    // A name on the screen: capitalised, more than a little word, not a sentence.
    if (!/^[A-Z0-9]/.test(words) || words.length < 4 || words.length > 40 || words.includes('{{') || words.split(' ').length > 5) continue;
    const pattern = new RegExp(`(^|[^\\w])${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`);
    const theirs = target.get(key);
    if (!theirs || !lines.some((l) => pattern.test(l))) continue;
    said.set(words, (said.get(words) ?? new Set()).add(theirs));
  }
  return [...said].sort((a, b) => b[0].length - a[0].length).slice(0, 120).map(([en, t]) => `"${en}" → ${[...t].map((x) => `"${x}"`).join(' or ')}`);
}

function prompt(language: string, title: string, lines: string[], missing: string[], example: Record<string, string>, words: string[]): string {
  return [
    `Translate the narration of a short how-to video about the LangQuest app into ${language}. LangQuest is a phone app that teams use to record Bible translations in their own languages. The narration is spoken by a computer voice over a screen recording of the app in ${language}, to people new to phones, so it must be short, plain, natural spoken ${language}.`,
    '',
    'Rules:',
    `- When a line names something on the screen (a button, a tab, a title), use exactly the app's own ${language} words for it, from the list below.`,
    '- Keep people\'s names (Grace, Daniel, Peter...), the made-up language names (Lumari, Kitara...) and organization names as they are.',
    `- Write book names of the Bible in ${language}; write numbers as they are said aloud in ${language} where the English spells them out.`,
    '- Address the viewer the way the examples do. Say "tap" the way the examples do.',
    '- Translate the meaning, not word for word. Do not add or drop information.',
    '',
    `The video: "${title}". All its lines, in order:`,
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    '',
    `The app's own ${language} words for what the lines name:`,
    ...(words.length ? words : ['(none)']),
    '',
    `Examples of lines already translated into ${language} for another video:`,
    ...Object.entries(example).slice(0, 8).map(([en, t]) => `"${en}" → "${t}"`),
    '',
    'Translate these, and return a JSON array of {"en": <the English exactly as given>, "text": <the translation>}:',
    ...missing.map((l) => JSON.stringify(l))
  ].join('\n');
}

async function call(url: string, init?: RequestInit): Promise<any> {
  let lastError = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { headers, ...init });
    if (res.ok) return res.json();
    lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(lastError);
}

const wanted = process.argv.slice(2);
const languages = UI_LANGUAGES.filter((l) => l.code !== 'en' && (!wanted.length || wanted.includes(l.code)));
const jobs: { code: string; missing: string[]; text: string }[] = [];
const files = new Map<string, Record<string, string>>();
for (const language of languages) {
  const have: Record<string, string> = existsSync(linesFile(language.code)) ? JSON.parse(readFileSync(linesFile(language.code), 'utf8')) : {};
  files.set(language.code, have);
  const target = flat(catalog(language.code));
  for (const tutorial of Object.values(TUTORIALS)) {
    const lines = [...new Set(tutorial.steps.filter((s) => s.say).map((s) => s.say!))];
    const missing = [tutorial.title, ...lines].filter((l) => !have[l]);
    if (!missing.length) continue;
    jobs.push({ code: language.code, missing, text: prompt(`${language.english} (${language.name})`, tutorial.title, lines, missing, have, glossary([tutorial.title, ...lines], target)) });
  }
}
if (!jobs.length) { console.log('Every line is translated.'); process.exit(0); }
// TUTORIAL_TRANSLATE_SHOW=1: print what Gemini would be asked for the first video, and stop.
if (process.env['TUTORIAL_TRANSLATE_SHOW'] === '1') { console.log(jobs[0]!.text); process.exit(0); }
console.log(`${jobs.length} videos to translate, ${jobs.reduce((n, j) => n + j.missing.length, 0)} lines, with ${MODEL}`);

const schema = { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['en', 'text'] } };
let job = await call(`${API}/models/${MODEL}:batchGenerateContent`, {
  method: 'POST',
  body: JSON.stringify({ batch: { display_name: `tutorial lines translated (${jobs.length})`, input_config: { requests: { requests: jobs.map((j, i) => ({
    request: { contents: [{ parts: [{ text: j.text }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } },
    metadata: { key: String(i) }
  })) } } } })
});
const name = job.name as string;
console.log(`Gemini's batch ${name}`);
for (;;) {
  const state = (job.metadata ?? job).state as string;
  if (state === 'BATCH_STATE_SUCCEEDED') break;
  if (state !== 'BATCH_STATE_PENDING' && state !== 'BATCH_STATE_RUNNING') throw new Error(`Gemini's batch ${name} ended ${state}`);
  await sleep(20_000);
  job = await call(`${API}/${name}`);
}

const problems: string[] = [];
for (const reply of (job.response ?? job.metadata?.output)?.inlinedResponses?.inlinedResponses ?? []) {
  const j = jobs[Number(reply.metadata?.key)];
  if (!j) continue;
  const text = reply.response?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  let pairs: { en: string; text: string }[] = [];
  try { pairs = JSON.parse(text); } catch { problems.push(`${j.code}: not JSON (${JSON.stringify(reply.error ?? text.slice(0, 120))})`); continue; }
  const file = files.get(j.code)!;
  for (const en of j.missing) {
    const t = pairs.find((p) => p.en.trim() === en.trim())?.text.trim();
    if (t) file[en] = t; else problems.push(`${j.code}: no translation of "${en}"`);
  }
}
for (const [code, file] of files) writeFileSync(linesFile(code), JSON.stringify(file, null, 1) + '\n');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Done.');
