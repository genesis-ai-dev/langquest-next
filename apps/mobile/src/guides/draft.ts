// The guide editor's draft (docs/reference-material.md, "Guide editor"): a
// study guide being written, kept on the device until it is published as a
// `study@2` library document. Everything the editor does is an action on
// this draft through `draftReducer`; `buildDoc` makes the document and
// `draftProblems` says, in plain words, what stops it being published.
// Pure: no React, no storage.
import {
  CALLOUT_KINDS, isHash, isLicense, LICENSE_INFO, parseRef, validateDoc, withDeps,
  type CalloutKind, type MaterialLink, type MediaRef, type StudyDoc, type StudyDoc2
} from '@langquest-next/core';
import type { StudyMediaKind } from '../study/guides';
import { inlineParts } from '../study/text';
import type { Method } from './methods';

export interface DraftStep {
  id: string;
  title: string;
  phase: string;
  purpose: string;
  /** Markdown, as the step screen reads it (study/text.ts). */
  text: string;
  audio?: MediaRef;
}

export interface DraftMedia {
  id: string;
  kind: StudyMediaKind;
  title: string;
  caption: string;
  file: MediaRef;
}

/** Pictures or a map a step links to by `ref` (`m1` pictures, `c1` a map). */
export interface DraftResource {
  ref: string;
  kind: 'media' | 'map';
  title: string;
  description: string;
  media: DraftMedia[];
}

/** A glossary entry; its id is the ref a step links to (`t1`). */
export interface DraftTerm {
  id: string;
  term: string;
  hint: string;
  body: string;
  audio?: MediaRef;
}

export type TemplatePart = { template: string; node: string };

/** What the draft was made from, when it was not new. */
export interface DraftBasis {
  docHash: string;
  /** Set when editing this organization's own item: publishing makes its next version. */
  itemId?: string;
  /** Copied from FIA or another organization to adapt. */
  adapted?: boolean;
  /** The source's license asks that adaptations keep it (FIA is CC BY-SA). */
  shareAlike?: string;
  /** The source's license does not allow adapting it. */
  noAdapt?: string;
}

export interface GuideDraft {
  v: 1;
  title: string;
  /** BCP-47-ish code of the guide's text ("eng"). */
  language: string;
  /** The method it follows ("FIA", or the organization's own name). */
  pattern: string;
  about: string;
  /** Where it came from, as readers see it ("Wycliffe Associates"). */
  source: string;
  license: string;
  credit: string;
  /** A verse range ("LUK 15:11-32"), read in `versification`. Empty when placed only by parts. */
  ref: string;
  versification: string | null;
  parts: TemplatePart[];
  steps: DraftStep[];
  resources: DraftResource[];
  terms: DraftTerm[];
  basis?: DraftBasis;
}

// ---- making a draft -------------------------------------------------------------------

/** A new guide from a method's steps, under the organization's name and license. */
export function newDraft(c: { method: Method; orgName: string; license: string; language?: string }): GuideDraft {
  return {
    v: 1, title: '', language: c.language ?? 'eng', pattern: c.method.pattern, about: '', source: c.orgName,
    license: c.license, credit: c.orgName ? `© ${c.orgName}` : '', ref: '', versification: null, parts: [],
    steps: c.method.steps.map((s) => ({ ...s, text: '' })), resources: [], terms: []
  };
}

const urlRef = (url: string | undefined, seconds?: number): MediaRef | undefined =>
  url ? { url, ...(seconds !== undefined ? { seconds } : {}) } : undefined;

/** FIA states its license in its source line (scripts/fia-adapter.ts FIA_ATTRIBUTION); study@2 says it outright. */
function licenseOfSource(doc: StudyDoc | StudyDoc2): string | undefined {
  if (doc.format === 'study@2' && doc.license) return doc.license;
  return /CC BY-SA 4\.0/.test(doc.source) ? 'CC-BY-SA-4.0' : undefined;
}

/** "© 2025 Word Collective, CC BY-SA 4.0": FIA's credit is the part of its source line after the site and language. */
function creditOfSource(doc: StudyDoc | StudyDoc2): string {
  if (doc.format === 'study@2' && doc.credit) return doc.credit;
  const parts = doc.source.split(' · ');
  return parts.find((p) => p.startsWith('©')) ?? doc.source;
}

