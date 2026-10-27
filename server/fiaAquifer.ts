/**
 * FIA as Bible Aquifer publishes it, into library documents (decisions.md
 * 173, docs/publisher-imports.md). Aquifer keeps FIA's study guides, key
 * terms, pictures and maps in public GitHub repositories
 * (`<owner>/FIATranslationGuide`, `FIAKeyTerms`, `FIAImages`, `FIAMaps`), one
 * folder per language: HTML articles, a guide's six steps under `<h2>`, and
 * an audio article beside each with one MP3 per step. These become the same
 * `study@1` guides and `collection@1` per language that
 * `scripts/fia-adapter.ts` makes from fia.bible's API, so the app reads them
 * as it reads FIA today. Pure: JSON in, documents out.
 */
import { bookOrder, parseRef, withDeps, type CollectionDoc, type StudyDoc, type StudyResourceDoc } from '@langquest-next/core';

/** FIA's licence and holder (the same words as scripts/fia-adapter.ts). */
export const FIA_ATTRIBUTION = '© 2025 Word Collective, CC BY-SA 4.0';

/** What Aquifer's notice says of every language but English. */
export const AQUIFER_ADAPTATION = 'adapted by Mission Mutual (Bible Aquifer)';

const FIA_ABOUT =
  'FIA takes the team through six steps for each passage, in audio and text, before anyone drafts: Familiarize, then Internalize, then Articulate. Each step asks you to listen to the passage again. Answers and notes the team adds stay with the passage, so reviewers can see the study behind the draft.';

/**
 * FIA's six steps in their order: the same ids, phases and purposes
 * `scripts/fia-adapter.ts` gives (a test holds them together), because study
 * records point at the ids.
 */
export const FIA_STEP_ORDER = [
  { id: 'hear', phase: 'Familiarize', purpose: 'Hear the passage in more than one translation, then talk about it together.' },
  { id: 'stage', phase: 'Familiarize', purpose: 'Where the passage sits in the bigger story, and its culture, history and places.' },
  { id: 'scenes', phase: 'Internalize', purpose: 'Frame the passage: its scenes, settings and people. Draw or build them.' },
  { id: 'embody', phase: 'Internalize', purpose: 'Act the passage out twice: first straight through, then stopping to ask how people feel.' },
  { id: 'gaps', phase: 'Articulate', purpose: "The words to choose, with the key terms in FIA's Master Glossary." },
  { id: 'speak', phase: 'Articulate', purpose: 'Tell it in your own language, together, until everyone agrees on a version.' }
] as const;

/** About 140 words a minute, with room for the pauses FIA asks for (the app's estimate). */
const secondsFor = (words: number) => Math.round(words / 2.2);

// ---- Aquifer's shape (only what is read) ------------------------------------------

export interface AquiferArticle {
  content_id: string;
  title: string;
  media_type: string;
  index_reference?: string;
  content: string;
  associations?: { passage?: { start_ref_usfm?: string; end_ref_usfm?: string }[] };
}

/** A repository folder's `metadata.json`: its files, the language's name, and its articles by name. */
export interface AquiferMetadata {
  scripture_burrito?: { languages?: { tag?: string; name?: Record<string, string> }[]; ingredients?: Record<string, unknown> };
  article_metadata?: Record<string, unknown>;
}

/** The JSON files a folder holds, in order ("json/01.content.json"). */
export function contentFiles(meta: AquiferMetadata): string[] {
  return Object.keys(meta.scripture_burrito?.ingredients ?? {}).filter((f) => /^json\/[^/]+\.content\.json$/.test(f)).sort();
}

/** The guides a folder lists, by Aquifer's names for them ("eng-jhn-p1-v1.1"), without their audio. */
export function guideIds(meta: AquiferMetadata): string[] {
  return Object.keys(meta.article_metadata ?? {}).filter((id) => !id.endsWith('-audio')).sort();
}

/** "eng-1ch-p17-v1.1" is passage "eng-1ch-p17" at version "1.1". */
const versioned = (id: string): [string, string] => {
  const m = /^(.*)-v(\d+(?:\.\d+)*)$/.exec(id);
  return m ? [m[1]!, m[2]!] : [id, ''];
};

/**
 * What the source has now that an import did not take: guides for passages
 * it did not have (added), and guides at a new version (updated). Guides the
 * source dropped are not counted; importing again leaves them out.
 */
