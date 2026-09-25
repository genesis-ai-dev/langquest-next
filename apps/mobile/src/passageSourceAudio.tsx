// Avatar U. Replay chapter sources and passage references beside the recorder.
import {
  SOURCE_BIBLES, sourceAudioUrl, sourceBibleEnabled, sourceChapters,
  bsbPassageBounds, bibleRangeFromUnit, bibleSettings
} from '@langquest-next/core';
import { Headphones } from 'lucide-react-native';
import { Text, View } from 'react-native';
import type { Ctx } from './ctx';
import { AudioClip } from './audioClip';
import { getReferenceSlides } from './passageResources';
import { Card, text } from './ui';
import { colors, space } from './theme';
import { BibleBrainAudio } from './bibleBrain';

export function PassageSourceAudio({ ctx, unitId, laneId, disabled }: {
  ctx: Ctx; unitId: string; laneId: string; disabled: boolean;
}) {
  const workspace = ctx.project.state?.obt.workspace;
  if (workspace) return <AudioClip project={ctx.project}
    hashes={ctx.project.state?.takes[workspace.value.inputTakeId]?.cardHashes ?? []}
    label="Listen to the assigned draft" disabled={disabled} seekControls />;
  const chapters = sourceChapters(unitId);
  const bibles = SOURCE_BIBLES.filter((b) => ctx.org.state &&
    sourceBibleEnabled(ctx.org.state, b.id, ctx.project.projectId));
  const references = ctx.project.state
    ? getReferenceSlides(ctx.project.state, laneId, unitId) : [];
  const range = bibleRangeFromUnit(unitId);
  const settings = ctx.project.state ? bibleSettings(ctx.project.state, laneId) : null;
  return <View style={{ gap: space.md }}>
    {bibles.flatMap((bible) => chapters.map((chapter) => {
      const bounds = bible.id === 'berean-bsb-hays' ? bsbPassageBounds(unitId, chapter.chapter) : null;
      return <Card key={`${bible.id}:${chapter.book}:${chapter.chapter}`}>
        <Headphones color={colors.reference} />
        <Text style={text.body}>{chapter.label} · {bible.code}</Text>
        <Text style={text.small}>{bounds ? 'Passage audio' : 'Full chapter'} · {bible.narrator}</Text>
        <AudioClip project={ctx.project} hashes={[]} disabled={disabled}
          uri={sourceAudioUrl(bible, chapter,
            process.env.EXPO_PUBLIC_SOURCE_AUDIO_BASE_URL ??
              'https://pub-e5e8108b319c42069acd1ebf4fd0fb02.r2.dev')}
          {...(bounds ?? {})}
          label={`Play ${bible.name}, ${chapter.label}, ${bounds ? 'passage' : 'full chapter'}`}
          seekControls />
      </Card>;
    }))}
    {range && settings?.audioFilesetId ? <BibleBrainAudio ctx={ctx}
      unitId={unitId} filesetId={settings.audioFilesetId} disabled={disabled} /> : null}
    {references.map((item) => <Card key={item.id}>
      <Headphones color={colors.reference} />
      <Text style={text.small}>{item.label}</Text>
      <AudioClip project={ctx.project} hashes={[item.hash]}
        label={`Play ${item.label}`} disabled={disabled} seekControls />
    </Card>)}
  </View>;
}
