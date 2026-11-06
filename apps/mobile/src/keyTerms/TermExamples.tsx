// A key term's recorded examples (decision 205): two or three clips of the
// team saying the term, kept as events so a later check can listen for it.
// Recording is the app's voice note; each clip is saved as soon as it ends,
// and the box is ready for the next one until the team has enough.
import { View } from 'react-native';
import { KEY_TERM_EXAMPLES_WANTED, type KeyTermView } from '@langquest-next/core';
import { AudioClip } from '../audio/audioClip';
import { VoiceNote } from '../audio/voiceNote';
import { HelpRow } from '../helpMode/helpBadge';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Card, SectionLabel } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';

export function TermExamples(props: {
  ctx: Ctx;
  language: string;
  examples: KeyTermView['audioRenderings'];
  canRecord: boolean;
  busy: boolean;
  onRecorded: (hash: string, durationMs: number) => void;
}) {
  const { ctx, examples } = props;
  const enough = examples.length >= KEY_TERM_EXAMPLES_WANTED;
  return (
    <View style={{ gap: space.sm }} testID="term-examples">
      <SectionLabel label={t('config.keyTerm.examples', { language: props.language })} />
      <Card>
        <Text style={txt.sm}>{t('config.keyTerm.examplesBody')}</Text>
        <Text style={[txt.xsStrong, { color: enough ? C.green : C.primary }]} testID="term-examples-count">
          {t('config.keyTerm.examplesCount', { count: examples.length, want: KEY_TERM_EXAMPLES_WANTED })}
        </Text>
        {examples.map((e, i) => (
          <HelpRow key={e.renderingId} of="keyTerm.example">
            <AudioClip language={ctx.language} hashes={[e.blobHash]} label={t('config.keyTerm.playExample', { n: i + 1 })} />
          </HelpRow>
        ))}
      </Card>
      {props.canRecord && !props.busy ? (
        <VoiceNote ctx={ctx} label={t('config.keyTerm.recordExample')} hash={null}
          onChange={(hash, card) => { if (hash && card) props.onRecorded(hash, card.durationMs); }} />
      ) : null}
    </View>
  );
}
