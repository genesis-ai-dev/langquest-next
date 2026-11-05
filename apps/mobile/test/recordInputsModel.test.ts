import { describe, expect, it } from 'vitest';
import { hasWords, keepInput, keepPageInput, noteInput, overrideInput, payloadField, skipInput, undoneText } from '../src/passage/recordInputsModel';
import { SAID_BY_VOICE } from '../src/passage/recordTextModel';
import { t } from '../src/i18n';

describe('what the record\'s sheets save (recordInputsModel.ts)', () => {
  it('sets a check aside with its reason, and the voice recording only when there is one', () => {
    expect(skipInput({ commandId: 'c1', unitId: 'u', kindId: 'peer', stepId: 's1', reason: { reason: 'Nobody free' } }))
      .toEqual({ commandId: 'c1', unitId: 'u', type: 'skip', kindId: 'peer', stepId: 's1', reason: 'Nobody free' });
    expect(skipInput({ commandId: 'c1', unitId: 'u', kindId: 'peer', stepId: 's1', reason: { reason: 'x', blobHash: 'h' } }))
      .toMatchObject({ type: 'skip', reasonBlobHash: 'h' });
  });

  it('moves past a checkpoint by step, not by kind', () => {
    const i = overrideInput({ commandId: 'c2', unitId: 'u', stepId: 's2', reason: { reason: 'Visit is far', blobHash: 'h' } });
    expect(i).toEqual({ commandId: 'c2', unitId: 'u', type: 'override', stepId: 's2', reason: 'Visit is far', reasonBlobHash: 'h' });
    expect('kindId' in i).toBe(false);
  });

  it('keeps a version against a review, with the sheet\'s reason', () => {
    expect(keepInput({ commandId: 'c3', unitId: 'u', reviewId: 'r1', reason: { reason: 'It is right' } }))
      .toEqual({ commandId: 'c3', unitId: 'u', type: 'keep', reviewId: 'r1', reason: 'It is right' });
  });

  it('keeps from the page with the typed reason trimmed, or "Said by voice" when it was only spoken', () => {
    expect(keepPageInput({ commandId: 'c', unitId: 'u', reviewId: 'r', text: '  fine as it is  ', hash: null }).reason).toBe('fine as it is');
    const spoken = keepPageInput({ commandId: 'c', unitId: 'u', reviewId: 'r', text: '   ', hash: 'v1' });
    expect(spoken.reason).toBe(SAID_BY_VOICE);
    expect(spoken.reasonBlobHash).toBe('v1');
    expect('reasonBlobHash' in keepPageInput({ commandId: 'c', unitId: 'u', reviewId: 'r', text: 'x', hash: null })).toBe(false);
  });

  it('notes the whole passage with trimmed words and/or a recording', () => {
    expect(noteInput({ commandId: 'n', unitId: 'u', text: ' hello ', hash: null })).toEqual({ commandId: 'n', unitId: 'u', anchor: { kind: 'passage' }, text: 'hello' });
    expect(noteInput({ commandId: 'n', unitId: 'u', text: '  ', hash: 'b' })).toEqual({ commandId: 'n', unitId: 'u', anchor: { kind: 'passage' }, blobHash: 'b' });
  });

  it('has words when there is text or a recording', () => {
    expect(hasWords('', null)).toBe(false);
    expect(hasWords('  ', null)).toBe(false);
    expect(hasWords(' a', null)).toBe(true);
    expect(hasWords('', 'h')).toBe(true);
  });

  it('reads the id an Undo needs from the first applied event', () => {
    const specs = [{ type: 'v1.DepartureMade', payload: { departureId: 'd9', requestId: 'q9' } }] as never;
    expect(payloadField(specs, 'departureId')).toBe('d9');
    expect(payloadField(specs, 'requestId')).toBe('q9');
    expect(payloadField([], 'requestId')).toBe('');
  });

  it('says what Undo undid by the kind of departure', () => {
    expect(undoneText('override')).toBe(t('passage.page.undone.override'));
    expect(undoneText('keep')).toBe(t('passage.page.undone.keep'));
    expect(undoneText('skip')).toBe(t('passage.page.undone.skip'));
  });
});
