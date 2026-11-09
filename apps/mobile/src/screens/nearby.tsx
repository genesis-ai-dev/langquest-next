// Share nearby (app only, no demo screen; docs/nearby-sync-plan.md 5.8, 5.11): phones near each
// other bring each other up to date, events and recordings both ways, with no internet. Opened
// from Sync while the organization has it on; labelled experimental (section 5.10). The radios
// run only while this screen is open and on screen (useNearby, `radiosMayRun`); nothing here asks
// Android for anything until a button is pressed. A phone that wears a cover waits for a press,
// and its own words stay in src/disguise/i18n behind NearbyCoverNotes (decision 171 as amended).
// Joining without internet (14.1) adds Let someone in, from here, and the new phone's progress
// screen, a guest screen from Scan a code; both are app only and labelled experimental.
// Not split by platform: only Android offers the way in (NearbyRow.android.tsx), and elsewhere
// useNearby says it is not in this build. Loads the first time it is opened (lazyScreens.tsx).
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LetInCode } from '../nearby/LetInCode';
import { ChosenPicture } from '../auth/patternPad';
import { apkGet, letInVersionsWords } from '../nearby/carriedApkModel';
import { joinName, type JoinEnd, type NotEmptyWhy } from '../nearby/joinOfflineModel';
import type { LetInEnd, LetInWhyNot } from '../nearby/letInModel';
import { useJoinOffline } from '../nearby/useJoinOffline';
import { useCarriedApk, type CarriedApkHandle } from '../nearby/useCarriedApk';
import { useLetIn, useLetInOffered } from '../nearby/useLetIn';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatDayTime } from '../i18n/format';
import { useNearby } from '../nearby/useNearby';
import type { NearbyActions, NearbySessionLine, NearbyTeammate, NearbyView } from '../nearby/nearbyRunModel';
import type { ReadyToCarry } from '../nearby/readyToCarryModel';
import {
  endedWords, linesShown, PERMISSION_WORDS, RADIO_WORDS, SEEN_WORDS, stageOf, STOP_WORDS, teammatesShown, TEAMMATE_WORDS, WHY_NOT_WORDS, type NearbyStage
} from '../nearby/shareNearbyModel';
import type { Ctx } from '../shell/ctx';
import { LetInCoverNote } from '../shell/LetInCoverNote';
import { NearbyCoverNotes } from '../shell/NearbyCoverNotes';
import { contractsFor } from '../shell/screenContracts';
import { Badge, Banner, Card, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, Row, Screen, SectionLabel, SmallBtn, type IconName } from '../ui/kit';
import { personLook } from '../ui/people';
import { usePerson } from '../ui/usePerson';
import { PersonAvatar } from '../ui/UserChip';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';

export function ShareNearby(ctx: Ctx) {
  const { view, actions } = useNearby(ctx);
  const stage = stageOf(view);
  const look = usePerson();
  /** A person by name and picture; someone this phone cannot put a name to is "A teammate" (5.8). */
  const who = (profileId: string | null) => (profileId ? ctx.name(profileId) : t('nearby.aTeammate'));
  const main = mainAction(stage, actions);
  const apk = useCarriedApk();
  return (
    <Screen header={<Header title={t('screens.share_nearby')} onBack={ctx.back} />}
      footer={main ? <PrimaryBtn label={main.label} icon={main.icon} help={main.help} onPress={main.onPress} /> : undefined}>
      <Card>
        <View style={styles.line}>
          <Ico name="swap" size={22} color={C.primary} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('screens.share_nearby')}</Text>
          <Badge label={t('nearby.experimental')} tone="amber" />
        </View>
        <Text style={txt.sm}>{t('nearby.intro')}</Text>
      </Card>
      <StageCard stage={stage} view={view} actions={actions} who={who} />
      <Warnings ctx={ctx} view={view} apkOld={apk.stale && ctx.language.online === true} />
      <Teammates view={view} actions={actions} who={who} look={look} />
      <CameAcross sessions={view.sessions} who={who} />
      {view.whyNot === null ? <CarryCard carry={view.carry} holding={view.holding} who={who} /> : null}
      <Group>
        <Row icon="layers" label={t('nearby.hold')} help={t('nearby.holdHelp')} role="switch" checked={view.hold}
          onPress={() => { void actions.setHold(!view.hold); }} last />
      </Group>
      <LetInRow ctx={ctx} />
    </Screen>
  );
}