export function sourceChanges(before: readonly string[], now: readonly string[]): { added: number; updated: number } {
  const had = new Map(before.map(versioned));
  let added = 0, updated = 0;
  for (const id of now) {
    const [passage, version] = versioned(id);
    if (!had.has(passage)) added++;
    else if (had.get(passage) !== version) updated++;
  }
  return { added, updated };
}

/** The language's own name as the folder gives it, English first. */
export function languageNameOf(meta: AquiferMetadata, code: string): string {
  const name = meta.scripture_burrito?.languages?.[0]?.name ?? {};
  return name['en'] ?? Object.values(name)[0] ?? code;
}

// ---- HTML to the markdown the app reads (study/text.ts) ------------------------------

type Node = { tag: string; attrs: Record<string, string>; kids: Node[] } | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

const VOID = new Set(['br', 'img', 'hr', 'source', 'meta', 'link', 'input', 'wbr']);

/** A forgiving parse of Aquifer's simple HTML: tags, attributes and text; an unclosed tag ends with its parent. */
export function parseHtml(html: string): Node[] {
  const root: { tag: string; attrs: Record<string, string>; kids: Node[] } = { tag: '', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1]!;
    if (m[4] !== undefined || !m[2]) { top.kids.push(decode(m[4] ?? '<')); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1]!.toLowerCase()] = decode(a[3] ?? a[4] ?? a[5] ?? '');
    const node = { tag, attrs, kids: [] as Node[] };
    top.kids.push(node);
    if (!VOID.has(tag) && !m[3]!.trim().endsWith('/')) stack.push(node);
  }
  return root.kids;
}

/** How a `<data class="resource-ref">` is linked: its ref in the guide, or null to keep the words plain. */
export type RefOf = (resourceCode: string, contentId: string) => string | null;

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'div', 'block', 'section', 'table']);
const squash = (s: string) => s.replace(/[ \t\r\n]+/g, ' ');

function inline(nodes: Node[], refOf: RefOf): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') { out += squash(n); continue; }
    const inner = inline(n.kids, refOf);
    if (n.tag === 'b' || n.tag === 'strong') out += inner.trim() ? `**${inner.trim()}**` : inner;
    else if (n.tag === 'data' && n.attrs['class'] === 'resource-ref') {
      const ref = refOf(n.attrs['data-resource-code'] ?? '', n.attrs['data-content-id'] ?? '');
      out += ref && inner.trim() ? `[${inner.trim().replace(/[[\]]/g, '')}](#${ref})` : inner;
    } else if (n.tag === 'br') out += '\n';
    else if (n.tag === 'img') continue;
    else out += inner;
  }
  return out;
}

/** Blocks as markdown paragraphs (a blank line between), lists one item a line, quotes and callouts with `> `. */
function blocks(nodes: Node[], refOf: RefOf): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = inline(run, refOf).replace(/ *\n */g, '\n').trim();
    if (text) out.push(text);
    run = [];
  };
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCKS.has(n.tag)) { run.push(n); continue; }
    flush();
    if (n.tag === 'ul' || n.tag === 'ol') {
      const items = n.kids.filter((k): k is Exclude<Node, string> => typeof k !== 'string' && k.tag === 'li');
      const lines = items.map((li, i) => `${n.tag === 'ol' ? `${i + 1}.` : '-'} ${blocks(li.kids, refOf).join(' ')}`.trimEnd());
      if (lines.length) out.push(lines.join('\n'));
    } else if (n.tag === 'blockquote') {
      const inner = blocks(n.kids, refOf).join('\n\n');
      if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (n.tag === 'div' && n.attrs['data-type'] === 'callout') {
      // A callout: "> [!action] Pause the drama." and what follows it, as study/text.ts reads them.
      const kind = n.attrs['data-callout-style'] || 'action';
      const head = n.kids.find((k): k is Exclude<Node, string> => typeof k !== 'string' && k.attrs['data-callout-section'] === 'header');
      const body = n.kids.filter((k) => k !== head);
      const lines = [...(head ? [inline(head.kids, refOf).trim()] : []), ...blocks(body, refOf)].join('\n\n').split('\n');
      out.push([`> [!${kind}] ${lines[0] ?? ''}`.trimEnd(), ...lines.slice(1).map((l) => (l ? `> ${l}` : '>'))].join('\n'));
    } else {
      out.push(...blocks(n.kids, refOf));
    }
  }
  flush();
  return out;
}

