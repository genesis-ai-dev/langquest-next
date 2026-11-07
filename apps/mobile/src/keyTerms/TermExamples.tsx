// A key term's recorded examples (decision 205). A term can be said more than
// one way, depending on context, and a language may have no written form, so
// each way is its own card: its clips together, and its own button to record
// it again. "Add a different way" starts another card. The later check
// accepts a take that holds any way. Recording is the app's voice note; each
// clip is saved as soon as it ends.
import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { KEY_TERM_EXAMPLES_WANTED, type KeyTermView } from '@langquest-next/core';
import { AudioClip } from '../audio/audioClip';
import { VoiceNote } from '../audio/voiceNote';
import { HelpRow } from '../helpMode/helpBadge';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Card, GhostBtn, SectionLabel } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { exampleWays, newWayId } from './examplesModel';

export function TermExamples(props: {
  ctx: Ctx;
  language: string;
  term: Pick<KeyTermView, 'renderings' | 'audioRenderings'>;
  canRecord: boolean;
  busy: boolean;
  onRecorded: (hash: string, durationMs: number, wayId: string) => void;
}) {
  const { ctx } = props;
  const [pending, setPending] = useState<string[]>([]);
  const ways = exampleWays(props.term, pending);
  const last = ways[ways.length - 1]!;
  return (
    <View style={{ gap: space.sm }} testID="term-examples">
      <SectionLabel label={t('config.keyTerm.examples', { language: props.language })} />
      <Text style={txt.sm}>{t('config.keyTerm.examplesBody')}</Text>
      {ways.map((w, i) => {
        const enough = w.examples.length >= KEY_TERM_EXAMPLES_WANTED;
        return (
          <HelpRow key={w.wayId} of="keyTerm.way">
            <Card>
              <View testID={`term-way-${i}`} style={{ gap: space.sm }}>
                {w.rendering ? <Text style={[txt.h3, { color: C.primary }]}>{w.rendering}</Text>
                  : <Text style={txt.body}>{t('config.keyTerm.wayN', { n: i + 1 })}</Text>}
                {w.context ? <Text style={txt.sm}>{w.context}</Text> : null}
                <Text style={[txt.xsStrong, { color: enough ? C.green : C.primary }]}>
                  {t('config.keyTerm.examplesCount', { count: w.examples.length, want: KEY_TERM_EXAMPLES_WANTED })}
                </Text>
                {w.examples.map((e, k) => (
                  <HelpRow key={e.renderingId} of="keyTerm.example">
                    <AudioClip language={ctx.language} hashes={[e.blobHash]} label={t('config.keyTerm.playExample', { n: k + 1 })} />
                  </HelpRow>
                ))}
                {props.canRecord && !props.busy ? (
                  <VoiceNote ctx={ctx} hash={null} label={w.examples.length ? t('config.keyTerm.recordAgain') : t('config.keyTerm.recordThisWay')}
                    onChange={(hash, card) => { if (hash && card) props.onRecorded(hash, card.durationMs, w.wayId); }} />
                ) : null}
              </View>
            </Card>
          </HelpRow>
        );
      })}
      {props.canRecord && last.examples.length > 0 ? (
        <GhostBtn label={t('config.keyTerm.addWay')} icon="plus" help={t('config.keyTerm.addWayHelp')}
          onPress={() => setPending((p) => [...p, newWayId(randomUUID())])} />
      ) : null}
    </View>
  );
}
