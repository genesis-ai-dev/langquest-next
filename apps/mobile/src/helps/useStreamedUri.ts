// A file from another language's stream (helps/helps.tsx, OtherVoice): from
// this phone when it is here, else streamed from the server when asked.
import { useState } from 'react';
import type { BlobFile } from '../sync/blobs';
import type { Ctx } from '../shell/ctx';
import { streamUrl } from '../server/blobTransport';
import { countAudio } from '../audio/audioTally';

export function useStreamedUri(ctx: Ctx, languageId: string, ref: BlobFile) {
  const [uri, setUri] = useState<string | null>(() => ctx.language.blobs.uriFor(ref));
  /** Ask the server for the file; the uri follows when it answers. A refusal is counted under the language asked. */
  const stream = () => streamUrl(ctx.language.orgId, languageId, ref).then(setUri, (e: unknown) => {
    countAudio({ orgId: ctx.language.orgId, languageId }, 'streamFail');
    throw e;
  });
  return { uri, stream };
}
