// Where a study guide's pictures and maps show (LAN-222). A step showed a
// picture or map only under the part whose text links it ("[boat](#m4)").
// FIA's text often only names it ("Stop here and look at a picture of a
// boat"), links some by ids the passage does not carry, and in most of its
// languages links nothing at all, so people were told to look at a map and
// found nowhere to see it. Now:
// - a link finds its picture by its ref, by the ref without leading zeros
//   ("t067" is "t67"), or, for a picture or map, by the words of its label
//   ("[fig tree](#m446)" finds the passage's Fig Tree, m129). A link that
//   finds nothing reads as plain words, not as a link that does nothing;
// - a part that asks to look at something (it says map, picture, photo, in
//   the guide's language) and names a picture's or map's title shows it
//   under that part, once in each step, unless the step links it already;
// - after the step's text come the pictures and maps no step links or names;
//   when a part of the step asks to look at something the app cannot match
//   to one ("a picture of a bull", with the passage's "Herd of Cattle"),
//   every picture and map the step does not show already. A step heard but
//   not read shows its own there too.
// Pure: no I/O.
import type { StudyResource } from './guides';
import { inlineParts, studySections } from './text';

/** Where one step shows pictures and maps: under parts of its text, and after the last part. */
export interface StepPictures {
  /** By section id: the ones the part links, then the ones it names. */
  bySection: Record<string, StudyResource[]>;
  /** After the step's text: the guide's pictures and maps that no step links or names, or all the step does not show when it asks for one it cannot match. */
  end: StudyResource[];
}

export interface GuidePictures {
  /** A link's picture, map or term; null when the guide has nothing for it. */
  resolve: (ref: string, label: string) => StudyResource | null;
  /** One step's pictures and maps; `read: false` when the step is heard, not read, so its text (and the cards under it) do not show. */
  step: (stepId: string, read?: boolean) => StepPictures;
}

/** Words that ask to look at something, in the languages FIA's guides are in. A section must say one of them before a title it names brings a card. */
const LOOK_WORDS = [
  // English, Tok Pisin, Bislama
  'map', 'picture', 'photo', 'photograph', 'image', 'illustration', 'video', 'piksa', 'pikja', 'foto',
  // French, Spanish, Portuguese
  'carte', 'imagen', 'imagem', 'imagens', 'fotografia', 'ilustracion', 'ilustracao', 'mapa',
  // Indonesian, Swahili
  'peta', 'gambar', 'ramani', 'picha',
  // Russian (stems), Hindi, Arabic, Persian
  'карт', 'фото', 'фотограф', 'изображ', 'картинк',
  'नक्शा', 'नक्शे', 'मानचित्र', 'चित्र', 'तस्वीर', 'फोटो', 'फ़ोटो', 'वीडियो',
  'خريطة', 'خرائط', 'صورة', 'صور', 'نقشه', 'تصویر', 'عکس'
].map(fold);
/** Written without spaces between words: found anywhere in a section's text. */
const LOOK_RUNS = ['地图', '图片', '照片', '图像', '视频', '影片'];
/** The look words that ask for a map: a map's title is mostly place names, so one of them is enough. */
const MAP_WORDS = ['map', 'carte', 'mapa', 'peta', 'ramani', 'карт', 'नक्शा', 'नक्शे', 'मानचित्र', 'خريطة', 'خرائط', 'نقشه'].map(fold);
const MAP_RUNS = ['地图'];

/** Joining words that say nothing about which picture a title means. */
const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'near', 'view', 'des', 'les', 'avec', 'sur', 'aux', 'pres', 'del', 'los', 'las', 'con',
  'dos', 'das', 'com', 'para', 'dan', 'yang', 'dari', 'dengan', 'kwa', 'pamoja', 'में', 'और'
].map(fold));

/** Scripts written without spaces: a title in one is looked for as a run of characters. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Lower case, Latin accents dropped ("vidéo" is "video"); other scripts' marks are kept, since they spell the word. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase();
}

const wordsOf = (s: string) => fold(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const lengthOf = (w: string) => Array.from(w).length;

/** The same word, give or take an ending: boat and boats, shelter and shelters, denarius and denarii. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = lengthOf(a) <= lengthOf(b) ? [a, b] : [b, a];
  const n = lengthOf(short);
  if (n < 3) return false;
  if (long.startsWith(short) && lengthOf(long) - n <= 3) return true;
  let common = 0;
  const s = Array.from(short), l = Array.from(long);
  while (common < n && s[common] === l[common]) common++;
  return n >= 4 && common >= Math.max(4, n - 2);
}

/** The words of a title that say which picture it is. A one-word title keeps its word, however short. */
function titleWords(title: string): string[] {
  const all = wordsOf(title);
  const kept = all.filter((w) => lengthOf(w) >= 3 && !STOP_WORDS.has(w));
  return [...new Set(kept.length ? kept : all.length === 1 ? all : [])];
}

/** A piece of text, ready to be searched for titles and for the words that ask to look. */
interface Searchable { words: string[]; folded: string }
const searchable = (text: string): Searchable => {
  const plain = inlineParts(text).map((p) => p.text).join('');
  return { words: wordsOf(plain), folded: fold(plain) };
};

/** How many of a title's words the text has (a run in an unspaced script counts when the text holds it). */
function named(title: string[], text: Searchable): number {
  return title.filter((w) => (UNSPACED.test(w) ? text.folded.includes(w) : text.words.some((x) => sameWord(w, x)))).length;
}