/** Aquifer's HTML as the markdown study guides use. */
export function htmlToMarkdown(html: string | Node[], refOf: RefOf = () => null): string {
  return blocks(typeof html === 'string' ? parseHtml(html) : html, refOf).join('\n\n');
}

const plain = (html: string) => htmlToMarkdown(html).replace(/\*\*([^*]+)\*\*/g, '$1');

// ---- the resources a guide points at ---------------------------------------------------

/** "eng-t148-v1" or "fra-t148-v2" -> "t148": a key term's ref, the same in every language. */
export const termRef = (contentId: string) => /^(?:[a-z]{2,3}-)?(t\d+)(?:-v\d+)?$/.exec(contentId)?.[1] ?? null;

export interface Term { term: string; body: string }
export interface Picture { title: string; url: string }

/** Key terms by ref, from FIAKeyTerms' articles. */
export function termsFrom(articles: AquiferArticle[]): Map<string, Term> {
  const out = new Map<string, Term>();
  for (const a of articles) {
    const ref = termRef(a.content_id);
    if (ref && a.media_type === 'Text' && !out.has(ref)) out.set(ref, { term: a.title.trim(), body: plain(a.content) });
  }
  return out;
}

/** Pictures or maps by id ("a203", "c169"), each at the smaller size Aquifer offers for a phone. */
export function picturesFrom(articles: AquiferArticle[]): Map<string, Picture> {
  const out = new Map<string, Picture>();
  for (const a of articles) {
    const src = /<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(a.content)?.[1];
    if (src && !out.has(a.content_id)) out.set(a.content_id, { title: a.title.trim(), url: src.replace(/\/(1000|2000)\.(jpe?g|png)$/i, '/500.$2') });
  }
  return out;
}

export interface FiaResources { terms: Map<string, Term>; pictures: Map<string, Picture>; maps: Map<string, Picture> }

// ---- guides -----------------------------------------------------------------------

/** "JHN 1:1" to "JHN 1:5" -> "JHN 1:1-5"; across chapters "GEN 1:1-2:3". From the index ("43001001-43001005") when there is no passage. */
export function aquiferRef(a: AquiferArticle): string | null {
  const p = a.associations?.passage?.[0];
  let start = p?.start_ref_usfm, end = p?.end_ref_usfm;
  if (!start) {
    const m = /^(\d{2})(\d{3})(\d{3})(?:-(\d{2})(\d{3})(\d{3}))?$/.exec(a.index_reference ?? '');
    const book = (n: string) => BOOKS[Number(n) - 1];
    if (!m || !book(m[1]!)) return null;
    start = `${book(m[1]!)} ${Number(m[2])}:${Number(m[3])}`;
    end = m[4] && book(m[4]) ? `${book(m[4])} ${Number(m[5])}:${Number(m[6])}` : start;
  }
  const s = /^([1-4A-Z]{3}) (\d+):(\d+)$/.exec(start ?? '');
  const e = /^([1-4A-Z]{3}) (\d+):(\d+)$/.exec(end ?? start ?? '');
  if (!s || !e || s[1] !== e[1]) return null;
  const ref = s[2] === e[2] ? (s[3] === e[3] ? `${s[1]} ${s[2]}:${s[3]}` : `${s[1]} ${s[2]}:${s[3]}-${e[3]}`) : `${s[1]} ${s[2]}:${s[3]}-${e[2]}:${e[3]}`;
  return parseRef(ref) ? ref : null;
}

/** The 66 books by Aquifer's numbers (01 Genesis to 66 Revelation). */
const BOOKS = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG',
  'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'];