/**
 * Let someone in, for a person holding a pass for this language while the organization has joining
 * on (docs/nearby-sync-plan.md 14.1, 3); hidden otherwise. A run-out pass keeps the row, disabled,
 * saying the phone needs the server again; the row keeps its onPress so help mode can explain it.
 */
function LetInRow(props: { ctx: Ctx }) {
  const whyNot = useLetInOffered(props.ctx);
  if (whyNot !== null && whyNot !== 'expired') return null;
  return (
    <Group>
      <Row icon="people" label={t('screens.let_someone_in')} sub={whyNot === 'expired' ? t('nearby.letIn.why.expired') : t('nearby.letIn.rowSub')}
        help={t('nearby.letIn.rowHelp')} disabled={whyNot !== null} onPress={() => { if (whyNot === null) props.ctx.go('let_someone_in'); }} last />
    </Group>
  );
}

/** The one main thing to do now, as a 56 pt button: Continue to Android's question, Open settings, or Look again. */
function mainAction(stage: NearbyStage, actions: NearbyActions): { label: string; icon: IconName; help: string; onPress: () => void } | null {
  if (stage.t === 'permission') return { label: t('nearby.permission.allow'), icon: 'arrowR', help: t('nearby.permission.allowHelp'), onPress: () => { void actions.askPermissions(); } };
  if (stage.t === 'settings') return { label: t('nearby.permission.openSettings'), icon: 'settings', help: t('nearby.permission.openSettingsHelp'), onPress: () => { void actions.openSettings(); } };
  if (stage.t === 'stopped') return { label: t('nearby.lookAgain'), icon: 'search', help: t('nearby.lookAgainHelp'), onPress: actions.lookAgain };
  return null;
}

/** What stands between the person and their teammates now, or how sharing goes. */
function StageCard(props: { stage: NearbyStage; view: NearbyView; actions: NearbyActions; who: (p: string | null) => string }) {
  const { stage, view } = props;
  switch (stage.t) {
    case 'unavailable':
      return (
        <Card>
          <View style={styles.line} accessible accessibilityLabel={t(WHY_NOT_WORDS[stage.why])}>
            {stage.why === 'loading' ? <ActivityIndicator color={C.primary} /> : <Ico name="info" size={22} color={C.muted} />}
            <Text style={[txt.body, { flex: 1 }]}>{t(WHY_NOT_WORDS[stage.why])}</Text>
          </View>
        </Card>
      );
    case 'cover': {
      const general = stage.stopped ? STOP_WORDS[stage.stopped] : null;
      return <NearbyCoverNotes view={view} actions={props.actions} stopLine={general ? t(general) : null} />;
    }
    case 'radios':
      return (
        <Card>
          <Text style={[txt.body, { fontWeight: '700' }]}>{t('nearby.radios.title')}</Text>
          {stage.off.map((r) => (
            <View key={r} style={styles.line}>
              <Ico name="warning" size={20} color={TINT.amberText} />
              <Text style={[txt.body, { flex: 1 }]}>{t(RADIO_WORDS[r])}</Text>
            </View>
          ))}
        </Card>
      );
    case 'permission':
      return <Banner icon="info" title={t(PERMISSION_WORDS[stage.reason])} />;
    case 'settings':
      return <Banner icon="lock" tone="amber" title={t(PERMISSION_WORDS.settings)} />;
    case 'stopped': {
      const words = STOP_WORDS[stage.why];
      return (
        <Card>
          {words ? <Text style={[txt.body, { fontWeight: '700' }]}>{t(words)}</Text> : null}
          <Text style={txt.smMuted}>{t('nearby.stopped.lookAgainLine')}</Text>
        </Card>
      );
    }
    case 'running': {
      const current = view.current;
      const sharingWith = current ? view.teammates.find((m) => m.tag === current.tag)?.profileId ?? null : null;
      return (
        <Card>
          {stage.level ? <Banner icon="check" tone="green" title={t('nearby.upToDate')} body={t('nearby.upToDateLine')} /> : null}
          {current ? (
            <View style={{ gap: space.xs }}>
              <View style={styles.line}>
                <ActivityIndicator color={C.primary} />
                <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('nearby.sharingWith', { name: props.who(sharingWith) })}</Text>
              </View>
              <Counts eventsIn={current.eventsIn} eventsOut={current.eventsOut} filesIn={current.filesIn} filesOut={current.filesOut} />
            </View>
          ) : stage.level ? null : (
            <View style={styles.line}>
              <ActivityIndicator color={C.primary} />
              <Text style={[txt.body, { flex: 1 }]}>{t('nearby.looking')}</Text>
            </View>
          )}
          {view.findError ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.findError', { code: view.findError })}</Text> : null}
        </Card>
      );
    }
    case 'starting':
      return (
        <Card>
          <View style={styles.line}>
            <ActivityIndicator color={C.primary} />
            <Text style={[txt.body, { flex: 1 }]}>{t('nearby.starting')}</Text>
          </View>
        </Card>
      );
  }
}

