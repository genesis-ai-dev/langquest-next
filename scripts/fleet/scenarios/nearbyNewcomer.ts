import { isServerEventId } from '@langquest-next/core/nearby';
import type { AnyEvent, LanguageState } from '@langquest-next/core';
import { always, Fleet, FLEET_EPOCH, NETWORKS, never, offlineBetween, TIME, type SimDevice } from '@langquest-next/sync/src/testing';
import type { StartingCopy } from '@langquest-next/sync';
import { meet, type Meeting } from './nearbyMeet';
import type { Scenario } from './types';

/**
 * A newcomer joins with no server (docs/nearby-sync-plan.md 14.1, section 8's Fleet row, phase 6).
 * A team works a day with a signal, then goes to a village with none. That evening a new person's phone, with nobody on it, is
 * let in by a teammate over a link a QR code started: one tap, then a starting copy of the
 * language on the same link. The newcomer works for `days` days and shares nearby each evening
 * with the team. Then everyone reaches the server: the newcomer's first contact must replace the
 * starting copy with the server's first download, push every event the newcomer made, and end
 * equal to the server's fold, with nothing a forged copy said (`forged=1`) left anywhere.
 * `kept=1` puts the newcomer and the inviter where the language is kept on disk, so the copy's
 * passages are filled over the link; `serverCut=1` makes first contact take the server's cut.
 */
export const nearbyNewcomer: Scenario = {
  name: 'nearbyNewcomer',
  summary: 'A newcomer is let in offline from a teammate, works, shares nearby, then first contact replaces the starting copy.',
  defaults: { seed: 1, days: 3, passages: 40, translators: 2, reviewers: 1, audio: 1, kept: 1, forged: 1, serverCut: 0 },
  async run(k) {
    const started = performance.now();
    // A day's work with a signal first, so phones hold checkpoints and passages' rows, then the village.
    const away = FLEET_EPOCH + TIME.DAY + 12 * TIME.HOUR;
    const back = FLEET_EPOCH + 1000 * TIME.DAY;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: 16_000 } : null,
      keepOnDisk: 'half',
      checkpointEvery: 20,
      serverCut: !!k.serverCut,
      nearby: { delivery: true },
      crew: { passages: k.passages!, translators: k.translators!, reviewers: k.reviewers!, link: () => offlineBetween(away, back, always(NETWORKS.phone, 'phone')) }
    });
    await fleet.start();
    const coord = fleet.devices[0]!;
    // The coordinator goes to the village too, once the language is set up.
    await fleet.time.runUntil(away);
    coord.setLink(offlineBetween(away, back, always(NETWORKS.wifi, 'wifi')));
    const team = [...fleet.devices];

    // That evening: a new person, a phone with nobody on it, and a teammate who may let them in.
    await fleet.time.runUntil(FLEET_EPOCH + TIME.DAY + 17 * TIME.HOUR);
    const joining = await fleet.addNewcomer('n0', never(NETWORKS.phone), { kept: !!k.kept });
    const newcomer = joining.device;
    const inviter = team.find((d) => d.keepsOnDisk === newcomer.keepsOnDisk && d.persona.role !== 'reviewer')!;
    const forgedUnit = 'forged/p999';
    const forge = k.forged ? (copy: StartingCopy): StartingCopy => {
      const state = copy.state as LanguageState;
      const any = Object.values(state.units)[0]!;
      state.units[forgedUnit] = { ...any, label: 'Forged' };
      if (copy.kept) copy.kept.lines.push({ ...copy.kept.lines[0]!, unitId: forgedUnit });
      return copy;
    } : undefined;
    const letIn = await fleet.nearby!.letIn(inviter, newcomer, { crypto: joining.crypto, idSalt: joining.idSalt, name: 'Nyibol', roleId: 'translator', ...(forge ? { forge } : {}) });
    const copied = await newcomer.wholeState();
    const copyFacts = {
      inviter: inviter.id,
      kept: newcomer.keepsOnDisk,
      minutes: round(letIn.ms / TIME.MINUTE),
      newcomerEnded: letIn.newcomer.ended.how,
      inviterEnded: letIn.inviter.ended.how,
      whole: letIn.newcomer.copy?.whole ?? false,
      passagesFilled: letIn.newcomer.copy?.filled ?? 0,
      partsSent: letIn.inviter.copyServed.parts,
      units: Object.keys(copied.units).length,
      inviterUnits: Object.keys((await inviter.wholeState()).units).length,
      forgedInCopy: forgedUnit in copied.units
    };
    // The newcomer's person sees the passages the copy brought, as a pull would show them.
    for (const [unitId, unit] of Object.entries(copied.units)) {
      newcomer.persona.observe({ type: 'v1.UnitAdded', payload: { unitId, parentUnitId: unit.parentUnitId, kind: unit.kind, label: unit.label, order: unit.order } } as unknown as AnyEvent);
    }

    // Days of work, sharing nearby each evening, the newcomer among the team.
    const everyone = [...team, newcomer];
    const meetings: Meeting[] = [];
    for (let day = 2; day <= k.days! + 1; day++) {
      await fleet.time.runUntil(FLEET_EPOCH + day * TIME.DAY + 17 * TIME.HOUR);
      meetings.push(await meet(fleet, everyone));
    }
    fleet.stopWork();
    meetings.push(await meet(fleet, everyone));
    const mine = await madeBy(newcomer);
    const reachedTeammates = await Promise.all(team.map(async (d) => { const held = await d.eventIds(); return [...mine].filter((id) => held.has(id)).length; }));
    const copyHeldBefore = await newcomer.client.holdsCopy();

    // First contact, for everyone at once.
    const agreement = await fleet.settle();
    const onServer = new Set(fleet.server.stream(fleet.orgId, fleet.streamId).map((e) => e.id));
    const forgedLeft = (await Promise.all(fleet.devices.map(async (d) => forgedUnit in (await d.wholeState()).units))).filter(Boolean).length;
    const report = fleet.report(agreement, performance.now() - started);
    return {
      report,
      findings: {
        copy: copyFacts,
        newcomerEventsMade: mine.size,
        newcomerEventsOnServer: [...mine].filter((id) => onServer.has(id)).length,
        newcomerEventsOnEachTeammateBeforeTown: reachedTeammates,
        copyHeldBeforeFirstContact: copyHeldBefore,
        copyHeldAfter: await newcomer.client.holdsCopy(),
        newcomerPendingAfter: await newcomer.client.pendingCount(),
        forgedLeftOnPhones: forgedLeft,
        pairings: meetings.reduce((n, m) => n + m.pairings, 0),
        agree: agreement.agree,
        disagree: agreement.disagree
      }
    };
  }
};

/** Every event this phone made, by its own author id, not a server's verdict. */
async function madeBy(d: SimDevice): Promise<Set<string>> {
  const out = new Set<string>();
  for (const l of (await d.client.inspect()).pending) if (l.event.actorId === d.actorId && !isServerEventId(l.event.id)) out.add(l.event.id);
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
