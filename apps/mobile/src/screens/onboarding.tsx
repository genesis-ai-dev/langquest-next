// The first sign-in welcome. Ports the demo's src/screens/onboarding.tsx
// WelcomeScreen. Requirements ONB-1, ONB-2 (its "What is LangQuest?" link),
// NAV-2 (where Skip lands). ADR-022: a first sign-in, or joining with an
// invite, lands here: who invited you, your role on which team, and two or
// three plain lines for that role.
//
// Not ported: the practice tours (ADR-022, ONB-3/4) and Listen. With the
// Getting started card gone (decision 71, amended 2026-10-08), "Show me how"
// had nothing to show, so it did what "Skip for now" did: one "Get started"
// opens home for every role, and help is the ? on each screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { firstName, roleWords, teamLabel, welcomeRoleFor, WELCOME_POINTS } from '../accountText';
import type { Ctx } from '../ctx';
import { t, Trans } from '../i18n';
import { Banner, Disclosure, GhostBtn, Group, Ico, LinkBtn, PrimaryBtn, Row, Screen, txt } from '../kit';
import { signInName } from '../accounts';
import { highlightsFor, languageInfo, unitTitle } from '@langquest-next/core';
import { indexesFor } from '../indexes';
import { PersonAvatar } from '../UserChip';
import { personLook } from '../people';
import { reportError } from '../report';
import { contractsFor } from '../screenContracts';
import { homeScreenFor } from '../session';
import { C, radius, space, type as T } from '../theme';
import { useDisplayNames } from '../useAccount';
import { lastWork } from '../welcomeBack';

export function Welcome(ctx: Ctx) {
  const me = ctx.session.actorId;
  const org = ctx.org.state;
  const profiles = useDisplayNames(me);
  const [busy, setBusy] = useState(false);

  const who = useMemo(() => {
    // Your membership here: the role's name and the scope it covers.
    const mine = Object.values(org?.members[me] ?? {}).filter((m) => !m.removed.value);
    const scoped = mine.find((m) => m.scope.level === 'language') ?? mine[0];
    const roleName = (scoped && org?.roles[scoped.roleId.value]?.name.value)
      ?? (ctx.session.role ? roleWords(ctx.session.role) : undefined) ?? t('entry.welcome.member');
    // Who invited you: the invite you redeemed, when the log has it.
    const invite = Object.values(org?.invites ?? {}).find((i) => i.redeemedBy === me);
    const invitedBy = invite?.issuedBy && invite.issuedBy !== me ? ctx.name(invite.issuedBy) : undefined;
    const displayName = profiles[me] ?? ctx.session.email?.split('@')[0] ?? '';
    const team = teamLabel(scoped?.scope, {
      org: org?.org?.value.name ?? t('entry.welcome.yourOrganization'),
      language: (id) => languageInfo(org, id)?.name
    });
    return { roleName, invitedBy, inviterId: invite?.issuedBy, displayName, team };
  }, [org, me, profiles, ctx.session.role, ctx.session.email, ctx.name]);

  const role = welcomeRoleFor(ctx.session);
  const points = WELCOME_POINTS[role];
  const home = homeScreenFor(ctx.session);

  async function leave() {
    if (busy) return;
    setBusy(true);
    try { await ctx.markWelcomed(); }
    // Saved to the account outbox, which retries; a failure to queue is a fault.
    catch (e) { ctx.toast(t('common.somethingWentWrong', { code: reportError('welcome seen', e) })); }
    setBusy(false);
    // Along the home_hub edge: My Work for everyone who does or asks for work, the overview for viewers.
    ctx.go(home);
  }

  const first = firstName(who.displayName);
  const handle = signInName(ctx.session.email);
  return (
    <Screen
      bodyStyle={styles.body}
      footer={<PrimaryBtn label={t('entry.welcome.getStarted')} onPress={() => void leave()} disabled={busy} />}
    >
      <View style={styles.hero}>
        {who.inviterId ? (
          <PersonAvatar look={personLook(who.inviterId, who.invitedBy)} size={72} />
        ) : (
          <View style={styles.logo}><Ico name="book" size={36} color={C.white} /></View>
        )}
        {who.invitedBy ? <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>{t('entry.welcome.invitedYou', { name: who.invitedBy })}</Text> : null}
        <Text style={styles.title} accessibilityRole="header">{first ? t('entry.welcome.greeting', { name: first }) : t('entry.welcome.title')}</Text>
        <Text style={[txt.body, { textAlign: 'center' }]}>
          {/* English says "an" before a vowel; other languages translate both the same. */}
          <Trans i18nKey={/^[aeiou]/i.test(who.roleName) ? 'entry.welcome.youAreAn' : 'entry.welcome.youAreA'}
            values={{ role: who.roleName, team: who.team }} components={{ b: <Text style={{ fontWeight: '700' }} /> }} />
        </Text>
      </View>
      {handle ? (
        // Joined by invite with no email or password: nothing to remember (decisions.md 59).
        <Banner icon="lock" title={t('entry.welcome.nothingTitle')}
          body={who.invitedBy ? t('entry.welcome.nothingBody', { name: who.invitedBy }) : t('entry.welcome.nothingBodyNoName')} />
      ) : null}
      <Group>
        {points.map((p, i) => <Row key={p.text} icon={p.icon} label={p.text} last={i === points.length - 1} />)}
      </Group>
      <LinkBtn label={t('entry.vision.title')} onPress={() => ctx.go('vision')} style={{ alignSelf: 'center' }} />
    </Screen>
  );
}