/**
 * Lines that hold whatever the state: a clock out by minutes, a newer app needed, a stamp far ahead
 * (5.4), and, while the phone is online, an install file got for an older version (14.4).
 */
function Warnings(props: { ctx: Ctx; view: NearbyView; apkOld: boolean }) {
  const { view, ctx } = props;
  const lines = [
    props.apkOld ? t('nearby.apkOld') : null,
    ctx.language.tooOld ? t('nearby.tooOld') : null,
    view.newerAppNeeded ? t('nearby.newerApp') : null,
    view.clockOff ? t('nearby.clockOff') : null,
    ...view.farAhead.map((f) => t('nearby.farAhead', { name: ctx.name(f.actorId) }))
  ].filter((l): l is string => l !== null);
  if (lines.length === 0) return null;
  return (
    <Card>
      {lines.map((l) => (
        <View key={l} style={styles.line}>
          <Ico name="warning" size={20} color={TINT.amberText} />
          <Text style={[txt.sm, { flex: 1 }]}>{l}</Text>
        </View>
      ))}
    </Card>
  );
}

function Teammates(props: { view: NearbyView; actions: NearbyActions; who: (p: string | null) => string; look: ReturnType<typeof usePerson> }) {
  const shown = teammatesShown(props.view.teammates);
  if (shown.length === 0) return null;
  return (
    <>
      <SectionLabel label={t('nearby.teammates')} />
      <Group>
        {shown.map((m: NearbyTeammate, i) => {
          const name = props.who(m.profileId);
          const state = t(TEAMMATE_WORDS[m.state]);
          return (
            <HelpRow key={m.tag} of="nearby.teammate">
              <Row label={m.state === 'maybe' ? state : name} sub={m.state === 'maybe' ? undefined : state} last={i === shown.length - 1}
                accessibilityLabel={m.state === 'maybe' ? state : `${name}, ${state}`}
                leading={<PersonAvatar look={m.profileId ? props.look(m.profileId) : personLook(m.tag)} size={40} />}
                right={m.state === 'maybe' ? <SmallBtn label={t('nearby.connect')} help={t('nearby.connectHelp')} onPress={() => props.actions.tap(m.tag)} /> : undefined} />
            </HelpRow>
          );
        })}
      </Group>
    </>
  );
}

/** Changes and recordings each way, as label and number, so no language needs a plural for them. */
function Counts(props: { eventsIn: number; eventsOut: number; filesIn: number; filesOut: number }) {
  return (
    <View style={styles.counts}>
      <Text style={txt.sm}>{t('nearby.came.changesIn', { n: props.eventsIn })}</Text>
      <Text style={txt.sm}>{t('nearby.came.changesOut', { n: props.eventsOut })}</Text>
      <Text style={txt.sm}>{t('nearby.came.filesIn', { n: props.filesIn })}</Text>
      <Text style={txt.sm}>{t('nearby.came.filesOut', { n: props.filesOut })}</Text>
    </View>
  );
}

