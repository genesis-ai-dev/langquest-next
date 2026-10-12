// A guide's step, as the study reader and the recording workspace's Guide
// chip show it (decision 71; demo ADR-035; demo simple/translator.tsx Study,
// StudyLesson, Workspace's guide): the step spoken (Back 10 s, Note at a
// moment) when it has audio, its text with glossary words dotted-underlined
// (tap for the meaning), pictures and maps as cards, and its callouts ("Stop
// here." on amber). Any part takes a note or an answer (STUDY-7). Nothing
// here depends on which method wrote the guide.
import { keyTermsFor, type CalloutKind, type PassageNote } from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { Ico, SmallBtn, txt, type IconName } from '../kit';
import type { PassageView } from '../passageView';
import type { StudyGuide, StudyResource } from '../study/guides';
import { glossaryEntryOf } from '../study/libraryGuides';
import { useStudyFileUri } from '../study/media';
import type { StudyProgress, StudyStepStatus } from '../study/progress';
import { clock, inlineParts, isCallout, isQuestion, secondsOf, sectionLabel, studySections, type StudySection } from '../study/text';
import { calloutLabel, ContributeSheet, GlossarySheet, MediaSheet, saveNote, shownClock, StudyNote, useStudyAudio } from '../study/ui';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { Callout, MiniPlayer, StepNav, StepsSheet, styles as ps } from './parts';

/** The guide's language, from its source line ("… · English"), without naming where it came from. */
export function guideLanguage(g: Pick<StudyGuide, 'source'>): string {
  const parts = g.source.split('·').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : '';
}

/** ‹ 2/6 Setting the stage ▾ ›, and the sheet of every step it opens. */
export function GuideNav(props: { ctx: Ctx; sp: StudyProgress; index: number; onIndex: (i: number) => void; sheetFooter?: React.ReactNode }) {
  const { sp } = props;
  const [listing, setListing] = useState(false);
  const step = sp.steps[props.index] ?? sp.steps[0]!;
  const people = sp.people.map((p) => props.ctx.name(p));
  const progress = { done: sp.doneCount, total: sp.steps.length };
  const sub = people.length === 0 ? t('study.guide.progress', progress)
    : people.length === 1 ? t('study.guide.progressByOne', { ...progress, name: people[0] })
    : people.length === 2 ? t('study.guide.progressByTwo', { ...progress, first: people[0], second: people[1] })
    : t('study.guide.progressByMore', { ...progress, first: people[0], second: people[1] });
  return (
    <>
      <StepNav index={props.index} count={sp.steps.length} title={step.step.title}
        onPrev={() => props.onIndex(Math.max(0, props.index - 1))} onNext={() => props.onIndex(Math.min(sp.steps.length - 1, props.index + 1))}
        onList={() => setListing(true)} />
      {listing ? (
        <StepsSheet title={t('study.guide.stepsTitle', { count: sp.steps.length })} sub={sub}
          steps={sp.steps.map((s) => ({ title: s.step.title, ...(s.step.phase ? { phase: s.step.phase } : {}), done: !!s.done }))}
          current={props.index} onPick={(i) => { setListing(false); props.onIndex(i); }} onClose={() => setListing(false)}>
          {props.sheetFooter}
        </StepsSheet>
      ) : null}
    </>
  );
}

