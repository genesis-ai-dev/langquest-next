import {
  approvedVersion, buildIndexes, cleanedFrom, decodeHlc, derivePassage, kindOf, languageInfo, languagePassages, languagePeople, languageReport, membershipsOf,
  orgName, passageWork, recordedCard, toCsv, unitPlace, unitTitle, voiceFormat,
  type LanguageState, type OrgState, type PassageState, type Version
} from '@langquest-next/core';

/**
 * The organization export (decisions.md 205, docs/org-export.md): everything
 * an organization holds, read from its folded streams and laid out so a
 * person can use it without the app. Pure: the server job folds the streams,
 * calls `planOrgExport`, then writes the text files and copies each audio
 * file by hash into the zip. Nothing here reads a file or the network.
 *
 * The folders and sheets are one reading of the log; the raw log (written by
 * the job) is the other, and the one another tool can rebuild from.
 */

export const EXPORT_FORMAT_VERSION = 1;

/** One language to export: its folded stream. */
export interface ExportLanguage { languageId: string; state: LanguageState }

export interface OrgExportInput {
  orgId: string;
  org: OrgState;
  languages: ExportLanguage[];
  /** A person's name as the server knows it; the id when it does not. */
  nameOf: (profileId: string) => string;
  /** When the export is made (ms). */
  now: number;
}

/** What a manifest row is a recording of. */
export type ManifestKind =
  | 'recording' | 'review_comment' | 'review_artifact' | 'response' | 'departure_reason' | 'note' | 'request_note' | 'term_note';

/** One audio file to copy into the zip, from the bucket's `<orgId>/<streamId>/<hash>.<ext>`. */
export interface AudioEntry { path: string; streamId: string; hash: string; ext: 'wav' | 'm4a' }

export interface ManifestRow {
  kind: ManifestKind;
  language: string;
  languageCode: string;
  languageId: string;
  book: string;
  chapter: string;
  passage: string;
  unitId: string;
  /** Version number, 0 for what belongs to the passage and no version. */
  version: number;
  part: number | null;
  takeId: string;
  /** Verses a part was labelled with ("set" marks only), and the label kind: set, next, join or none. */
  verseFrom: string;
  verseTo: string;
  verseMark: string;
  by: string;
  byId: string;
  at: string;
  durationMs: number | null;
  hash: string;
  format: string;
  size: number | null;
  /** The log holds the file as stored on the server. */
  stored: boolean;
  /** The version is the passage's newest (the current take). */
  current: boolean;
  /** Every step cleared on this version (`approvedVersion`). */
  approved: boolean;
  /** Review kinds whose latest check of this version looks good, `;` apart. */
  reviewsPassed: string;
  /** Review outcome, for a review row. */
  outcome: string;
  /** The text with the recording: a comment, note or reason. */
  text: string;
  /** Where in the zip the file is; empty when the file has none (a part reused from an earlier version points at the first copy). */
  file: string;
}

export interface TextEntry { path: string; content: string }

