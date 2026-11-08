// Share nearby (app only, no demo screen; docs/nearby-sync-plan.md 5.8, 5.11): phones near each
// other bring each other up to date, events and recordings both ways, with no internet. Opened
// from Sync while the organization has it on; labelled experimental (section 5.10). The radios
// run only while this screen is open and on screen (useNearby, `radiosMayRun`); nothing here asks
// Android for anything until a button is pressed. A phone that wears a cover waits for a press,
// and its own words stay in src/disguise/i18n behind NearbyCoverNotes (decision 171 as amended).
// Not split by platform: only Android offers the way in (NearbyRow.android.tsx), and elsewhere
// useNearby says it is not in this build. Loads the first time it is opened (lazyScreens.tsx).
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { NearbyCoverNotes } from '../shell/NearbyCoverNotes';
import { contractsFor } from '../shell/screenContracts';
import { Badge, Banner, Card, Group, Header, Ico, PrimaryBtn, Row, Screen, SectionLabel, SmallBtn, type IconName } from '../ui/kit';
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
      <Warnings ctx={ctx} view={view} />
      <Teammates view={view} actions={actions} who={who} look={look} />
      <CameAcross sessions={view.sessions} who={who} />
      {view.whyNot === null ? <CarryCard carry={view.carry} holding={view.holding} who={who} /> : null}
      <Group>
        <Row icon="layers" label={t('nearby.hold')} help={t('nearby.holdHelp')} role="switch" checked={view.hold}
          onPress={() => { void actions.setHold(!view.hold); }} last />
      </Group>
    </Screen>
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

/** Lines that hold whatever the state: a clock out by minutes, a newer app needed, a stamp far ahead (5.4). */
function Warnings(props: { ctx: Ctx; view: NearbyView }) {
  const { view, ctx } = props;
  const lines = [
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
  counts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs }
});

export const contracts = contractsFor('share_nearby');