/**
 * A draft of an existing guide. Editing this organization's own keeps
 * everything as it is. Adapting someone else's (`adapt`) keeps its credit
 * and, when its license is share-alike (FIA is CC BY-SA 4.0), its license,
 * which then cannot be changed; a license that forbids adapting is noted so
 * publishing can say why it may not.
 */
export function draftFromDoc(doc: StudyDoc | StudyDoc2, basis: { docHash: string; itemId?: string; adapt?: { orgName: string; license: string } }): GuideDraft {
  const resources: DraftResource[] = doc.format === 'study@2'
    ? doc.resources.filter((r) => r.kind !== 'term').map((r) => ({
      ref: r.ref, kind: r.kind as 'media' | 'map', title: r.title, description: r.description ?? '',
      media: (r.media ?? []).map((m) => ({ id: m.id, kind: m.kind, title: m.title, caption: m.caption, file: m.file }))
    }))
    : doc.resources.filter((r) => r.kind !== 'term').map((r) => ({
      ref: r.ref, kind: r.kind as 'media' | 'map', title: r.title, description: r.description ?? '',
      media: (r.media ?? []).map((m) => ({ id: m.id, kind: m.kind, title: m.title, caption: m.caption, file: urlRef(m.url) ?? {} }))
    }));
  const terms: DraftTerm[] = doc.terms.map((t) => {
    const audio = 'audio' in t ? t.audio : urlRef('audioUrl' in t ? t.audioUrl : undefined);
    return { id: t.id, term: t.term, hint: t.hint ?? '', body: t.body, ...(audio ? { audio } : {}) };
  });
  const steps: DraftStep[] = doc.steps.map((s) => {
    const audio = doc.format === 'study@2' ? s.audio : urlRef(s.audio?.url, s.audio?.seconds);
    return { id: s.id, title: s.title, phase: s.phase ?? '', purpose: s.purpose ?? '', text: s.text, ...(audio ? { audio } : {}) };
  });
  const parts = doc.format === 'study@2' ? (doc.links ?? []).flatMap((l) => ('node' in l ? [{ template: l.template, node: l.node }] : [])) : [];
  const verseLink = doc.format === 'study@2' ? (doc.links ?? []).find((l): l is { ref: string } => 'ref' in l)?.ref : undefined;
  const sourceLicense = licenseOfSource(doc);
  const base: GuideDraft = {
    v: 1, title: doc.title, language: doc.language, pattern: doc.pattern, about: doc.about, source: doc.source,
    license: sourceLicense ?? '', credit: creditOfSource(doc), ref: doc.ref ?? verseLink ?? '', versification: doc.versification ?? null,
    parts, steps, resources, terms, basis: { docHash: basis.docHash, ...(basis.itemId ? { itemId: basis.itemId } : {}) }
  };
  if (!basis.adapt) return base;
  const info = sourceLicense && isLicense(sourceLicense) ? LICENSE_INFO[sourceLicense] : null;
  const shareAlike = info?.terms.shareAlike ? sourceLicense : undefined;
  const noAdapt = info && !info.terms.mayAdapt ? sourceLicense : undefined;
  return {
    ...base,
    source: `${basis.adapt.orgName} · adapted from ${doc.source}`,
    license: shareAlike ?? basis.adapt.license,
    credit: `${creditOfSource(doc)}; adapted by ${basis.adapt.orgName}`,
    basis: { docHash: basis.docHash, adapted: true, ...(shareAlike ? { shareAlike } : {}), ...(noAdapt ? { noAdapt } : {}) }
  };
}

// ---- ids --------------------------------------------------------------------------------

/** The next free id with this prefix: `s4`, `m2`, `c1`, `t3`. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Every ref a step may link to: pictures, maps and glossary terms. */
export function draftRefs(d: GuideDraft): string[] {
  return [...d.resources.map((r) => r.ref), ...d.terms.map((t) => t.id)];
}

// ---- actions ------------------------------------------------------------------------------

type Fields = Pick<GuideDraft, 'title' | 'language' | 'pattern' | 'about' | 'source' | 'license' | 'credit' | 'ref' | 'versification' | 'parts'>;

