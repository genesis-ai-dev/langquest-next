import { handoffState } from '../src/passageFlow';

describe('honest hand-off feedback', () => {
  const sent = { pending: 0, online: true, refused: null, tooOld: false, audioStored: true };
  it('requires acknowledged events and audio before showing sent', () => {
    expect(handoffState(sent)).toBe('sent');
    expect(handoffState({ ...sent, pending: 1 })).toBe('queued');
    expect(handoffState({ ...sent, audioStored: false })).toBe('queued');
    expect(handoffState({ ...sent, online: null })).toBe('queued');
    expect(handoffState({ ...sent, online: false })).toBe('queued');
  });
  it('distinguishes refusal and upgrade requirements from offline queues', () => {
    expect(handoffState({ ...sent, refused: 'membership removed' })).toBe('blocked');
    expect(handoffState({ ...sent, tooOld: true })).toBe('blocked');
  });
});