export interface OrgExportPlan {
  texts: TextEntry[];
  audio: AudioEntry[];
  manifest: ManifestRow[];
  /** Counts the job logs and the README states. */
  counts: { languages: number; passages: number; rows: number; files: number };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOf = (hlc: string): string => iso(decodeHlc(hlc).wallMs);
const month = (hlc: string): string => isoOf(hlc).slice(0, 7);

/** A name safe as one path part in any zip tool: no separators, no control characters, bounded. */
export function safeName(name: string, fallback = 'unnamed'): string {
  const s = name
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, 60)
    .trim();
  return s || fallback;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Per-language reading of who recorded each part, from the first recording that holds it. */
function recorders(state: LanguageState): Map<string, { by: string; hlc: string }> {
  const out = new Map<string, { by: string; hlc: string }>();
  for (const r of Object.values(state.recordings)) {
    if (r.kind !== 'target') continue;
    for (const c of r.cards) if (!out.has(c.hash)) out.set(c.hash, { by: r.actorId, hlc: r.hlc });
  }
  return out;
}

const REVIEW_LOOKS_GOOD = 'looks_good';

function reviewsPassed(state: LanguageState, ps: PassageState, v: Version): string[] {
  const latest = new Map<string, string>();
  for (const r of ps.reviews) if (r.takeId === v.takeId) latest.set(r.kindId, r.outcome);
  return [...latest].filter(([, o]) => o === REVIEW_LOOKS_GOOD).map(([k]) => kindOf(state, k).name);
}

/** Plan the whole export. Deterministic for the same input. */
export function planOrgExport(input: OrgExportInput): OrgExportPlan {
  const { org, nameOf } = input;
  const manifest: ManifestRow[] = [];
  const audio: AudioEntry[] = [];
  const usedPaths = new Set<string>();
  const unique = (path: string): string => {
    if (!usedPaths.has(path.toLowerCase())) { usedPaths.add(path.toLowerCase()); return path; }
    const dot = path.lastIndexOf('.');
    for (let i = 2; ; i += 1) {
      const next = `${path.slice(0, dot)} (${i})${path.slice(dot)}`;
      if (!usedPaths.has(next.toLowerCase())) { usedPaths.add(next.toLowerCase()); return next; }
    }
  };

  const languages = [...input.languages].sort((a, b) => a.languageId.localeCompare(b.languageId));
  const languageSheet: (string | number | null)[][] = [[
    'language', 'code', 'country', 'passages', 'recorded', 'in_review', 'feedback', 'done', 'recorded_share_pct', 'done_share_pct',
    'bible_verses_recorded_pct', 'bible_verses_done_pct', 'recordings_on_server', 'last_activity', 'review_flow'
  ]];
  const bookSheet: (string | number | null)[][] = [['language', 'book', 'passages', 'recorded', 'done', 'recorded_share_pct', 'done_share_pct']];
  const ledgerSheet: (string | number | null)[][] = [[
    'language', 'book', 'chapter', 'passage', 'state', 'versions', 'parts_in_current', 'duration_ms_current', 'reviews', 'first_published', 'last_published', 'approved_version'
  ]];
  const passageSheet: (string | number | null)[][] = [[
    'language', 'book', 'chapter', 'passage', 'unit_id', 'state', 'current_version', 'approved_version', 'current_take', 'current_parts_in_order'
  ]];
  const reviewSheet: (string | number | null)[][] = [['language', 'passage', 'version', 'kind', 'outcome', 'via', 'by', 'at', 'comment', 'comment_audio']];
  const noteSheet: (string | number | null)[][] = [['language', 'passage', 'anchor', 'version', 'text', 'by', 'at', 'audio']];
  const termSheet: (string | number | null)[][] = [['language', 'term', 'gloss', 'renderings', 'passages', 'linked_versions', 'adjustments']];

  type Tally = { versions: number; parts: number; ms: number; reviews: number };
  const personTally = new Map<string, Tally & { first: string; last: string }>();
  const monthTally = new Map<string, Tally>();
  const bump = (languageId: string, who: string, hlc: string, d: Partial<Tally>) => {
    const m = month(hlc);
    const at = isoOf(hlc);
    const p = personTally.get(who) ?? { versions: 0, parts: 0, ms: 0, reviews: 0, first: at, last: at };
    const k = `${m}\t${languageId}\t${who}`;
    const t = monthTally.get(k) ?? { versions: 0, parts: 0, ms: 0, reviews: 0 };
    for (const key of ['versions', 'parts', 'ms', 'reviews'] as const) { p[key] += d[key] ?? 0; t[key] += d[key] ?? 0; }
    if (at < p.first) p.first = at;
    if (at > p.last) p.last = at;
    personTally.set(who, p);
    monthTally.set(k, t);
  };

  let passageCount = 0;
  for (const { languageId, state } of languages) {
    const info = languageInfo(org, languageId) ?? { languageId, name: languageId, code: '', languoidId: null, sourceCode: '', country: null, target: null };
    const langDir = safeName(`${info.name}${info.code ? ` (${info.code})` : ''}`, languageId);
    const idx = buildIndexes(state);
    const who = recorders(state);
    const report = languageReport(state, info, input.now, idx);
    const pct = (n: number, t: number) => (t === 0 ? 0 : Math.round((1000 * n) / t) / 10);
    languageSheet.push([
      info.name, info.code, info.country, report.progress.total, report.progress.recorded, report.work.in_review, report.work.feedback, report.work.done,
      pct(report.progress.recorded, report.progress.total), pct(report.progress.done, report.progress.total),
      report.coverage.recorded.bible, report.coverage.done.bible, report.uploads.cards, report.lastActivity, report.flowName
    ]);
    for (const b of report.books) bookSheet.push([info.name, b.label, b.total, b.recorded, b.done, pct(b.recorded, b.total), pct(b.done, b.total)]);

    const firstPath = new Map<string, string>();
    const units = languagePassages(state, idx);
    const seenFile = (hash: string) => firstPath.get(hash);
    const addAudio = (path: string, hash: string, ext: 'wav' | 'm4a'): string => {
      const p = unique(path);
      audio.push({ path: p, streamId: languageId, hash, ext });
      firstPath.set(hash, p);
      return p;
    };
    const blobOf = (hash: string) => {
      const b = state.blobs[hash];
      return { size: b?.stored ? b.size : null, stored: b?.stored === true };
    };

    for (const unitId of units) {
      passageCount += 1;
      const ps = derivePassage(state, unitId, idx);
      const place = unitPlace(state, unitId);
      const passage = unitTitle(state, unitId);
      const book = `${pad2(place.canon === 999 ? 99 : place.canon + 1)} ${safeName(place.bookLabel, 'Other')}`;
      const first = place.chapters[0];
      const last = place.chapters[place.chapters.length - 1];
      const chapter = first === undefined ? 'Other' : first === last ? `Chapter ${pad2(first)}` : `Chapters ${pad2(first)}-${pad2(last!)}`;
      const dir = `${langDir}/${book}/${chapter}/${safeName(passage, unitId)}`;
      const approved = approvedVersion(ps);
      const row = (r: Partial<ManifestRow> & Pick<ManifestRow, 'kind' | 'hash' | 'by' | 'at'>): ManifestRow => ({
        language: info.name, languageCode: info.code, languageId, book: place.bookLabel, chapter, passage, unitId,
        version: 0, part: null, takeId: '', verseFrom: '', verseTo: '', verseMark: '', byId: '', durationMs: null,
        format: '', size: null, stored: false, current: false, approved: false, reviewsPassed: '', outcome: '', text: '', file: '',
        ...r
      });
      const extra = (kind: ManifestKind, hash: string, byId: string, hlc: string, label: string, r: Partial<ManifestRow>): void => {
        const format = voiceFormat(state, hash);
        const date = isoOf(hlc).slice(0, 10);
        const known = seenFile(hash);
        const file = known ?? addAudio(`${dir}/${safeName(`${label} - ${nameOf(byId)} - ${date} - ${hash.slice(0, 8)}`)}.${format}`, hash, format);
        manifest.push(row({ kind, hash, by: nameOf(byId), byId, at: isoOf(hlc), format, file, ...blobOf(hash), ...r }));
      };

      for (const v of ps.versions) {
        const isCurrent = ps.latest?.takeId === v.takeId;
        const isApproved = approved?.takeId === v.takeId;
        const passed = reviewsPassed(state, ps, v).join('; ');
        bump(languageId, v.by, v.hlc, { versions: 1 });
        const marks = state.cardVerses?.[unitId] ?? {};
        v.cardHashes.forEach((hash, i) => {
          const card = recordedCard(state, hash);
          const origin = cleanedFrom(state, hash)?.hash ?? hash;
          const rec = who.get(origin) ?? who.get(hash) ?? { by: v.by, hlc: v.hlc };
          const format = card?.format ?? 'wav';
          const mark = marks[origin]?.value ?? marks[hash]?.value;
          const known = seenFile(hash);
          const file = known ?? addAudio(`${dir}/${safeName(`${passage} - v${v.n} part ${pad2(i + 1)} - ${nameOf(rec.by)} - ${isoOf(rec.hlc).slice(0, 10)} - ${hash.slice(0, 8)}`)}.${format}`, hash, format);
          bump(languageId, rec.by, rec.hlc, { parts: 1, ms: card?.durationMs ?? 0 });
          manifest.push(row({
            kind: 'recording', version: v.n, part: i + 1, takeId: v.takeId, hash, by: nameOf(rec.by), byId: rec.by, at: isoOf(rec.hlc),
            verseMark: mark?.mark ?? 'none', verseFrom: mark?.mark === 'set' ? mark.from ?? '' : '', verseTo: mark?.mark === 'set' ? mark.to ?? '' : '',
            durationMs: card?.durationMs ?? null, format, file, current: isCurrent, approved: isApproved, reviewsPassed: passed, ...blobOf(hash)
          }));
        });
        if (v.changeBlobHash) extra('response', v.changeBlobHash, v.by, v.hlc, `${passage} - v${v.n} what changed`, { version: v.n, takeId: v.takeId, text: v.changeNote ?? '' });
      }

      for (const r of ps.reviews) {
        const kind = kindOf(state, r.kindId).name;
        bump(languageId, r.by, r.hlc, { reviews: 1 });
        reviewSheet.push([info.name, passage, r.versionN, kind, r.outcome, r.via, nameOf(r.by), isoOf(r.hlc), r.comment ?? '', r.commentBlobHash ?? '']);
        const base = { version: r.versionN, takeId: r.takeId, outcome: r.outcome, text: r.comment ?? '' };
        if (r.commentBlobHash) extra('review_comment', r.commentBlobHash, r.by, r.hlc, `${passage} - v${r.versionN} review ${kind}`, base);
        for (const a of r.artifacts ?? []) extra('review_artifact', a.hash, r.by, r.hlc, `${passage} - v${r.versionN} review ${kind} note`, base);
      }
      for (const [takeId, resp] of Object.entries(state.responses)) {
        const v = ps.versions.find((x) => x.takeId === takeId);
        if (v && resp.blobHash && resp.blobHash !== v.changeBlobHash) extra('response', resp.blobHash, resp.actorId, resp.hlc, `${passage} - v${v.n} response`, { version: v.n, takeId, text: resp.note ?? '' });
      }
      for (const d of ps.departures) if (d.reasonBlobHash) extra('departure_reason', d.reasonBlobHash, d.by, d.hlc, `${passage} - ${d.type} reason`, { text: d.reason ?? '' });
      for (const q of ps.requests) if (q.noteBlobHash) extra('request_note', q.noteBlobHash, q.by, q.hlc, `${passage} - request`, { text: q.note ?? '' });
      for (const n of ps.notes) {
        const a = n.anchor;
        const version = a.kind === 'version' ? ps.versions.find((v) => v.takeId === a.takeId)?.n ?? 0 : 0;
        noteSheet.push([info.name, passage, a.kind, version || null, n.text ?? '', nameOf(n.by), isoOf(n.hlc), n.blobHash ?? '']);
        if (n.blobHash) extra('note', n.blobHash, n.by, n.hlc, `${passage} - note`, { version, text: n.text ?? '' });
      }

      const state_ = passageWork(ps);
      const all = [...ps.versions];
      ledgerSheet.push([
        info.name, place.bookLabel, chapter, passage, state_, all.length, ps.latest?.cardHashes.length ?? 0,
        (ps.latest?.cardHashes ?? []).reduce((s, h) => s + (recordedCard(state, h)?.durationMs ?? 0), 0), ps.reviews.length,
        all[0] ? isoOf(all[0].hlc) : null, ps.latest ? isoOf(ps.latest.hlc) : null, approved?.n ?? null
      ]);
      passageSheet.push([
        info.name, place.bookLabel, chapter, passage, unitId, state_, ps.latest?.n ?? null, approved?.n ?? null, ps.latest?.takeId ?? null,
        (ps.latest?.cardHashes ?? []).map((h) => h.slice(0, 8)).join('; ')
      ]);
    }

    for (const [termId, t] of Object.entries(state.keyTerms)) {
      const adj = Object.values(t.adjustments);
      const links = Object.keys(state.keyTermLinks).filter((take) => state.keyTermLinks[take]?.[termId]);
      termSheet.push([
        info.name, t.term, t.gloss, Object.values(t.renderings).map((r) => r.rendering).join('; '),
        t.unitScope.map((u) => unitTitle(state, u)).join('; '), links.length, adj.length
      ]);
      for (const a of adj) if (a.blobHash) {
        const format = voiceFormat(state, a.blobHash);
        const file = seenFile(a.blobHash) ?? addAudio(`${langDir}/Key terms/${safeName(`${t.term} - ${nameOf(a.actorId)} - ${isoOf(a.hlc).slice(0, 10)} - ${a.blobHash.slice(0, 8)}`)}.${format}`, a.blobHash, format);
        manifest.push({
          kind: 'term_note', language: info.name, languageCode: info.code, languageId, book: '', chapter: '', passage: t.term, unitId: '', version: 0, part: null,
          takeId: '', verseFrom: '', verseTo: '', verseMark: '', by: nameOf(a.actorId), byId: a.actorId, at: isoOf(a.hlc), durationMs: null,
          hash: a.blobHash, format, current: false, approved: false, reviewsPassed: '', outcome: '', text: a.note, file, ...blobOf(a.blobHash)
        });
        void termId;
      }
    }
  }

  // People: everyone with a role, the languages they work in, and what they did.
  const names = new Map<string, string>();
  const peopleSheet: (string | number | null)[][] = [[
    'person', 'person_id', 'roles', 'languages', 'versions_published', 'parts_recorded', 'recorded_ms', 'reviews_given', 'first_activity', 'last_activity'
  ]];
  const ids = new Set<string>([...Object.keys(org.members), ...personTally.keys()]);
  for (const id of [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b))) {
    names.set(id, nameOf(id));
    const roles = membershipsOf(org, id).map((m) => `${org.roles[m.roleId.value]?.name.value ?? m.roleId.value} (${m.scope.level === 'org' ? 'organization' : languageInfo(org, m.scope.languageId)?.name ?? m.scope.languageId})`);
    const langs = languages.filter((l) => languagePeople(org, l.languageId).has(id)).map((l) => languageInfo(org, l.languageId)?.name ?? l.languageId);
    const t = personTally.get(id);
    peopleSheet.push([nameOf(id), id, roles.join('; '), langs.join('; '), t?.versions ?? 0, t?.parts ?? 0, t?.ms ?? 0, t?.reviews ?? 0, t?.first ?? null, t?.last ?? null]);
  }
  const monthSheet: (string | number | null)[][] = [['month', 'language', 'person', 'person_id', 'versions_published', 'parts_recorded', 'recorded_ms', 'reviews_given']];
  const languageName = (id: string) => languageInfo(org, id)?.name ?? id;
  for (const k of [...monthTally.keys()].sort()) {
    const [m, l, p] = k.split('\t') as [string, string, string];
    const t = monthTally.get(k)!;
    monthSheet.push([m, languageName(l), nameOf(p), p, t.versions, t.parts, t.ms, t.reviews]);
  }

