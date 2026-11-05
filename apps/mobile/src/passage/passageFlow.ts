/** Transfer acknowledgement is independent of approval status. */
export function handoffState(input: {
  pending: number;
  online: boolean | null;
  refused: string | null;
  tooOld: boolean;
  audioStored: boolean;
}): 'blocked' | 'queued' | 'sent' {
  if (input.refused || input.tooOld) return 'blocked';
  if (input.pending > 0 || !input.audioStored || input.online !== true) {
    return 'queued';
  }
  return 'sent';
}