export type DraftAction =
  | { type: 'set'; patch: Partial<Fields> }
  | { type: 'useMethod'; method: Method }
  | { type: 'addStep'; after?: string }
  | { type: 'updateStep'; id: string; patch: Partial<Omit<DraftStep, 'id' | 'audio'>> }
  | { type: 'setStepAudio'; id: string; audio: MediaRef | null }
  | { type: 'moveStep'; id: string; by: -1 | 1 }
  | { type: 'deleteStep'; id: string }
  /** A new set of pictures or a map, with its first picture when one was just picked. */
  | { type: 'addResource'; kind: 'media' | 'map'; title?: string; media?: Omit<DraftMedia, 'id'> }
  | { type: 'updateResource'; ref: string; patch: Partial<Pick<DraftResource, 'title' | 'description'>> }
  | { type: 'deleteResource'; ref: string }
  | { type: 'addMedia'; ref: string; media: Omit<DraftMedia, 'id'> }
  | { type: 'updateMedia'; ref: string; id: string; patch: Partial<Omit<DraftMedia, 'id'>> }
  | { type: 'deleteMedia'; ref: string; id: string }
  | { type: 'addTerm'; term?: string }
  | { type: 'updateTerm'; id: string; patch: Partial<Omit<DraftTerm, 'id' | 'audio'>> }
  | { type: 'setTermAudio'; id: string; audio: MediaRef | null }
  | { type: 'deleteTerm'; id: string };

const withoutAudio = <T extends { audio?: MediaRef }>(x: T, audio: MediaRef | null): T => {
  const { audio: _old, ...rest } = x;
  return (audio ? { ...rest, audio } : rest) as T;
};

/** Every change the editor makes. Unknown ids leave the draft as it was. */
export function draftReducer(d: GuideDraft, a: DraftAction): GuideDraft {
  switch (a.type) {
    case 'set': {
      // A share-alike source's license stays (FIA's CC BY-SA carries over).
      const patch = d.basis?.shareAlike && a.patch.license !== undefined ? { ...a.patch, license: d.basis.shareAlike } : a.patch;
      return { ...d, ...patch };
    }
    case 'useMethod':
      return { ...d, pattern: a.method.pattern || d.pattern, steps: a.method.steps.map((s) => ({ ...s, text: '' })) };
    case 'addStep': {
      const id = nextId('s', d.steps.map((s) => s.id));
      const at = a.after ? d.steps.findIndex((s) => s.id === a.after) + 1 : d.steps.length;
      const prev = d.steps[at - 1];
      const step: DraftStep = { id, title: `Step ${d.steps.length + 1}`, phase: prev?.phase ?? '', purpose: '', text: '' };
      const steps = [...d.steps];
      steps.splice(at <= 0 ? d.steps.length : at, 0, step);
      return { ...d, steps };
    }
    case 'updateStep':
      return { ...d, steps: d.steps.map((s) => (s.id === a.id ? { ...s, ...a.patch } : s)) };
    case 'setStepAudio':
      return { ...d, steps: d.steps.map((s) => (s.id === a.id ? withoutAudio(s, a.audio) : s)) };
    case 'moveStep': {
      const i = d.steps.findIndex((s) => s.id === a.id);
      const j = i + a.by;
      if (i < 0 || j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...d, steps };
    }
    case 'deleteStep':
      return { ...d, steps: d.steps.filter((s) => s.id !== a.id) };
    case 'addResource': {
      const ref = nextId(a.kind === 'map' ? 'c' : 'm', draftRefs(d));
      const media = a.media ? [{ ...a.media, id: `${ref}-1` }] : [];
      return { ...d, resources: [...d.resources, { ref, kind: a.kind, title: a.title ?? a.media?.title ?? '', description: '', media }] };
    }
    case 'updateResource':
      return { ...d, resources: d.resources.map((r) => (r.ref === a.ref ? { ...r, ...a.patch } : r)) };
    case 'deleteResource':
      return { ...d, resources: d.resources.filter((r) => r.ref !== a.ref) };
    case 'addMedia':
      return {
        ...d,
        resources: d.resources.map((r) => (r.ref === a.ref
          ? { ...r, title: r.title || a.media.title, media: [...r.media, { ...a.media, id: nextId(`${r.ref}-`, r.media.map((m) => m.id)) }] }
          : r))
      };
    case 'updateMedia':
      return { ...d, resources: d.resources.map((r) => (r.ref === a.ref ? { ...r, media: r.media.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) } : r)) };
    case 'deleteMedia':
      return { ...d, resources: d.resources.map((r) => (r.ref === a.ref ? { ...r, media: r.media.filter((m) => m.id !== a.id) } : r)) };
    case 'addTerm': {
      const id = nextId('t', draftRefs(d));
      return { ...d, terms: [...d.terms, { id, term: a.term ?? '', hint: '', body: '' }] };
    }
    case 'updateTerm':
      return { ...d, terms: d.terms.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case 'setTermAudio':
      return { ...d, terms: d.terms.map((t) => (t.id === a.id ? withoutAudio(t, a.audio) : t)) };
    case 'deleteTerm':
      return { ...d, terms: d.terms.filter((t) => t.id !== a.id) };
  }
}

