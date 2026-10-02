// The first sign-in welcome. Ports the demo's src/screens/onboarding.tsx
// WelcomeScreen. Requirements ONB-1, ONB-2 (its "What is LangQuest?" link),
// NAV-2 (where Skip lands). ADR-022: a first sign-in, or joining with an
// invite, lands here: who invited you, your role on which team, and two or
// three plain lines for that role.
//
// Not ported: the practice tours (ADR-022, ONB-3/4) and Listen. "Show me
// how" opens My Work with its Getting started card instead of a tour.
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { firstName, teamLabel, welcomeRoleFor, WELCOME_POINTS, withArticle } from '../accountText';
import type { Ctx } from '../ctx';
import { Banner, GhostBtn, Group, Ico, LinkBtn, PrimaryBtn, Row, Screen, txt } from '../kit';
import { signInName } from '../accounts';
import { laneName } from '@langquest-next/core';
import { PersonAvatar } from '../UserChip';
import { personLook } from '../people';
import { reportError } from '../report';
import { contractsFor } from '../screenContracts';
import { homeScreenFor } from '../session';
import { C, space, type as T } from '../theme';
import { useDisplayNames } from '../useAccount';

const ROLE_WORDS: Record<string, string> = {
  owner: 'Organization Admin', coordinator: 'Coordinator', translator: 'Translator', reviewer: 'Reviewer', viewer: 'Viewer'
};

export function Welcome(ctx: Ctx) {
  const me = ctx.session.actorId;
  const org = ctx.org.state;
  const profiles = useDisplayNames(me);
  const [busy, setBusy] = useState(false);

  const who = useMemo(() => {
    // Your membership here: the role's name and the scope it covers.
    const mine = Object.values(org?.members[me] ?? {}).filter((m) => !m.removed.value);
    const scoped = mine.find((m) => m.scope.level === 'lane') ?? mine.find((m) => m.scope.level === 'project') ?? mine[0];
    const roleName = (scoped && org?.roles[scoped.roleId.value]?.name.value)
      ?? (ctx.session.role ? ROLE_WORDS[ctx.session.role] : undefined) ?? 'member';
    // Who invited you: the invite you redeemed, when the log has it.
    const invite = Object.values(org?.invites ?? {}).find((i) => i.redeemedBy === me);
    const invitedBy = invite?.issuedBy && invite.issuedBy !== me ? ctx.name(invite.issuedBy) : undefined;
    const displayName = profiles[me] ?? mine.find((m) => m.displayName)?.displayName ?? ctx.session.email?.split('@')[0] ?? '';
    const state = ctx.project.state;
    const team = teamLabel(scoped?.scope, {
      org: org?.org?.value.name ?? 'your organization',
      lane: (id) => (state?.lanes[id] ? laneName(state, id) : ctx.languages.find((l) => l.laneId === id)?.name)
    });
    return { roleName, invitedBy, inviterId: invite?.issuedBy, displayName, team };
  }, [org, me, profiles, ctx.project.state, ctx.languages, ctx.session.role, ctx.session.email, ctx.name]);

  const role = welcomeRoleFor(ctx.session);
  const points = WELCOME_POINTS[role];
  const home = homeScreenFor(ctx.session);
  // Viewers have nothing to practise, so they get one button (the demo's "Get started").
  const hasGettingStarted = home === 'my_work';

  async function leave(showGettingStarted: boolean) {
    if (busy) return;
    setBusy(true);
    try { await ctx.markWelcomed(); }
    // Saved to the account outbox, which retries; a failure to queue is a fault.
    catch (e) { ctx.toast(`Something went wrong (code ${reportError('welcome seen', e)}). Nothing was lost.`); }
    setBusy(false);
    // Along the home_hub edge: My Work for everyone who does or asks for work, the overview for viewers.
    ctx.go(home, showGettingStarted && hasGettingStarted ? { showGettingStarted: '1' } : undefined);
  }

  const first = firstName(who.displayName);
  const handle = signInName(ctx.session.email);
  return (
    <Screen
      bodyStyle={styles.body}
      footer={hasGettingStarted ? (
        <>
          <PrimaryBtn label="Show me how" icon="play" onPress={() => void leave(true)} disabled={busy} />
          <GhostBtn label="Skip for now" onPress={() => void leave(false)} disabled={busy} />
        </>
      ) : <PrimaryBtn label="Get started" onPress={() => void leave(false)} disabled={busy} />}
    >
      <View style={styles.hero}>
        {who.inviterId ? (
          <PersonAvatar look={personLook(who.inviterId, who.invitedBy)} size={72} />
        ) : (
          <View style={styles.logo}><Ico name="book" size={36} color={C.white} /></View>
        )}
        {who.invitedBy ? <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>{who.invitedBy} invited you</Text> : null}
        <Text style={styles.title} accessibilityRole="header">{first ? `Welcome, ${first}` : 'Welcome'}</Text>
        <Text style={[txt.body, { textAlign: 'center' }]}>
          You're {withArticle(who.roleName).split(' ')[0]} <Text style={{ fontWeight: '700' }}>{who.roleName}</Text> on {who.team}.
        </Text>
      </View>
      {handle ? (
        // A looked-after account signs in with this, not an email (docs/invites-and-accounts.md).
        <Banner icon="lock" title={`Your sign-in name is ${handle}`}
          body="Write it down. You'll need it with your password. If you forget either, the person who invited you can help you back in." />
      ) : null}
      <Group>
        {points.map((p, i) => <Row key={p.text} icon={p.icon} label={p.text} last={i === points.length - 1} />)}
      </Group>
      <LinkBtn label="What is LangQuest?" onPress={() => ctx.go('vision')} style={{ alignSelf: 'center' }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.xl },
  hero: { alignItems: 'center', gap: space.md },
  logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: T.display, fontWeight: '800', color: C.dark, textAlign: 'center' }
});

export const contracts = contractsFor('welcome');
