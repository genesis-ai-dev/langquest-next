// Earlier sections (decision 80, docs/breaking-up-the-bible.md): when a way
// of dividing changes, a book is divided again or the numbering changes,
// the old sections expire but their work is kept. A current section that
// overlaps an expired one holding recordings shows a warning mark, and its
// page lists the expired sections, closed by default.
import {
  earlierSections, isTemplateDoc, templateUnits, unitPrefixOf, unitTitle,
  type LanguageState, type VersificationDoc
} from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { currentLocale, t } from '../i18n';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { Disclosure, Group, Ico, Row, txt } from '../kit';
import { useLibraryDocs } from '../library/useLibrary';
import { C, space, TINT } from '../theme';

/** How an earlier section's numbering is named beside it (the seed's `short` names), in the language showing. */
function numberedLike(code: string): string | undefined {
  switch (code) {
    case 'eng': return t('breakup.earlier.numbered.eng');
    case 'org': return t('breakup.earlier.numbered.org');
    case 'vul': return t('breakup.earlier.numbered.vul');
    case 'rsc':
    case 'rso': return t('breakup.earlier.numbered.russian');
    default: return undefined;
  }
}

export interface Earlier {
  /** Current section -> the expired sections with work that overlap it. */
  over: Map<string, string[]>;
  /** An expired section -> how it was numbered, when that is not how the language numbers now. */
  numbered: Map<string, string>;
}

export function useEarlierSections(ctx: Ctx, state: LanguageState | null): Earlier {
  const history = state?.templateHistory ?? {};
  const current = state?.template?.value;
  const hashes = [...Object.keys(history), current?.docHash];
  const docs = useLibraryDocs(ctx.language.orgId, hashes);
  return useMemo(() => {
    const out: Earlier = { over: new Map(), numbered: new Map() };
    if (!state || !current) return out;
    const idx = indexesFor(state);
    const now = new Set(idx.passages);
    const worked = new Set([...Object.values(state.recordings).map((r) => r.unitId), ...Object.values(state.takes).map((take) => take.unitId)]);
    const expired = [...worked].filter((u) => !now.has(u) && state.units[u] && unitPrefixOf(u) !== null && !idx.containers.includes(u));
    if (expired.length === 0) return out;
    const want = new Set(expired);
    // The numbering each expired section was made in: the earliest template version that had it.
    const madeIn = new Map<string, VersificationDoc>();
    const versions = Object.entries(history).sort(([, a], [, b]) => (a.hlc < b.hlc ? -1 : 1));
    for (const [hash, h] of versions) {
      const d = docs.get(hash);
      if (!d || !isTemplateDoc(d) || !d.bible) continue;
      const v = docs.get<VersificationDoc>(d.bible.versification);
      if (!v) continue;
      for (const u of templateUnits(d, h.unitPrefix, v)) if (want.has(u.unitId) && !madeIn.has(u.unitId)) madeIn.set(u.unitId, v);
    }
    const doc = docs.get(current.docHash);
    const numbering = doc && isTemplateDoc(doc) && doc.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
    for (const [u, v] of madeIn) if (numbering && v.code !== numbering.code) out.numbered.set(u, numberedLike(v.code) ?? v.name);
    out.over = earlierSections({ current: idx.passages, expired, currentNumbering: numbering, numberingOf: (u) => madeIn.get(u) ?? null });
    return out;
    // docs.get changes when documents arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, current, docs.get]);
}

/** A section the language no longer has: a library part outside the current divisions. */
export function isEarlierSection(state: LanguageState | null, unitId: string): boolean {
  if (!state || !state.units[unitId] || unitPrefixOf(unitId) === null) return false;
  const idx = indexesFor(state);
  return !idx.passages.includes(unitId) && !idx.containers.includes(unitId);
}

/** At the top of an earlier section's page: what it is, and the sections its verses are in now. */
export function EarlierNote(props: { ctx: Ctx; unitId: string; languageId: string }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const found = useEarlierSections(ctx, state);
  if (!state || !isEarlierSection(state, props.unitId)) return null;
  const now = [...found.over].filter(([, olds]) => olds.includes(props.unitId)).map(([u]) => u);
  const how = found.numbered.get(props.unitId);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="flag" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.amberText }]}>
          {how
            ? t('breakup.earlier.noteHow', { how: `${how.charAt(0).toLocaleLowerCase(currentLocale())}${how.slice(1)}`, count: now.length })
            : t('breakup.earlier.note', { count: now.length })}
        </Text>
      </View>
      {now.length ? (
        <Group>
          {now.map((u, i) => (
            <Row key={u} icon="right" label={unitTitle(state, u)} sub={t('breakup.earlier.whereNow')} last={i === now.length - 1} onPress={() => ctx.openPassage(u, props.languageId)} />
          ))}
        </Group>
      ) : null}
    </View>
  );
}

/** The warning mark on a section whose divisions changed since work was recorded on it. */
export function ChangedMark() {
  return (
    <View accessibilityLabel={t('breakup.earlier.changedMark')} style={{ position: 'absolute', bottom: -4, left: -4 }}>
      <Ico name="flag" size={14} color={TINT.amberText} />
    </View>
  );
}

/** On a section's page: what was recorded on sections that have since expired, closed by default. */
export function EarlierSections(props: { ctx: Ctx; unitId: string; languageId: string }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const found = useEarlierSections(ctx, state);
  const earlier = found.over.get(props.unitId) ?? [];
  const [open, setOpen] = useState(false);
  if (!state || earlier.length === 0) return null;
  const versions = (u: string) => Object.values(state.takes).filter((take) => take.unitId === u && !take.archived).length;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="flag" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.amberText }]}>
          {t('breakup.earlier.changedHere')}
        </Text>
      </View>
      <Disclosure icon="history" title={t('breakup.earlier.title')} summary={earlier.map((u) => unitTitle(state, u)).join(t('admin.list.separator'))} open={open} onToggle={() => setOpen((o) => !o)}>
        {earlier.map((u, i) => {
          const n = versions(u);
          return (
            <Row key={u} icon="history" label={unitTitle(state, u)} sub={t('breakup.earlier.row', { how: found.numbered.get(u) ?? t('breakup.earlier.anEarlier'), versions: t('breakup.earlier.versions', { count: n }) })} last={i === earlier.length - 1}
              onPress={() => ctx.openPassage(u, props.languageId)} />
          );
        })}
        <Text style={[txt.xs, { color: C.muted }]}>{t('breakup.earlier.openOne')}</Text>
      </Disclosure>
    </View>
  );
}