// ---- the document -------------------------------------------------------------------------

/** A media reference as the document keeps it: only the fields that say something. */
function cleanMedia(m: MediaRef | undefined): MediaRef | undefined {
  if (!m || (!m.url && !m.hash)) return undefined;
  return {
    ...(m.url ? { url: m.url } : {}), ...(m.hash ? { hash: m.hash } : {}), ...(m.lowHash ? { lowHash: m.lowHash } : {}),
    ...(m.format ? { format: m.format } : {}), ...(m.seconds !== undefined ? { seconds: Math.round(m.seconds) } : {})
  };
}

/** Every blob (by hash) the draft's document names, with its kind: what must be uploaded before it is published. */
export function draftFiles(d: GuideDraft): { hash: string; format?: string; kind: 'audio' | 'image' | 'video'; low: boolean }[] {
  const out: { hash: string; format?: string; kind: 'audio' | 'image' | 'video'; low: boolean }[] = [];
  const add = (m: MediaRef | undefined, kind: 'audio' | 'image' | 'video') => {
    if (m?.hash) out.push({ hash: m.hash, ...(m.format ? { format: m.format } : {}), kind, low: false });
    if (m?.lowHash) out.push({ hash: m.lowHash, kind, low: true });
  };
  for (const s of d.steps) add(s.audio, 'audio');
  for (const r of d.resources) for (const m of r.media) add(m.file, m.kind === 'video' ? 'video' : 'image');
  for (const t of d.terms) add(t.audio, 'audio');
  return out;
}

/** The `study@2` document the draft publishes as, its `deps` set. */
export function buildDoc(d: GuideDraft): StudyDoc2 {
  const ref = d.ref.trim();
  const links: MaterialLink[] = d.parts.map((p) => ({ template: p.template, node: p.node }));
  return withDeps<StudyDoc2>({
    format: 'study@2',
    title: d.title.trim(),
    pattern: d.pattern.trim(),
    about: d.about.trim(),
    source: d.source.trim(),
    language: d.language.trim() || 'eng',
    ...(ref ? { ref } : {}),
    ...(ref && d.versification ? { versification: d.versification } : {}),
    ...(links.length ? { links } : {}),
    ...(d.license ? { license: d.license } : {}),
    ...(d.credit.trim() ? { credit: d.credit.trim() } : {}),
    steps: d.steps.map((s) => {
      const audio = cleanMedia(s.audio);
      return {
        id: s.id, title: s.title.trim(), ...(s.phase.trim() ? { phase: s.phase.trim() } : {}),
        ...(s.purpose.trim() ? { purpose: s.purpose.trim() } : {}), text: s.text.trim(), ...(audio ? { audio } : {})
      };
    }),
    resources: [
      ...d.resources.map((r) => ({
        ref: r.ref, kind: r.kind, title: r.title.trim() || r.media[0]?.title.trim() || (r.kind === 'map' ? 'Map' : 'Pictures'),
        ...(r.description.trim() ? { description: r.description.trim() } : {}),
        media: r.media.flatMap((m) => {
          const file = cleanMedia(m.file);
          return file ? [{ id: m.id, kind: m.kind, title: m.title.trim() || r.title.trim(), caption: m.caption.trim(), file }] : [];
        })
      })),
      // Each glossary entry is also a resource, so a link to it (`#t1`) opens it, as FIA's do.
      ...d.terms.map((t) => ({ ref: t.id, kind: 'term' as const, title: t.term.trim(), ...(t.hint.trim() ? { description: t.hint.trim() } : {}) }))
    ],
    terms: d.terms.map((t) => {
      const audio = cleanMedia(t.audio);
      return { id: t.id, term: t.term.trim(), ...(t.hint.trim() ? { hint: t.hint.trim() } : {}), body: t.body.trim(), ...(audio ? { audio } : {}) };
    }),
    deps: []
  });
}