/** What came across in each session, newest first. */
function CameAcross(props: { sessions: readonly NearbySessionLine[]; who: (p: string | null) => string }) {
  const lines = linesShown(props.sessions);
  if (lines.length === 0) return null;
  return (
    <>
      <SectionLabel label={t('nearby.came.title')} />
      {lines.map((l, i) => {
        const ended = endedWords(l.how);
        return (
          <Card key={`${l.tag ?? ''}-${i}`}>
            <Text style={[txt.body, { fontWeight: '700' }]}>{props.who(l.profileId)}</Text>
            <Counts eventsIn={l.eventsIn} eventsOut={l.eventsOut} filesIn={l.filesIn} filesOut={l.filesOut} />
            {l.refused ? <Text style={txt.smMuted}>{t('nearby.came.refused', { n: l.refused })}</Text> : null}
            {l.filesFailed ? <Text style={txt.smMuted}>{t('nearby.came.filesFailed', { n: l.filesFailed })}</Text> : null}
            {ended ? <Text style={txt.smMuted}>{t(ended)}</Text> : null}
            {l.noRoom ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.came.noRoom')}</Text> : null}
            {l.cutBackups ? <Text style={txt.smMuted}>{t('nearby.came.cutBackups')}</Text> : null}
            {l.olderFromServer ? <Text style={txt.smMuted}>{t('nearby.olderFromServer')}</Text> : null}
          </Card>
        );
      })}
    </>
  );
}

/** Ready to carry (5.8): whether this phone holds everything it knows of, what is missing and why, and each teammate. */
function CarryCard(props: { carry: ReadyToCarry; holding: number; who: (p: string | null) => string }) {
  const { carry, who } = props;
  const lines: { key: string; text: string; tone?: string }[] = [];
  if (carry.notAllRecordings) lines.push({ key: 'notAll', text: t('nearby.carry.notAll'), tone: TINT.amberText });
  else if (carry.missing > 0) {
    lines.push({ key: 'missing', text: t('nearby.carry.missing', { n: carry.missing }) });
    if (carry.coming > 0) lines.push({ key: 'coming', text: t('nearby.carry.coming', { n: carry.coming }) });
    for (const e of carry.elsewhere) {
      lines.push(e.profileId
        ? { key: `e-${e.profileId}`, text: t('nearby.carry.elsewhere', { name: who(e.profileId) }) }
        : { key: 'e-unknown', text: t('nearby.carry.elsewhereUnknown', { n: e.files }) });
    }
  }
  if (carry.noRoom) lines.push({ key: 'noRoom', text: t('nearby.carry.noRoom'), tone: TINT.amberText });
  if (carry.pulledUnshared) lines.push({ key: 'pulled', text: t('nearby.carry.pulled') });
  if (carry.olderFromServer) lines.push({ key: 'older', text: t('nearby.olderFromServer') });
  const team = carry.teammates;
  return (
    <>
      <SectionLabel label={t('nearby.carry.title')} />
      <Card>
        {carry.everything ? (
          <View style={styles.line}>
            <Ico name="check" size={20} color={TINT.greenText} />
            <Text style={[txt.body, { flex: 1, color: TINT.greenText, fontWeight: '700' }]}>{t('nearby.carry.everything')}</Text>
          </View>
        ) : null}
        {lines.map((l) => <Text key={l.key} style={[txt.sm, l.tone ? { color: l.tone } : null]}>{l.text}</Text>)}
        {props.holding > 0 ? <Text style={txt.smMuted}>{t('nearby.carry.holding', { n: props.holding })}</Text> : null}
      </Card>
      {team.length > 0 ? (
        <Group>
          {team.map((m, i) => (
            <HelpRow key={m.profileId} of="nearby.carryTeammate">
              <Row label={who(m.profileId)} last={i === team.length - 1}
                sub={m.seen !== 'today' && m.newestMs !== null ? `${t(SEEN_WORDS[m.seen])} · ${t('nearby.carry.newest', { when: formatDayTime(m.newestMs) })}` : t(SEEN_WORDS[m.seen])} />
            </HelpRow>
          ))}
        </Group>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pictures: { flexDirection: 'row', justifyContent: 'center', gap: space.xl },
  counts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs }
});

// ---- Let someone in (docs/nearby-sync-plan.md 14.1, 3) ----------------------------------

/** Why Let someone in cannot run here, in words. */
const LET_IN_WHY = {
  'loading': 'nearby.letIn.why.loading',
  'not-in-build': 'nearby.letIn.why.notInBuild',
  'no-pass': 'nearby.letIn.why.noPass',
  'expired': 'nearby.letIn.why.expired',
  'no-role': 'nearby.letIn.why.noRole',
  'read-only': 'nearby.letIn.why.noPass',
  'permissions': 'nearby.letIn.why.permissions',
  'wifi-off': 'nearby.letIn.why.wifiOff'
} as const satisfies Record<LetInWhyNot, string>;

/** How a link with a newcomer ended, in words. */
const LET_IN_END = {
  'expired': 'nearby.letIn.end.expired',
  'said-no': 'nearby.letIn.end.saidNo',
  'no-answer': 'nearby.letIn.end.noAnswer',
  'versions': 'nearby.letIn.end.versions',
  'clock': 'nearby.letIn.end.clock',
  'refused': 'nearby.letIn.end.refused',
  'dropped': 'nearby.letIn.end.dropped',
  'dropped-after': 'nearby.letIn.end.droppedAfter',
  'stopped': 'nearby.letIn.end.stopped',
  'no-certificate': 'nearby.letIn.end.noCertificate',
  'failed': 'nearby.letIn.end.failed'
} as const satisfies Record<LetInEnd, string>;

/** The two pictures from the link both phones share (core `joinPictures`): the same two on both, or someone else is on the line. */
function TwoPictures(props: { pictures: [number, number] }) {
  return (
    <View style={styles.pictures} accessible accessibilityLabel={t('nearby.letIn.picturesLabel')}>
      <ChosenPicture picture={props.pictures[0]} />
      <ChosenPicture picture={props.pictures[1]} />
    </View>
  );
}

/**
 * Let someone in: an inviter with a pass for this language shows a code that holds only how to
 * reach this phone, a secret and a pin; a new phone scans it, asks with the name its person typed,
 * and one tap here, after both people compare the two pictures, lets them in under the role chosen.
 * Then this phone sends them a starting copy. Nothing runs until Show the code is pressed.
 */
export function LetSomeoneIn(ctx: Ctx) {
  const { whyNot, roles, state, code, secondsLeft, worn, actions } = useLetIn(ctx);
  const apk = useCarriedApk();
  const { stage } = state;
  const running = stage.t === 'starting' || stage.t === 'showing' || stage.t === 'connected' || stage.t === 'copying';
  let footer: ReactNode = null;
  if (whyNot === null && stage.t === 'asked') {
    footer = (
      <>
        <PrimaryBtn label={t('nearby.letIn.letIn', { name: stage.name })} icon="check" help={t('nearby.letIn.letInHelp')} onPress={() => actions.answer(true)} />
        <GhostBtn label={t('nearby.letIn.no')} help={t('nearby.letIn.noHelp')} onPress={() => actions.answer(false)} />
      </>
    );
  } else if (whyNot === null && (stage.t === 'choose' || stage.t === 'ended')) {
    footer = <PrimaryBtn label={stage.t === 'ended' ? t('nearby.letIn.newCode') : t('nearby.letIn.show')} icon="qr" disabled={!state.roleId}
      help={t('nearby.letIn.showHelp')} onPress={actions.show} />;
  } else if (whyNot === null && stage.t === 'done') {
    footer = <GhostBtn label={t('nearby.letIn.another')} icon="plus" help={t('nearby.letIn.anotherHelp')} onPress={actions.newCode} />;
  }
  return (
    <Screen header={<Header title={t('screens.let_someone_in')} onBack={ctx.back} />} footer={footer}>
      <Card>
        <View style={styles.line}>
          <Ico name="people" size={22} color={C.primary} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('screens.let_someone_in')}</Text>
          <Badge label={t('nearby.experimental')} tone="amber" />
        </View>
        <Text style={txt.sm}>{t('nearby.letIn.intro')}</Text>
      </Card>
      {whyNot !== null ? (
        <Card>
          <View style={styles.line}>
            {whyNot === 'loading' ? <ActivityIndicator color={C.primary} /> : <Ico name="info" size={22} color={C.muted} />}
            <Text style={[txt.body, { flex: 1 }]}>{t(LET_IN_WHY[whyNot])}</Text>
          </View>
        </Card>
      ) : (
        <>
          {(stage.t === 'choose' || stage.t === 'ended') && roles.length > 1 ? (
            <>
              <SectionLabel label={t('nearby.letIn.role')} />
              <Group>
                {roles.map((r, i) => (
                  <HelpRow key={r.roleId} of="nearby.letInRole">
                    <Row label={r.name} role="radio" selected={state.roleId === r.roleId} checked={state.roleId === r.roleId}
                      help={t('nearby.letIn.roleHelp')} onPress={() => actions.choose(r.roleId)} last={i === roles.length - 1} />
                  </HelpRow>
                ))}
              </Group>
            </>
          ) : null}
          {stage.t === 'choose' && roles.length === 1 ? <Text style={txt.sm}>{t('nearby.letIn.asRole', { role: roles[0]!.name })}</Text> : null}
          {stage.t === 'starting' ? <Waiting text={t('nearby.letIn.starting')} /> : null}
          {stage.t === 'showing' && code ? (
            <Card>
              <LetInCode value={code} label={t('nearby.letIn.codeLabel')} />
              <Text style={txt.body}>{t('nearby.letIn.scanLine')}</Text>
              <Text style={txt.smMuted}>{t('nearby.letIn.secondsLeft', { n: secondsLeft })}</Text>
            </Card>
          ) : null}
          {stage.t === 'connected' ? <Waiting text={t('nearby.letIn.connected')} /> : null}
          {stage.t === 'asked' ? (
            <Card>
              <Text style={[txt.h3, { textAlign: 'center' }]}>{t('nearby.letIn.ask', { name: stage.name })}</Text>
              <TwoPictures pictures={stage.pictures} />
              <Text style={txt.body}>{t('nearby.letIn.compare')}</Text>
              <Text style={txt.smMuted}>{t('nearby.letIn.whatGoes')}</Text>
            </Card>
          ) : null}
          {stage.t === 'copying' ? <Waiting text={t('nearby.letIn.copying', { name: stage.name, n: stage.parts })} /> : null}
          {stage.t === 'done' ? (
            <Banner icon="check" tone="green" title={t('nearby.letIn.done', { name: stage.name })} body={t('nearby.letIn.doneLine')} />
          ) : null}
          {stage.t === 'ended' ? (
            <Banner icon="info" tone="amber" title={stage.why === 'versions' ? versionsWords(apk.needed) : t(LET_IN_END[stage.why])} />
          ) : null}
          {state.turnedAway ? (
            <View style={styles.line}>
              <Ico name="warning" size={20} color={TINT.amberText} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.letIn.turnedAway')}</Text>
            </View>
          ) : null}
          {running ? <Text style={txt.smMuted}>{t('nearby.letIn.stayOpen')}</Text> : null}
        </>
      )}
      {/* Below the steps, and away while a code is up or a phone is on the line, so the code and the one tap stay in view. */}
      {whyNot !== 'not-in-build' && (whyNot !== null || stage.t === 'choose' || stage.t === 'ended' || stage.t === 'done')
        ? <InstallFile apk={apk} online={ctx.language.online} worn={worn} /> : null}
    </Screen>
  );
}

/** The new phone runs other versions: the file it needs, by this phone's name for it. */
function versionsWords(installFile: string | null): string {
  const w = letInVersionsWords(installFile);
  return w.key === 'nearby.letIn.end.versions' ? t(w.key, { file: w.file }) : t(w.key);
}

/**
 * The carried build this phone's versions need (14.4): its name, exactly, so a carrier can compare
 * it with the file they hold; the browser download while online, with how it reaches the new
 * phone; a check of a file they hold, by its name alone; and a word when the file they got
 * before is for an older version. Nothing here downloads or installs anything.
 */
function InstallFile(props: { apk: CarriedApkHandle; online: boolean | null; worn: boolean }) {
  const { apk } = props;
  if (apk.needed === null) return null;
  const get = apkGet({ needed: apk.needed, url: apk.url, online: props.online });
  return (
    <Card>
      <Text style={txt.body}>{t('nearby.letIn.file', { file: apk.needed })}</Text>
      <Text style={txt.sm}>{t('nearby.letIn.fileExact')}</Text>
      {apk.stale ? (
        <View style={styles.line}>
          <Ico name="warning" size={20} color={TINT.amberText} />
          <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.letIn.fileOld')}</Text>
        </View>
      ) : null}
      {get !== null ? (
        <>
          <GhostBtn label={t('nearby.letIn.get')} icon="download" disabled={get === 'offline'} help={t('nearby.letIn.getHelp')} onPress={apk.actions.get} />
          {get === 'offline' ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.letIn.getOffline')}</Text> : null}
          <Text style={txt.smMuted}>{t('nearby.letIn.getLine')}</Text>
        </>
      ) : null}
      <GhostBtn label={t('nearby.letIn.check')} icon="folder" help={t('nearby.letIn.checkHelp')} onPress={apk.actions.check} />
      {apk.checked ? (
        <View style={styles.line}>
          <Ico name={apk.checked.result === 'right' ? 'check' : 'warning'} size={20} color={apk.checked.result === 'right' ? TINT.greenText : TINT.amberText} />
          <View style={{ flex: 1 }}>
            <Text style={txt.sm}>{apk.checked.result === 'right' ? t('nearby.letIn.checkRight') : t('nearby.letIn.checkOther', { file: apk.needed })}</Text>
            <Text style={txt.smMuted}>{t('nearby.letIn.checkChose', { name: apk.checked.name })}</Text>
          </View>
        </View>
      ) : null}
      <Text style={txt.smMuted}>{t('nearby.letIn.fileHelp')}</Text>
      <LetInCoverNote worn={props.worn} />
    </Card>
  );
}

function Waiting(props: { text: string }) {
  return (
    <Card>
      <View style={styles.line}>
        <ActivityIndicator color={C.primary} />
        <Text style={[txt.body, { flex: 1 }]}>{props.text}</Text>
      </View>
    </Card>
  );
}

// ---- Joining without internet: the progress screen (docs/nearby-sync-plan.md 14.1, 3 to 5) ---

/** Why this phone cannot take a newcomer, in words. */
const NOT_EMPTY = {
  'session': 'nearby.join.notEmpty.session',
  'locks': 'nearby.join.notEmpty.others',
  'cover': 'nearby.join.notEmpty.others',
  'hand-over': 'nearby.join.notEmpty.others',
  'unsent': 'nearby.join.notEmpty.unsent',
  'local-person': 'nearby.join.notEmpty.local'
} as const satisfies Record<NotEmptyWhy, string>;

const JOIN_END = {
  'not-let-in': 'nearby.join.end.notLetIn',
  'no-answer': 'nearby.join.end.noAnswer',
  'clock': 'nearby.join.end.clock',
  'versions': 'nearby.join.end.versions',
  'refused': 'nearby.join.end.refused',
  'dropped': 'nearby.join.end.dropped',
  'failed': 'nearby.join.end.failed'
} as const satisfies Record<JoinEnd, string>;

/**
 * Joining without internet, on the new phone: after scanning a teammate's Let someone in code, the
 * person types their name and presses Join; the phone reaches the teammate's, both show the same
 * two pictures, and once the teammate lets them in a starting copy of the team's work comes. The
 * app starts as them only when the copy is whole. A guest screen: nobody is signed in yet.
 */
export function JoinOffline(ctx: Ctx) {
  const { stage, pictures, stale, actions } = useJoinOffline();
  const [name, setName] = useState('');
  const ready = joinName(name) !== null;
  let footer: ReactNode = null;
  if (stage.t === 'name') footer = <PrimaryBtn label={t('nearby.join.join')} icon="arrowR" disabled={!ready} help={t('nearby.join.joinHelp')} onPress={() => actions.join(name)} />;
  else if (stage.t === 'permission' && stage.blocked) footer = <PrimaryBtn label={t('nearby.permission.openSettings')} icon="settings" help={t('nearby.permission.openSettingsHelp')} onPress={() => { void actions.openSettings(); }} />;
  else if (stage.t === 'permission' || stage.t === 'wifi-off') footer = <PrimaryBtn label={t('nearby.join.tryAgain')} icon="arrowR" disabled={!ready} help={t('nearby.join.joinHelp')} onPress={() => actions.join(name)} />;
  else if (stage.t === 'no-code' || stage.t === 'ended') footer = <PrimaryBtn label={t('nearby.join.scan')} icon="qr" help={t('nearby.join.scanHelp')} onPress={() => { actions.again(); ctx.go('scan_qr'); }} />;
  else if (stage.t === 'unfinished') footer = <PrimaryBtn label={t('nearby.join.look')} icon="search" help={t('nearby.join.lookHelp')} onPress={actions.look} />;
  else if (stage.t === 'looking') footer = <GhostBtn label={t('nearby.join.stopLooking')} help={t('nearby.join.stopLookingHelp')} onPress={actions.stopLooking} />;
  else if (stage.t === 'not-empty' || stage.t === 'not-in-build') footer = <GhostBtn label={t('nearby.join.back')} help={t('nearby.join.backHelp')} onPress={() => ctx.go('sign_in')} />;
  return (
    <Screen header={<Header title={t('screens.join_offline')} onBack={() => ctx.go('sign_in')} />} footer={footer}>
      <Card>
        <View style={styles.line}>
          <Ico name="people" size={22} color={C.primary} />
          <Text style={[txt.body, { flex: 1, fontWeight: '700' }]}>{t('screens.join_offline')}</Text>
          <Badge label={t('nearby.experimental')} tone="amber" />
        </View>
        <Text style={txt.sm}>{t('nearby.join.intro')}</Text>
      </Card>
      {stage.t === 'checking' ? <Waiting text={t('nearby.join.checking')} /> : null}
      {stage.t === 'not-in-build' ? <Banner icon="info" title={t('nearby.join.notInBuild')} /> : null}
      {stage.t === 'not-empty' ? <Banner icon="lock" tone="amber" title={t('nearby.join.notEmpty.title')} body={t(NOT_EMPTY[stage.why])} /> : null}
      {stage.t === 'no-code' ? <Banner icon="qr" title={t('nearby.join.noCode')} /> : null}
      {stage.t === 'name' || stage.t === 'permission' || stage.t === 'wifi-off' ? (
        <Card>
          <Field label={t('nearby.join.name')} value={name} onChangeText={setName} placeholder={t('nearby.join.namePlaceholder')} help={t('nearby.join.nameHelp')}
            onSubmit={() => { if (ready && stage.t === 'name') actions.join(name); }} />
          <Text style={txt.smMuted}>{t('nearby.join.nameLine')}</Text>
          {stale ? <Text style={[txt.sm, { color: TINT.amberText }]}>{t('nearby.join.stale')}</Text> : null}
        </Card>
      ) : null}
      {stage.t === 'permission' ? <Banner icon="lock" tone="amber" title={t(stage.blocked ? 'nearby.join.permissionBlocked' : 'nearby.join.permission')} /> : null}
      {stage.t === 'wifi-off' ? <Banner icon="warning" tone="amber" title={t('nearby.join.wifiOff')} /> : null}
      {stage.t === 'connecting' ? <Waiting text={t('nearby.join.connecting')} /> : null}
      {stage.t === 'asked' ? (
        <Card>
          <Text style={[txt.h3, { textAlign: 'center' }]}>{t('nearby.join.asked')}</Text>
          {pictures ? <TwoPictures pictures={pictures} /> : null}
          <Text style={txt.body}>{t('nearby.join.compare')}</Text>
        </Card>
      ) : null}
      {stage.t === 'copying' ? <Waiting text={t('nearby.join.copying', { n: stage.parts })} /> : null}
      {stage.t === 'unfinished' ? <Banner icon="info" tone="amber" title={t('nearby.join.unfinished')} body={t('nearby.join.unfinishedLine')} /> : null}
      {stage.t === 'looking' ? <Waiting text={t('nearby.join.looking')} /> : null}
      {stage.t === 'whole' ? <Banner icon="check" tone="green" title={t('nearby.join.whole')} body={t('nearby.join.installFile')} /> : null}
      {stage.t === 'ended' ? <Banner icon="info" tone="amber" title={t(JOIN_END[stage.why])} /> : null}
    </Screen>
  );
}

export const contracts = contractsFor('share_nearby', 'let_someone_in', 'join_offline');