/** One step. Keyed by step, so moving on starts its audio fresh. */
export function GuideStep(props: {
  ctx: Ctx; v: PassageView; guide: StudyGuide; status: StudyStepStatus; canContribute: boolean;
  /** The step spoken, at the top: the study shows it; the workspace keeps to the text. */
  spoken: boolean;
  hidden?: boolean;
  /** Open a key term (an edge from this screen). */
  onTerm?: (termId: string) => void;
}) {
  const { ctx, v, guide, status } = props;
  const step = status.step;
  const sections = useMemo(() => studySections(step.text), [step.text]);
  const hasAudio = !!(step.audio.url || step.audio.file);
  const { uri: audioUri } = useStudyFileUri(ctx.language.orgId, step.audio.file, step.audio.url);
  const audio = useStudyAudio(audioUri, step.audio.seconds);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ sectionId?: string; at?: string; quote: string; answer: boolean } | null>(null);
  const [resource, setResource] = useState<StudyResource | null>(null);
  useEffect(() => () => audio.pause(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.hidden) audio.pause(); }, [props.hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const momentOf = (n: PassageNote) => (n.anchor.kind === 'study' && n.anchor.at ? secondsOf(n.anchor.at) : -1);
  const atMoment = status.notes.filter((n) => momentOf(n) >= 0).sort((a, b) => momentOf(a) - momentOf(b));
  const onSection = (id: string) => status.notes.filter((n) => n.anchor.kind === 'study' && n.anchor.sectionId === id);
  const onStep = status.notes.filter((n) => n.anchor.kind === 'study' && !n.anchor.sectionId && momentOf(n) < 0);
  const openRef = (ref: string) => {
    const r = guide.resources.find((x) => x.ref === ref);
    if (r) { audio.pause(); setResource(r); }
  };
  const term = (() => {
    const state = ctx.language.state;
    if (!state || resource?.kind !== 'term') return null;
    const name = resource.title.trim().toLowerCase();
    return keyTermsFor(state).find((k) => k.term.trim().toLowerCase() === name) ?? null;
  })();
  const entry = resource?.kind === 'term' ? glossaryEntryOf(guide, resource.ref) : null;
  const lang = guideLanguage(guide);

  return (
    <View style={{ gap: space.md }}>
      {props.spoken && hasAudio ? (
        <MiniPlayer title={t('study.guide.spoken')} sub={audio.failed ? t('study.guide.couldNotLoad') : !audioUri ? t('study.guide.gettingRecording') : [shownClock(audio.playing || audio.time > 0 ? audio.time : audio.duration), lang].filter(Boolean).join(' · ')}
          playing={audio.playing} available onToggle={audio.toggle} onBack10={() => audio.seek(audio.time - 10)} backDisabled={audio.time <= 0}
          {...(props.canContribute ? { onNote: () => { audio.pause(); setAdding({ at: clock(audio.time), quote: t('study.guide.recordingAt', { time: shownClock(audio.time) }), answer: false }); } } : {})} />
      ) : null}

      {atMoment.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {atMoment.map((n) => <StudyNote key={n.id} ctx={ctx} note={n} label={t('study.guide.at', { time: shownClock(momentOf(n)) })} />)}
        </View>
      ) : null}

      {sections.map((sec) => (
        <SectionView key={sec.id} ctx={ctx} section={sec} resources={guide.resources} notes={onSection(sec.id)} orgId={ctx.language.orgId}
          selected={selected === sec.id} canContribute={props.canContribute}
          onSelect={() => setSelected((cur) => (cur === sec.id ? null : sec.id))}
          onAdd={() => setAdding({ sectionId: sec.id, quote: sectionLabel(sec, 120), answer: isQuestion(sec) })}
          onOpenRef={openRef} />
      ))}

      {onStep.length > 0 ? <View style={{ gap: space.sm }}>{onStep.map((n) => <StudyNote key={n.id} ctx={ctx} note={n} />)}</View> : null}

      {adding ? (
        <ContributeSheet ctx={ctx} unitId={v.unitId} languageId={v.languageId} title={adding.answer ? t('study.guide.yourAnswer') : t('common.addNote')}
          where={`${step.title} · ${adding.quote}`}
          onClose={() => { setAdding(null); setSelected(null); }}
          onSave={(c) => saveNote(ctx, v, {
            kind: 'study', guideId: guide.id, stepId: step.id,
            ...(adding.sectionId ? { sectionId: adding.sectionId } : {}), ...(adding.at ? { at: adding.at } : {})
          }, c, adding.at ? t('study.guide.noteAddedAt', { time: shownClock(secondsOf(adding.at)) }) : t('study.guide.added'))} />
      ) : null}
      {resource && resource.kind !== 'term' ? <MediaSheet resource={resource} source={lang ? t('study.guide.mediaSourceLanguage', { language: lang }) : t('study.guide.mediaSource')} orgId={ctx.language.orgId} onClose={() => setResource(null)} /> : null}
      {resource && entry ? (
        <GlossarySheet entry={entry} source={lang ? t('study.guide.glossarySourceLanguage', { language: lang }) : t('study.guide.glossarySource')} orgId={ctx.language.orgId} hasKeyTerm={!!term && !!props.onTerm} onClose={() => setResource(null)}
          onOpenTerm={() => { if (!term || !props.onTerm) return; setResource(null); props.onTerm(term.termId); }} />
      ) : null}
    </View>
  );
}

/** Each callout kind's icon and tone; its word is study/ui's `calloutLabel`. */
const CALLOUTS: Record<CalloutKind, { icon: IconName; tone: 'amber' | 'brand' | 'green' | 'gray' }> = {
  action: { icon: 'clock', tone: 'amber' },
  warning: { icon: 'flag', tone: 'amber' },
  note: { icon: 'note', tone: 'gray' },
  question: { icon: 'help', tone: 'brand' },
  culture: { icon: 'globe', tone: 'green' }
};

/** Inline text: bold, glossary words dotted-underlined, pictures and maps as links. */
function Inline(props: { text: string; resources: StudyResource[]; onOpenRef: (ref: string) => void }) {
  return (
    <>
      {inlineParts(props.text).map((p, i) => {
        if (p.type === 'text') return <Text key={i}>{p.text}</Text>;
        if (p.type === 'bold') return <Text key={i} style={{ fontWeight: '800' }}>{p.text}</Text>;
        const r = props.resources.find((x) => x.ref === p.ref);
        return (
          <Text key={i} onPress={() => props.onOpenRef(p.ref)} accessibilityRole="link" suppressHighlighting={false}
            accessibilityHint={r?.kind === 'term' ? t('study.guide.tapForMeaning') : t('study.guide.opensPicture')}
            style={r?.kind === 'term' ? styles.word : styles.link}>{p.text}</Text>
        );
      })}
    </>
  );
}

