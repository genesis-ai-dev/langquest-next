// Something made from a version (decisions.md 93; demo branch
// caleb-written-translations wMadeRead): a written copy, a back translation,
// a translation, or what LangQuest v2 brought over with no step. It stays
// with the version it came from and is never marked out of date. Written,
// it reads verse by verse, each verse playing from the recording it was
// written from; recorded, it plays. Nothing asks for a check unless a step
// in who checks reads it.
import { addedTo, madeVersionOf, type MadeView } from '@langquest-next/core';
import { View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { edgeFor } from '../flow';
import { edgeAllowed } from '../session';
import { t } from '../i18n';
import { AudioClip } from '../audioClip';
import { Card, EmptyState, Header, Ico, QuietLinks, Screen, txt } from '../kit';
import { passageCrumbs, usePassage, versionTitle, when, type PassageView } from '../passageView';
import { languageLabel } from '../simple/adminModel';
import { space, TINT } from '../theme';
import { usePassageVerses, WrittenReader } from './WrittenText';

/** What a made thing is called: its step's name, else what it is ("Written down", "In English"). */
export function madeTitle(v: Pick<PassageView, 'kind'>, m: Pick<MadeView, 'kindId' | 'medium' | 'language'>): string {
  if (m.kindId) return v.kind(m.kindId).name;
  if (m.language) return m.medium === 'writing' ? t('writing.made.writtenIn', { language: languageLabel(m.language) }) : t('writing.made.saidIn', { language: languageLabel(m.language) });
  return m.medium === 'writing' ? t('writing.made.writtenDown') : t('writing.made.recordedAgain');
}

export function MadeDetail(ctx: Ctx) {
  const v = usePassage(ctx);
  const madeId = ctx.params['madeId'] ?? '';
  const verseKeys = usePassageVerses(ctx, v?.unitId ?? '', v?.languageId ?? '');
  const m = v?.p.made.find((x) => x.id === madeId);
  if (!v || !m) {
    return (
      <Screen header={<Header title={t('writing.made.title')} onBack={ctx.back} />}>
        <EmptyState icon="book" title={v ? t('writing.made.gone') : t('passage.page.loadingLanguage')} />
      </Screen>
    );
  }
  const from = v.p.versions.find((x) => x.takeId === madeVersionOf(v.p, m));
  const title = madeTitle(v, m);
  // Added to its version (decision 93): part of it, and the latest of its kind there holds.
  const holds = m.added && from ? addedTo(v.p, from).find((a) => a.medium === m.medium) : undefined;
  const edge = edgeFor('made_detail', 'back_translation');
  const changeable = !!holds && holds.made.id === m.id && !!m.kindId && !!edge && edgeAllowed(edge, ctx.session);
  // A check that reads what this step made (v1.CheckLooksAtSet), to ask for it.
  const checker = m.kindId ? v.kinds.find((k) => k.looksAt === m.kindId && v.p.flow.steps.some((st) => st.kindIds.includes(k.id))) : undefined;
  const parts = m.parts.map((c) => c.hash);
  return (
    <Screen header={<Header title={v.title} sub={from ? t(m.added ? 'writing.made.addedTo' : 'writing.made.fromVersion', { what: title, version: versionTitle(from.n) }) : title}
      crumbs={passageCrumbs(ctx, v, title)} onBack={ctx.back} close />}
      footer={checker || changeable ? <QuietLinks items={[
        ...(changeable ? [{ label: m.medium === 'writing' ? t('writing.version.changeWords') : t('writing.version.changeRecording'), icon: (m.medium === 'writing' ? 'edit' : 'mic') as 'edit' | 'mic',
          onPress: () => ctx.go('back_translation', { unitId: v.unitId, languageId: v.languageId, kindId: m.kindId!, fromTakeId: from!.takeId }) }] : []),
        ...(checker ? [{ label: t('writing.made.askCheck', { check: checker.name }), icon: 'people' as const,
          onPress: () => ctx.go('ask_someone', { unitId: v.unitId, languageId: v.languageId, what: 'review', kindId: checker.id }) }] : [])
      ]} /> : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs }}>
        <Ico name={m.medium === 'writing' ? 'edit' : 'mic'} size={16} color={m.medium === 'writing' ? TINT.greenText : undefined} />
        <Text style={txt.smMuted}>{[ctx.name(m.by), when(m.hlc), m.language ? languageLabel(m.language) : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      {holds && holds.made.id !== m.id ? <Text style={[txt.sm, { paddingHorizontal: space.xs, color: TINT.amberText }]}>{t('writing.made.replaced')}</Text> : null}
      {holds?.made.id === m.id && holds.changedAfter ? (
        <Text style={[txt.sm, { paddingHorizontal: space.xs, color: TINT.amberText }]}>{t('writing.history.changedAfter', { check: v.kind(holds.changedAfter.kindId).name })}</Text>
      ) : null}
      {m.medium === 'writing' ? (
        <WrittenReader ctx={ctx} state={v.state} unitId={v.unitId} parts={parts} verseKeys={verseKeys}
          {...(from && from.medium === 'recording' ? { heard: from.cardHashes } : {})} />
      ) : (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <AudioClip language={ctx.language} hashes={parts} label={title} />
            <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]}>{title}</Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}