/** Enough of a title's words to say the text means it: all of a one- or two-word title, two of a longer one. */
const enough = (title: string[], n: number) => title.length > 0 && n >= Math.min(2, title.length);

/** A word that asks to look, or it with an ending ("maps", "imagens", "карту"); not any word it starts like ("imagine"). */
const isWord = (words: string[]) => (word: string) => words.some((c) => word === c || (word.startsWith(c) && lengthOf(word) - lengthOf(c) <= 4));
const looks = isWord(LOOK_WORDS);
const mapWord = isWord(MAP_WORDS);
const asksToLook = (text: Searchable) => LOOK_RUNS.some((r) => text.folded.includes(r)) || text.words.some(looks);
const asksForMap = (text: Searchable) => MAP_RUNS.some((r) => text.folded.includes(r)) || text.words.some(mapWord);

/** A picture or map with something to look at: a card for one with no picture would open onto nothing. */
const hasPicture = (r: StudyResource) => r.kind !== 'term' && (r.media ?? []).some((m) => m.url || m.file);

/** "t067" is "t67". */
const unpadded = (ref: string) => ref.replace(/^([a-z]+)0+(?=\d)/i, '$1');

/** The guide's pictures, maps and terms as its steps' text finds them. */
export function guidePictures(guide: { steps: { id: string; text: string }[]; resources: StudyResource[] }): GuidePictures {
  const byRef = new Map(guide.resources.map((r) => [r.ref, r]));
  const visual = guide.resources.filter(hasPicture);
  const words = new Map(visual.map((r) => [r.ref, titleWords(r.title)]));

  const resolve = (ref: string, label: string): StudyResource | null => {
    const found = byRef.get(ref) ?? byRef.get(unpadded(ref));
    if (found) return found;
    // A picture or map linked by an id the passage does not carry: the one its words name, preferring the kind the link says.
    const kind = /^c/i.test(ref) ? 'map' : /^m/i.test(ref) ? 'media' : null;
    if (!kind) return null;
    const text = searchable(label);
    let best: { r: StudyResource; score: number } | null = null;
    for (const r of visual) {
      // The link's words say it is this one: one of the title's words is enough.
      const n = named(words.get(r.ref)!, text);
      if (n === 0) continue;
      const score = n * 2 + (r.kind === kind ? 1 : 0);
      if (!best || score > best.score) best = { r, score };
    }
    return best?.r ?? null;
  };

  // Each step's sections, what each links, and the pictures each names.
  const steps = new Map(guide.steps.map((s) => {
    const sections = studySections(s.text);
    const linked = new Map(sections.map((sec) => [sec.id, uniq(inlineParts(sec.text).flatMap((p) => {
      if (p.type !== 'link') return [];
      const r = resolve(p.ref, p.text);
      return r && r.kind !== 'term' ? [r] : [];
    }))]));
    const linkedRefs = new Set([...linked.values()].flat().map((r) => r.ref));
    const looking = sections.map((sec) => ({ id: sec.id, text: searchable(sec.text) })).filter((sec) => asksToLook(sec.text))
      .map((sec) => ({ ...sec, map: asksForMap(sec.text) }));
    // What each part that asks to look names (a map it asks for by one of its places), and the part that names each picture best (the first, when two name it as well).
    const names = new Map(looking.map((sec) => [sec.id, visual.filter((r) => {
      const n = named(words.get(r.ref)!, sec.text);
      return r.kind === 'map' && sec.map ? n > 0 : enough(words.get(r.ref)!, n);
    })]));
    const namedHere = new Map<string, StudyResource[]>();
    for (const r of visual) {
      if (linkedRefs.has(r.ref)) continue;
      const title = words.get(r.ref)!;
      let best: { id: string; n: number } | null = null;
      for (const sec of looking) {
        if (!names.get(sec.id)!.includes(r)) continue;
        const n = named(title, sec.text);
        if (!best || n > best.n) best = { id: sec.id, n };
      }
      if (best) namedHere.set(best.id, [...(namedHere.get(best.id) ?? []), r]);
    }
    const bySection: Record<string, StudyResource[]> = {};
    for (const sec of sections) {
      const here = uniq([...(linked.get(sec.id) ?? []), ...(namedHere.get(sec.id) ?? [])]);
      if (here.length) bySection[sec.id] = here;
    }
    // A part asks to look at something it neither links nor names in a way the app can find ("look at a picture of a bull", with the passage's "Herd of Cattle").
    const unmet = looking.some((sec) => !bySection[sec.id] && !names.get(sec.id)!.length);
    return [s.id, { bySection, unmet }] as const;
  }));

  const shown = new Set([...steps.values()].flatMap((st) => Object.values(st.bySection).flat().map((r) => r.ref)));
  const rest = visual.filter((r) => !shown.has(r.ref));

  return {
    resolve,
    step: (stepId, read = true) => {
      const st = steps.get(stepId);
      if (!st) return { bySection: {}, end: rest };
      const own = uniq(Object.values(st.bySection).flat());
      const here = new Set(own.map((r) => r.ref));
      // When the step asks for something it could not be matched to, every picture and map it does not show already, so the one it means is on the step.
      const others = st.unmet ? visual.filter((r) => !here.has(r.ref)) : rest;
      if (read) return { bySection: st.bySection, end: others };
      return { bySection: {}, end: uniq([...own, ...others]) };
    }
  };
}

function uniq(rs: StudyResource[]): StudyResource[] {
  const seen = new Set<string>();
  return rs.filter((r) => !seen.has(r.ref) && !!seen.add(r.ref));
}
