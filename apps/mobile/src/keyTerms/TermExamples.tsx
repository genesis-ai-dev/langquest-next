// A key term's recorded examples (decision 205): two or three clips of the
// team saying the term, kept as events so a later check can listen for it.
// A term can be said more than one way, depending on context, so examples
// are grouped by the written rendering they repeat (examplesModel.ts): the
// check later accepts any way, and repeats of one way are kept together.
// Recording is the app's voice note; each clip is saved as soon as it ends.
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
import { exampleGroups } from './examplesModel';

export function TermExamples(props: {
  ctx: Ctx;
  language: string;
  term: Pick<KeyTermView, 'renderings' | 'audioRenderings'>;
  canRecord: boolean;
  busy: boolean;
  onRecorded: (hash: string, durationMs: number, forRenderingId?: string) => void;
}) {
  const { ctx } = props;
  const groups = exampleGroups(props.term);
  const several = groups.length > 1;
  return (
    <View style={{ gap: space.sm }} testID="term-examples">
      <SectionLabel label={t('config.keyTerm.examples', { language: props.language })} />
      <Text style={txt.sm}>{t('config.keyTerm.examplesBody')}</Text>
      {groups.map((g) => {
        const enough = g.examples.length >= KEY_TERM_EXAMPLES_WANTED;
        return (
          <HelpRow key={g.renderingId ?? 'other'} of="keyTerm.way">
          <View style={{ gap: space.sm }} testID={`term-examples-${g.renderingId ?? 'other'}`}>
            <Card>
              {g.renderingId !== null ? (
                <>
                  <Text style={[txt.h3, { color: C.primary }]}>{g.rendering}</Text>
                  {g.context ? <Text style={txt.sm}>{g.context}</Text> : null}
                </>
              ) : several || g.examples.length > 0 ? <Text style={txt.body}>{t('config.keyTerm.examplesOther')}</Text> : null}
              <Text style={[txt.xsStrong, { color: enough ? C.green : C.primary }]}>
                {t('config.keyTerm.examplesCount', { count: g.examples.length, want: KEY_TERM_EXAMPLES_WANTED })}
              </Text>
              {g.examples.map((e, i) => (
                <HelpRow key={e.renderingId} of="keyTerm.example">
                  <AudioClip language={ctx.language} hashes={[e.blobHash]} label={t('config.keyTerm.playExample', { n: i + 1 })} />
                </HelpRow>
              ))}
            </Card>
            {props.canRecord && !props.busy ? (
              <VoiceNote ctx={ctx} label={t('config.keyTerm.recordExample')} hash={null}
                onChange={(hash, card) => { if (hash && card) props.onRecorded(hash, card.durationMs, g.renderingId ?? undefined); }} />
            ) : null}
          </View>
          </HelpRow>
        );
      })}
    </View>
  );
}