// ---- what stops publishing ------------------------------------------------------------------

export type DraftPanel = 'details' | 'steps' | 'media' | 'glossary';

export interface DraftProblem {
  panel: DraftPanel;
  /** The step, resource or term it is about. */
  id?: string;
  text: string;
}

/** core validateDoc's reasons, in the words the editor uses. */
function plainDocProblem(reason: string): DraftProblem {
  if (/title/.test(reason)) return { panel: 'details', text: 'Give the guide a title.' };
  if (/ref or links|ref needs|links are/.test(reason)) return { panel: 'details', text: 'Say where the guide applies: verses with their numbering, or a part of a template.' };
  if (/steps/.test(reason)) return { panel: 'steps', text: 'Every step needs a title. Step audio must be a recording or a file.' };
  if (/media|resources/.test(reason)) return { panel: 'media', text: 'Every picture, map and film needs a file.' };
  if (/terms/.test(reason)) return { panel: 'glossary', text: 'Every glossary entry needs its term.' };
  if (/deps/.test(reason)) return { panel: 'details', text: 'The verse numbering is missing. Choose it again.' };
  return { panel: 'details', text: `This guide can't be published yet (${reason}).` };
}

/**
 * Everything that stops the draft being published, in plain words, each
 * pointing at the panel (and step, picture or term) to fix. Empty when it
 * can be published. Ends with core's own check of the document, so nothing
 * the server would refuse gets through.
 */
