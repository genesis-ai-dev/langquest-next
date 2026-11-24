import { useState } from 'react';
import { View } from 'react-native';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { teammatesFoldWords, teammateSub } from '../nearby/carryWords';
import { formatDay } from '../i18n/format';
import { useDeliveryRefusals } from '../nearby/useDeliveryRefusals';
import { useLetInOffered } from '../nearby/useLetIn';
import { useNearbyOffered } from '../nearby/useNearby';
import { useNearbyTeammates, useQuietUntil } from '../nearby/useNearby.native';
import { quietLineOf, type QuietLine } from '../nearby/quietUntilModel';
import { useWhileOpenNow } from '../nearby/useNearbyWhileOpen.native';
import { teammatesFoldLine } from '../nearby/readyToCarryModel';
import { nearbyRowWords } from '../nearby/shareNearbyModel';
import { Card, Disclosure, Group, Ico, Row } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space, TINT } from '../ui/theme';
import type { Ctx } from './ctx';

/**
 * Share nearby on the Sync screen of an Android phone or an iPhone (docs/nearby-sync-plan.md 5.8,
 * 5.10, section 7's phase 5): shown once this phone holds a certificate for the organization and a
 * discovery key for the language, labelled experimental. Where the organization has nearby on and
 * the phone does not hold them yet, it shows disabled, saying what is missing, rather than
 * vanishing: too many new phones for this account today, or a certificate not fetched yet
 * (`nearbyRowShown`, Carl 2026-11-19). Its line names its two jobs, teammates'
 * phones and a new person, where Share nearby offers Let someone in, else the first alone
 * (`nearbyRowWords`). The install file is on Ready for offline's list above it, not here (14.4).
 * Only Android lets someone in: on an iPhone `useLetIn` is its plain stub, so the row names
 * teammates alone. Below
 * Android 10, or without Bluetooth LE or (on Android) Wi-Fi Direct, it is disabled with a line
 * saying why, and keeps its `onPress` so help mode can explain it (Carl's answer 7). A
 * batch stamped far ahead names its author here too (5.4), whether or not the row shows, and so
 * does teammates' work the server refused whole when this phone delivered it, with the server's
 * reason (section 6).
 *
 * Above the row, where Share nearby can run here, the Teammates fold (15.4): each teammate and how
 * recent the newest work held from them is, as Ready to carry says, so a person sees where they
 * stand without opening Share nearby. Folded, its line names the least recent teammate. While the
 * phone shares quietly with LangQuest open (15.6), the row's line says so, and names nobody. Offline,
 * where it may share that way, each teammate's row also says until when, as far as this phone
 * knows; from three days before it asks the two to meet on Share nearby, and after, that it has
 * stopped (15.8, `quietUntilOf`).
 */
export function NearbyRow(props: { ctx: Ctx }) {
  const { ctx } = props;
  const { offered, whyNot } = useNearbyOffered(ctx);
  const letIn = useLetInOffered(ctx);
  const words = nearbyRowWords(whyNot, letIn);
  const farAhead = farAheadOf(ctx);
  const refusals = useDeliveryRefusals(ctx);
  const team = useNearbyTeammates(ctx, offered && whyNot === null);
  const teamLine = teammatesFoldLine(team);
  // Until when the phone shares with each one while LangQuest is open, offline where the mode runs (15.8).
  const quiet = useQuietUntil(ctx, offered && whyNot === null);
  const now = Date.now();
  const [teamOpen, setTeamOpen] = useState(false);
  // Sharing quietly while LangQuest is open: said here, never with a name (15.6).
  const quietNow = useWhileOpenNow() && whyNot === null;
  return (
    <>
      {teamLine ? (
        <Disclosure testID="sync-teammates" icon="people" title={t('nearby.carry.teamTitle')} help={t('nearby.carry.teamHelp')}
          summary={teammatesFoldWords(teamLine, ctx.name)}
          open={teamOpen} onToggle={() => setTeamOpen((o) => !o)}>
          <View style={{ padding: space.lg }}>
            <Group>
              {team.map((m, i) => (
                <HelpRow key={m.profileId} of="nearby.carryTeammate">
                  <Row label={ctx.name(m.profileId)} sub={teammateSub(m)} below={quietBelow(quiet ? quietLineOf(quiet.get(m.profileId), now) : null)}
                    last={i === team.length - 1} />
                </HelpRow>
              ))}
            </Group>
          </View>
        </Disclosure>
      ) : null}
      {offered ? (
        <Group>
          <Row icon="swap" label={t('nearby.row')} sub={quietNow ? t('nearby.whileOpenNow') : t(words.sub)} help={t(words.help)}
            badge={t('nearby.experimental')} badgeTone="amber" disabled={whyNot !== null} muted={whyNot !== null}
            onPress={() => ctx.go('share_nearby')} last />
        </Group>
      ) : null}
      {farAhead.length > 0 ? (
        <Card>
          {farAhead.map((actorId) => (
            <View key={actorId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Ico name="warning" size={20} color={TINT.amberText} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.farAhead', { name: ctx.name(actorId) })}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {refusals.length > 0 ? (
        <Card>
          {refusals.map((r) => (
            <View key={`${r.actorId} ${r.reason}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Ico name="flag" size={20} color={TINT.redText} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.sync.deliveryRefused', { name: ctx.name(r.actorId), reason: r.reason })}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Authors of batches stamped far ahead, once each, from the open language's client. */
function farAheadOf(ctx: Ctx): string[] {
  try {
    return [...new Set((ctx.language.nearby()?.client.nearbyFarAhead ?? []).map((f) => f.actorId))];
  } catch {
    return [];
  }
}

/** A teammate's line under the fold's row while LangQuest is open: muted while time remains, amber from three days before. */
function quietBelow(line: QuietLine | null) {
  if (!line) return undefined;
  const words = line.t === 'until' ? t('nearby.carry.quietUntil', { day: formatDay(line.at) })
    : line.t === 'soon' ? t('nearby.carry.quietSoon', { day: formatDay(line.at) })
      : t('nearby.carry.quietLapsed');
  return <Text style={line.t === 'until' ? txt.smMuted : [txt.sm, { color: TINT.amberText }]}>{words}</Text>;
}
