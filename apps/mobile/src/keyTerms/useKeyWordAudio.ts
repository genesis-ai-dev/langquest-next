// A list word's meaning read aloud (decision 172): FIA's recordings stay on
// FIA's server and play from there when tapped, as guide audio does
// (study/useStudyAudio.ts); a list that keeps its recordings in the blob
// store has them fetched on the first tap, not before, to spare field data.
// Its length is the document's own `seconds`, else what the recording says
// once it has loaded; nothing until then, never a guess.
import type { MediaRef } from '@langquest-next/core';
import { useEffect, useRef, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { mediaFile } from '../study/guideMatch';
import { useStudyAudio } from '../study/useStudyAudio';
import { useStudyFileUri } from '../study/useStudyFileUri';

export function useKeyWordAudio(ctx: Ctx, audio: MediaRef | undefined): {
  /** The word has a recording. */
  has: boolean;
  playing: boolean;
  /** Seconds played. */
  time: number;
  /** Seconds long, once known. */
  length: number | null;
  /** It could not be played (offline, or the file is gone). */
  failed: boolean;
  /** Fetching the file after the first tap. */
  waiting: boolean;
  toggle: () => void;
  pause: () => void;
} {
  const [asked, setAsked] = useState(false);
  // From the blob store only when there is no address to play from, and only once asked for.
  const file = asked && !audio?.url ? mediaFile(audio, 'audio', false) : undefined;
  const { uri, waiting, failed: notHere } = useStudyFileUri(ctx.language.orgId, file, audio?.url);
  const player = useStudyAudio(uri, 0);
  const pending = useRef(false);
  const play = player.play;
  useEffect(() => {
    if (!pending.current || !uri) return;
    pending.current = false;
    play();
  }, [uri, play]);
  const pause = player.pause;
  useEffect(() => () => pause(), []); // eslint-disable-line react-hooks/exhaustive-deps -- pause reads only refs, so the first draw's copy is enough on unmount
  const toggle = () => {
    setAsked(true);
    if (!uri && audio?.hash) { pending.current = true; return; }
    player.toggle();
  };
  const length = audio?.seconds ?? (!player.simulated && player.duration > 0 ? player.duration : null);
  return {
    has: !!(audio?.url || audio?.hash), playing: player.playing, time: player.time, length,
    failed: player.failed || notHere, waiting: asked && waiting, toggle, pause
  };
}