export function draftProblems(d: GuideDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (d.basis?.noAdapt) {
    out.push({ panel: 'details', text: `Its license (${isLicense(d.basis.noAdapt) ? LICENSE_INFO[d.basis.noAdapt].name : d.basis.noAdapt}) doesn't allow changes. Ask whoever made it.` });
  }
  if (!d.title.trim()) out.push({ panel: 'details', text: 'Give the guide a title.' });
  const ref = d.ref.trim();
  if (!ref && d.parts.length === 0) out.push({ panel: 'details', text: 'Say where the guide applies: a verse range, or a part of a template.' });
  if (ref && !parseRef(ref)) out.push({ panel: 'details', text: `Can't read “${ref}”. Write it like LUK 15:11-32.` });
  if (ref && parseRef(ref) && !isHash(d.versification)) out.push({ panel: 'details', text: 'Choose how the verses are numbered.' });
  if (d.steps.length === 0) out.push({ panel: 'steps', text: 'Add at least one step.' });
  const refs = new Set(draftRefs(d));
  d.steps.forEach((s, i) => {
    const name = s.title.trim() ? `“${s.title.trim()}”` : `Step ${i + 1}`;
    if (!s.title.trim()) out.push({ panel: 'steps', id: s.id, text: `Step ${i + 1} needs a title.` });
    const missing = [...new Set(inlineParts(s.text).flatMap((p) => (p.type === 'link' && !refs.has(p.ref) ? [p.ref] : [])))];
    if (missing.length) out.push({ panel: 'steps', id: s.id, text: `${name} links to ${missing.map((m) => `#${m}`).join(', ')}, which isn't in the media or glossary.` });
  });
  for (const r of d.resources) {
    const name = r.title.trim() || (r.kind === 'map' ? 'A map' : 'A set of pictures');
    if (r.media.length === 0) out.push({ panel: 'media', id: r.ref, text: `${name} has no picture yet.` });
    for (const m of r.media) if (!cleanMedia(m.file)) out.push({ panel: 'media', id: r.ref, text: `“${m.title || name}” has no file.` });
  }
  d.terms.forEach((t, i) => {
    if (!t.term.trim()) out.push({ panel: 'glossary', id: t.id, text: `Glossary entry ${i + 1} needs its term.` });
  });
  if (out.length) return out;
  const reason = validateDoc(buildDoc(d));
  return reason ? [plainDocProblem(reason)] : [];
}

// ---- the text toolbar ------------------------------------------------------------------------

export interface Selection { start: number; end: number }
export interface Edited { text: string; selection: Selection }

const clampSel = (text: string, s: Selection): Selection => {
  const start = Math.max(0, Math.min(s.start, text.length));
  return { start, end: Math.max(start, Math.min(s.end, text.length)) };
};

/** Bold the selection (`**…**`), or put an empty pair at the cursor to type into. */
export function boldText(text: string, sel: Selection): Edited {
  const s = clampSel(text, sel);
  const inner = text.slice(s.start, s.end);
  const out = `${text.slice(0, s.start)}**${inner}**${text.slice(s.end)}`;
  return { text: out, selection: inner ? { start: s.start, end: s.end + 4 } : { start: s.start + 2, end: s.start + 2 } };
}

/** The whole lines a selection touches. */
function lineSpan(text: string, s: Selection): Selection {
  const start = text.lastIndexOf('\n', Math.max(0, s.start - 1)) + 1;
  const nl = text.indexOf('\n', s.end);
  return { start: s.start === 0 ? 0 : start, end: nl < 0 ? text.length : nl };
}

/** Make the selected lines a list (`- `), or take the marks off when they all have them. */
export function listText(text: string, sel: Selection): Edited {
  const s = clampSel(text, sel);
  const span = lineSpan(text, s);
  const lines = text.slice(span.start, span.end).split('\n');
  const all = lines.every((l) => /^[-*]\s/.test(l) || !l.trim());
  const changed = lines.map((l) => (all ? l.replace(/^[-*]\s/, '') : l.trim() ? `- ${l.replace(/^[-*]\s/, '')}` : l)).join('\n');
  const out = text.slice(0, span.start) + changed + text.slice(span.end);
  return { text: out, selection: { start: span.start, end: span.start + changed.length } };
}

/** A blank line around a block, so it stands on its own in the markdown. */
function asBlock(text: string, at: Selection, block: string): Edited {
  const before = text.slice(0, at.start);
  const after = text.slice(at.end).replace(/^[ \t]+/, '');
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const start = before.length + lead.length;
  return { text: before + lead + block + tail + after, selection: { start, end: start + block.length } };
}

/** Words a new callout starts with, so the writer sees what kind it is. */
export const CALLOUT_PROMPT: Record<CalloutKind, string> = {
  action: 'Stop here and discuss as a group.',
  note: 'Something to keep in mind.',
  question: 'A question for the group?',
  culture: 'What people did or believed then.',
  warning: 'Something easy to get wrong.'
};

/** Turn the selection into a callout of a kind (`> [!kind] …`), or add one with a prompt to write over. */
export function calloutText(text: string, sel: Selection, kind: CalloutKind): Edited {
  if (!(CALLOUT_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown callout kind ${kind}`);
  const s = clampSel(text, sel);
  const inner = text.slice(s.start, s.end).replace(/\s*\n\s*/g, ' ').trim() || CALLOUT_PROMPT[kind];
  const marker = `> [!${kind}] `;
  const r = asBlock(text, s, `${marker}${inner}`);
  // Select the words, not the marker, so typing replaces them.
  return { text: r.text, selection: { start: r.selection.start + marker.length, end: r.selection.end } };
}

/** Link the selection (or the thing's title) to a picture, map or term by its ref: `[label](#m1)`. */
export function linkText(text: string, sel: Selection, ref: string, title: string): Edited {
  const s = clampSel(text, sel);
  const label = text.slice(s.start, s.end).trim() || title.trim() || ref;
  const link = `[${label}](#${ref})`;
  const out = text.slice(0, s.start) + link + text.slice(s.end);
  return { text: out, selection: { start: s.start + link.length, end: s.start + link.length } };
}