  const columns = Object.keys(manifest[0] ?? {}) as (keyof ManifestRow)[];
  const manifestHeader: (keyof ManifestRow)[] = columns.length ? columns : [
    'kind', 'language', 'languageCode', 'languageId', 'book', 'chapter', 'passage', 'unitId', 'version', 'part', 'takeId', 'verseFrom', 'verseTo', 'verseMark',
    'by', 'byId', 'at', 'durationMs', 'hash', 'format', 'size', 'stored', 'current', 'approved', 'reviewsPassed', 'outcome', 'text', 'file'
  ];
  manifest.sort((a, b) => a.languageId.localeCompare(b.languageId) || a.unitId.localeCompare(b.unitId) || a.version - b.version || (a.part ?? 0) - (b.part ?? 0) || a.kind.localeCompare(b.kind) || a.hash.localeCompare(b.hash));
  const manifestCsv = toCsv([
    manifestHeader as string[],
    ...manifest.map((r) => manifestHeader.map((c) => { const v = r[c]; return typeof v === 'boolean' ? (v ? 'yes' : 'no') : (v as string | number | null); }))
  ]);

  const orgTitle = orgName(org) ?? input.orgId;
  const texts: TextEntry[] = [
    { path: 'README.txt', content: readme(orgTitle, input, manifest.length, audio.length) },
    { path: 'manifest.csv', content: '﻿' + manifestCsv },
    { path: 'manifest.json', content: JSON.stringify({ format: EXPORT_FORMAT_VERSION, orgId: input.orgId, exportedAt: iso(input.now), rows: manifest }, null, 2) },
    { path: 'spreadsheets/languages.csv', content: '﻿' + toCsv(languageSheet) },
    { path: 'spreadsheets/books.csv', content: '﻿' + toCsv(bookSheet) },
    { path: 'spreadsheets/people.csv', content: '﻿' + toCsv(peopleSheet) },
    { path: 'spreadsheets/activity-by-month.csv', content: '﻿' + toCsv(monthSheet) },
    { path: 'spreadsheets/ledger-by-passage.csv', content: '﻿' + toCsv(ledgerSheet) },
    { path: 'metadata/passages.csv', content: '﻿' + toCsv(passageSheet) },
    { path: 'metadata/reviews.csv', content: '﻿' + toCsv(reviewSheet) },
    { path: 'metadata/notes.csv', content: '﻿' + toCsv(noteSheet) },
    { path: 'metadata/key-terms.csv', content: '﻿' + toCsv(termSheet) }
  ];
  return { texts, audio, manifest, counts: { languages: languages.length, passages: passageCount, rows: manifest.length, files: audio.length } };
}

function readme(org: string, input: OrgExportInput, rows: number, files: number): string {
  return [
    `LangQuest export of ${org}`,
    `Made ${iso(input.now)}. Format version ${EXPORT_FORMAT_VERSION}. ${input.languages.length} language(s), ${rows} manifest rows, ${files} audio files.`,
    '',
    'audio folders: <language>/<book>/<chapter>/<passage>/  One standard audio file per recorded part, plus the review comments, responses, notes and reasons recorded as audio, beside the version they belong to.',
    'manifest.csv, manifest.json: one row per audio file: who, when, how long, version, verses, which version is current and approved, and the reviews it passed. Open the CSV in Excel or Google Sheets.',
    'spreadsheets/: progress per language, per book, per person, per month, and a ledger by passage.',
    'metadata/: passages and their current version, reviews, notes, key terms.',
    'events/: the whole event log, one JSON object per line, one file per stream. It is the complete record; everything else is a reading of it.',
    '',
    'The format is documented in docs/org-export.md of the LangQuest repository.'
  ].join('\n') + '\n';
}