/** One section: tap to select it, then note it (or answer a question). Pictures it links to follow as cards. */
function SectionView(props: {
  ctx: Ctx; section: StudySection; resources: StudyResource[]; notes: StudyStepStatus['notes']; orgId: string | null;
  selected: boolean; canContribute: boolean; onSelect: () => void; onAdd: () => void; onOpenRef: (ref: string) => void;
}) {
  const sec = props.section;
  const question = isQuestion(sec);
  const links = inlineParts(sec.text).flatMap((p) => (p.type === 'link' ? [p] : []));
  const media = links.map((l) => props.resources.find((r) => r.ref === l.ref)).filter((r): r is StudyResource => !!r && r.kind !== 'term');
  const inline = <Inline text={sec.text} resources={props.resources} onOpenRef={props.onOpenRef} />;
  const select = useHelpSpot(question ? t('study.guide.help.question') : t('study.guide.help.part'),
    props.canContribute ? (question ? t('study.guide.help.tapToAnswer') : t('study.guide.help.tapToNote')) : undefined, props.onSelect);
  const body = isCallout(sec.kind) ? (
    <Callout {...CALLOUTS[sec.kind]} label={calloutLabel(sec.kind)}>{inline}</Callout>
  ) : sec.kind === 'item' ? (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Text style={[styles.reading, styles.itemMark]}>{sec.n ? `${sec.n}.` : '•'}</Text>
      <Text style={[styles.reading, { flex: 1 }, question && { fontWeight: '600' }]}>{inline}</Text>
    </View>
  ) : sec.kind === 'heading' ? <Text style={txt.h3}>{inline}</Text> : <Text style={styles.reading}>{inline}</Text>;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable disabled={!props.canContribute} onPress={select.onPress} accessibilityRole={props.canContribute ? 'button' : undefined}
        accessibilityState={{ selected: props.selected }} style={[styles.section, props.selected && styles.sectionOn]}>
        {body}
        {props.notes.length > 0 && !props.selected ? <View style={styles.count}><Text style={styles.countText}>{props.notes.length}</Text></View> : null}
        <HelpBadge spot={select} />
      </Pressable>
      {props.selected && props.canContribute ? (
        <View style={{ flexDirection: 'row' }}>
          <SmallBtn label={question ? t('study.guide.answer') : t('common.addNote')} icon={question ? 'mic' : 'note'} tone="primary" onPress={props.onAdd} />
        </View>
      ) : null}
      {media.map((r) => <MediaCard key={r.ref} resource={r} orgId={props.orgId} onPress={() => props.onOpenRef(r.ref)} />)}
      {props.notes.map((n) => <StudyNote key={n.id} ctx={props.ctx} note={n} label={question ? t('study.guide.answerNote') : undefined} />)}
    </View>
  );
}

/** A picture or map the text links to (demo Picture): a thumbnail and its title; a tap shows it full width. */
function MediaCard(props: { resource: StudyResource; orgId: string | null; onPress: () => void }) {
  const first = props.resource.media?.[0];
  const { uri } = useStudyFileUri(props.orgId, first?.file, first?.url);
  const [failed, setFailed] = useState(false);
  const spot = useHelpSpot(props.resource.title, t('study.guide.help.picture'), props.onPress);
  const picture = uri && !failed && first?.kind !== 'video';
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('study.guide.picture', { title: props.resource.title })}
      style={({ pressed }) => [styles.media, pressed && ps.pressed]}>
      <View style={styles.thumb}>
        {picture ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
          : <Ico name={props.resource.kind === 'map' ? 'map' : first?.kind === 'video' ? 'video' : 'media'} size={26} color={C.faint} />}
      </View>
      <Text style={[txt.body, { flex: 1, fontWeight: '700' }]} numberOfLines={2}>{props.resource.title}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reading: { fontSize: T.base, lineHeight: 26, color: C.dark },
  itemMark: { width: 24, textAlign: 'right', fontWeight: '700', color: C.primary },
  word: { fontWeight: '700', color: C.primary, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  link: { fontWeight: '700', color: C.primary, textDecorationLine: 'underline' },
  section: { borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', minHeight: target.min - 8, justifyContent: 'center' },
  sectionOn: { borderColor: C.soft, backgroundColor: C.light, padding: space.xs },
  count: { position: 'absolute', right: -4, top: -6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: TINT.amberText, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: T.xs, fontWeight: '800', color: C.white },
  media: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md + 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  thumb: { width: 72, height: 54, borderRadius: radius.sm + 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }
});