/**
 * Welcome back. Ports the demo's WelcomeBackScreen (ADR-043, ONB-8): the
 * first sign-in with an account from the old LangQuest (v2). Their work is
 * already here, so it says where it went (each language, its organization,
 * and what it was called in v2), says to record here from now on, and Keep going opens
 * what's waiting for them first, else the passage they recorded last. Until
 * any of it has come over, it says it is on its way and to keep recording in
 * the old app, with Check again, and nothing else (never "What brings you
 * here?"). What they had comes from welcomeBack.ts.
 *
 * Not ported: Listen, as on Welcome.
 */
export function WelcomeBack(ctx: Ctx) {
  const me = ctx.session.actorId;
  const data = ctx.welcomeBack?.data ?? { here: [], onTheirWay: [] };
  const profiles = useDisplayNames(me);
  const first = firstName(profiles[me] ?? ctx.session.email?.split('@')[0] ?? '');
  const [busy, setBusy] = useState(false);
  const waiting = data.here.length === 0;
  const orgId = ctx.language.orgId;

  // Their work arrived while no organization was open here: open the one it is in.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !ctx.session.hasNoOrg || !data.here[0]) return;
    opened.current = true;
    void ctx.openOrganization(data.here[0].orgId);
  }, [ctx.session.hasNoOrg, data.here, ctx.openOrganization]);

  // Keep going starts in the language they recorded in last, in this organization.
  const last = useMemo(() => lastWork(data, orgId), [data, orgId]);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current || !last || ctx.languageId === last.languageId) return;
    moved.current = true;
    ctx.setLanguage(last.languageId);
  }, [last, ctx.languageId, ctx.setLanguage]);
  const state = ctx.language.state;
  const target = useMemo(() => {
    if (!last || !state || ctx.language.languageId !== last.languageId) return null;
    const waitingFor = highlightsFor(state, me, { canRecord: ctx.session.can('translate'), canReview: ctx.session.can('review') }, indexesFor(state))[0]?.unitId;
    const unitId = [waitingFor, last.lastUnitId].find((u): u is string => !!u && !!state.units[u]);
    return unitId ? { unitId, languageId: last.languageId, title: unitTitle(state, unitId) } : null;
  }, [last, state, ctx.language.languageId, me, ctx.session]);

  async function leave(then: () => void) {
    if (busy) return;
    setBusy(true);
    try { await ctx.markWelcomed(); }
    // Saved to the account outbox, which retries; a failure to queue is a fault.
    catch (e) { ctx.toast(t('common.somethingWentWrong', { code: reportError('welcome back seen', e) })); }
    setBusy(false);
    then();
  }

  async function checkAgain() {
    if (busy || !ctx.welcomeBack) return;
    setBusy(true);
    const next = await ctx.welcomeBack.refresh();
    setBusy(false);
    // Arrived: the organization opens and this screen says so; otherwise say it is not here yet.
    if (!next?.here.length) ctx.toast(t('entry.welcomeBack.notYet'));
  }

  const bold = <Text style={{ fontWeight: '700' }} />;
  return (
    <Screen
      bodyStyle={styles.body}
      footer={waiting ? (
        <PrimaryBtn label={t('entry.welcomeBack.checkAgain')} icon="restart" onPress={() => void checkAgain()} busy={busy} />
      ) : target ? (
        <>
          <PrimaryBtn label={t('entry.welcomeBack.keepGoing', { passage: target.title })} icon="arrowR" disabled={busy}
            onPress={() => void leave(() => ctx.openPassage(target.unitId, target.languageId))} />
          <GhostBtn label={t('entry.welcomeBack.goToMyWork')} disabled={busy} onPress={() => void leave(() => ctx.go(homeScreenFor(ctx.session)))} />
        </>
      ) : (
        <PrimaryBtn label={t('entry.welcomeBack.goToMyWork')} disabled={busy} onPress={() => void leave(() => ctx.go(homeScreenFor(ctx.session)))} />
      )}
    >
      <View style={styles.hero}>
        <View style={styles.logo}><Ico name="book" size={36} color={C.white} /></View>
        <Text style={styles.title} accessibilityRole="header">
          {waiting
            ? (first ? t('entry.welcome.greeting', { name: first }) : t('entry.welcome.title'))
            : (first ? t('entry.welcomeBack.greeting', { name: first }) : t('entry.welcomeBack.title'))}
        </Text>
        <Text style={[txt.body, { textAlign: 'center' }]}>{waiting ? t('entry.welcomeBack.onItsWay') : t('entry.welcomeBack.isHere')}</Text>
      </View>
      <View style={{ gap: space.sm }}>
        {data.here.map((l) => (
          <View key={l.languageId} style={styles.item}>
            <View style={styles.tile}><Ico name="check" size={22} color={C.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]}>{l.name}</Text>
              <Text style={[txt.xs, { marginTop: 4 }]}>{t('entry.welcomeBack.wasProject', { org: l.orgName, project: l.was })}</Text>
              {/* What they recorded there; someone who recorded nothing gets no row of zeros. */}
              {l.recordings > 0 ? (
                <Text style={[txt.xs, { marginTop: 2 }]}>
                  {t('entry.welcomeBack.counts', { recordings: t('entry.welcomeBack.recordings', { count: l.recordings }), passages: t('entry.welcomeBack.passages', { count: l.passages }) })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
        {data.onTheirWay.map((p) => (
          <View key={p.id} style={[styles.item, styles.waiting]}>
            <View style={styles.tile}><Ico name="clock" size={22} color={C.muted} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]}>{p.name}</Text>
              <Text style={[txt.xs, { marginTop: 4 }]}>{t('entry.welcomeBack.onItsWayRow')}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.note}>
        <Ico name={waiting ? 'clock' : 'mic'} size={22} color={C.primary} />
        <Text style={[txt.sm, { flex: 1 }]}>
          <Trans i18nKey={waiting ? 'entry.welcomeBack.keepOldApp' : 'entry.welcomeBack.recordHere'} components={{ b: bold }} />
        </Text>
      </View>
      <Disclosure icon="swap" title={t('entry.welcomeBack.differentTitle')} summary={t('entry.welcomeBack.differentSummary')}
        {...ctx.details('welcome_back.different')}>
        <View style={styles.different}>
          <Text style={txt.sm}><Trans i18nKey="entry.welcomeBack.differentProject" components={{ b: bold }} /></Text>
          <Text style={txt.sm}><Trans i18nKey="entry.welcomeBack.differentQuests" components={{ b: bold }} /></Text>
          <Text style={txt.sm}><Trans i18nKey="entry.welcomeBack.differentVersions" components={{ b: bold }} /></Text>
          <Text style={txt.sm}><Trans i18nKey="entry.welcomeBack.differentVotes" components={{ b: bold }} /></Text>
        </View>
      </Disclosure>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.xl },
  hero: { alignItems: 'center', gap: space.md },
  logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: T.display, fontWeight: '800', color: C.dark, textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14,
    backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border },
  waiting: { borderStyle: 'dashed' },
  different: { gap: 10, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg },
  tile: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14, backgroundColor: C.light, borderRadius: radius.lg }
});

export const contracts = contractsFor('welcome');
