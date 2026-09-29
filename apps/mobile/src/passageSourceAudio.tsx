// Avatar U. Replay chapter sources and passage references beside the recorder.
import {
  SOURCE_BIBLES, sourceAudioUrl, sourceBibleEnabled, sourceChapters
} from '@langquest-next/core';
import { Text, View } from 'react-native';
import type { Ctx } from './ctx';
import { AudioClip } from './audioClip';
import { getReferenceSlides } from './passageResources';
import { Card, Ico, txt } from './kit';
import { space, TINT } from './theme';

export function PassageSourceAudio({ ctx, unitId, laneId, disabled }: {
  ctx: Ctx; unitId: string; laneId: string; disabled: boolean;
}) {
  const chapters = sourceChapters(unitId);
  const bibles = SOURCE_BIBLES.filter((b) => ctx.org.state &&
    sourceBibleEnabled(ctx.org.state, b.id, ctx.project.projectId));
  const references = ctx.project.state
    ? getReferenceSlides(ctx.project.state, laneId, unitId) : [];
  return <View style={{ gap: space.md }}>
    {bibles.flatMap((bible) => chapters.map((chapter) =>
      <Card key={`${bible.id}:${chapter.book}:${chapter.chapter}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ico name="listen" size={22} color={TINT.amberText} />
          <View style={{ flex: 1 }}>
            <Text style={txt.body}>{chapter.label} · {bible.code}</Text>
            <Text style={txt.xs}>Full chapter</Text>
          </View>
        </View>
        <AudioClip project={ctx.project} hashes={[]} disabled={disabled}
          uri={sourceAudioUrl(bible, chapter,
            process.env.EXPO_PUBLIC_SOURCE_AUDIO_BASE_URL ??
              'https://pub-e5e8108b319c42069acd1ebf4fd0fb02.r2.dev')}
          label={`Play ${bible.name}, ${chapter.label}, full chapter`}
          seekControls />
      </Card>))}
    {references.map((item) => <Card key={item.id}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="listen" size={22} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1 }]}>{item.label}</Text>
      </View>
      <AudioClip project={ctx.project} hashes={[item.hash]}
        label={`Play ${item.label}`} disabled={disabled} seekControls />
    </Card>)}
  </View>;
}