/** The step audio an audio article links to, in order. */
export const audioUrls = (a: AquiferArticle | undefined) => (a ? [...a.content.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+\.mp3)["']/gi)].map((m) => m[1]!) : []);

/** The source line readers see: where it came from, in which language, and FIA's credit. */
export const sourceLine = (lang: string, languageName: string) =>
  `FIA · ${languageName} · ${FIA_ATTRIBUTION}${lang === 'eng' ? '' : ` · ${AQUIFER_ADAPTATION}`}`;

/**
 * One FIA guide as a `study@1` document, numbered in the English
 * versification (`versification` is that document's hash). Null when the
 * article names no passage or has no steps.
 */
export function fiaGuide(text: AquiferArticle, audio: AquiferArticle | undefined, res: FiaResources, lang: string, languageName: string, versification: string): StudyDoc | null {
  const ref = aquiferRef(text);
  if (!ref) return null;
  const used = { terms: new Set<string>(), pictures: new Set<string>(), maps: new Set<string>() };
  const refOf: RefOf = (code, id) => {
    if (code === 'FIAKeyTerms') { const r = termRef(id); if (r && res.terms.has(r)) { used.terms.add(r); return r; } return null; }
    if (code === 'FIAImages' && res.pictures.has(id)) { used.pictures.add(id); return id; }
    if (code === 'FIAMaps' && res.maps.has(id)) { used.maps.add(id); return id; }
    return null;
  };
  // Steps start at each <h2>; anything before the first belongs to it.
  const sections: { title: string; nodes: Node[] }[] = [];
  for (const n of parseHtml(text.content)) {
    if (typeof n !== 'string' && n.tag === 'h2') sections.push({ title: squash(inline(n.kids, () => null)).trim(), nodes: [] });
    else if (sections.length) sections[sections.length - 1]!.nodes.push(n);
    else if (typeof n !== 'string' || n.trim()) sections.push({ title: '', nodes: [n] });
  }
  if (!sections.length) return null;
  const urls = audioUrls(audio);
  const fia = sections.length === FIA_STEP_ORDER.length;
  const steps: StudyDoc['steps'] = sections.map((s, i) => {
    const body = htmlToMarkdown(s.nodes, refOf);
    const info = fia ? FIA_STEP_ORDER[i]! : null;
    const words = body.split(/\s+/).filter(Boolean).length;
    return {
      id: info?.id ?? `step${i + 1}`,
      title: s.title || (info ? info.id : `${i + 1}`),
      ...(info ? { phase: info.phase } : {}),
      purpose: info?.purpose ?? '',
      text: body,
      audio: { ...(urls[i] ? { url: urls[i] } : {}), seconds: secondsFor(words) }
    };
  });
  const picture = (kind: 'media' | 'map', id: string, p: Picture): StudyResourceDoc =>
    ({ ref: id, kind, title: p.title, media: [{ id, kind: kind === 'map' ? 'map' : 'photo', title: p.title, caption: '', url: p.url }] });
  const resources: StudyResourceDoc[] = [
    ...[...used.pictures].map((id) => picture('media', id, res.pictures.get(id)!)),
    ...[...used.maps].map((id) => picture('map', id, res.maps.get(id)!)),
    ...[...used.terms].map((id) => ({ ref: id, kind: 'term' as const, title: res.terms.get(id)!.term }))
  ];
  const terms: StudyDoc['terms'] = [...used.terms].map((id) => ({ id, term: res.terms.get(id)!.term, body: res.terms.get(id)!.body }));
  return withDeps<StudyDoc>({
    format: 'study@1', title: text.title.trim() || ref, pattern: 'FIA', about: FIA_ABOUT, source: sourceLine(lang, languageName),
    language: lang, ref, versification, steps, resources, terms, deps: []
  });
}

/** Text articles with their audio beside them ("eng-jhn-p1-v1" and "eng-jhn-p1-v1-audio"). */
export function guideArticles(articles: AquiferArticle[]): { text: AquiferArticle; audio?: AquiferArticle }[] {
  const audio = new Map(articles.filter((a) => a.media_type === 'Audio').map((a) => [a.content_id.replace(/-audio$/, ''), a]));
  return articles.filter((a) => a.media_type === 'Text').map((text) => ({ text, ...(audio.get(text.content_id) ? { audio: audio.get(text.content_id)! } : {}) }));
}

const refOrder = (ref: string) => {
  const r = parseRef(ref)!;
  return [bookOrder(r.book), r.start.chapter, r.start.verse] as const;
};

/** One language's guides as the library item the app offers ("FIA study guides (English)"), in Bible order. */
export function fiaCollection(lang: string, languageName: string, versification: string, entries: { ref: string; title: string; doc: string }[]) {
  const sorted = [...entries].sort((a, b) => {
    const [x, y] = [refOrder(a.ref), refOrder(b.ref)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.doc < b.doc ? -1 : 1);
  });
  const name = `FIA study guides (${languageName})`;
  const credit = `${FIA_ATTRIBUTION}${lang === 'eng' ? '' : `, ${AQUIFER_ADAPTATION}`}`;
  const description = `FIA's study guides in ${languageName}, found by the verses a passage covers. ${credit}.`;
  const doc = withDeps<CollectionDoc>({ format: 'collection@1', title: name, description, language: lang, pattern: 'FIA', versification, entries: sorted, deps: [] });
  return { itemId: `fia.${lang}`, name, description, doc };
}
