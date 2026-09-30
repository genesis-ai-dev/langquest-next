import { Diagnostics, MemoryDiagStore, MemoryStore } from '@langquest-next/client';
import { applyDiagnosticsOn, DIAG_OFF_KEY, readDiagnosticsOn, saveDiagnosticsOn } from '../src/diagnosticsSetting';

// The Settings switch for field diagnostics (docs/diagnostics.md, decisions.md 39).

function phone() {
  const meta = new MemoryStore();
  const waiting = new MemoryDiagStore();
  let n = 0;
  const recorder = new Diagnostics({ store: waiting, newId: () => `d${++n}` });
  return { meta, waiting, recorder };
}

describe('diagnostics setting', () => {
  it('is on for a phone where nobody has chosen', async () => {
    // Why: the product decision is on by default, with an off switch.
    expect(await readDiagnosticsOn(new MemoryStore())).toBe(true);
  });

  it('turning it off stops recording and deletes what is waiting to be sent', async () => {
    const { meta, waiting, recorder } = phone();
    recorder.record('sync', { n: { ms: 1 }, t: { outcome: 'ok' } });
    recorder.record('sync', { n: { ms: 1 }, t: { outcome: 'ok' } });
    await recorder.settle();
    expect(await waiting.diagCount()).toBe(2);

    await saveDiagnosticsOn(meta, recorder, waiting, false);
    expect(recorder.isEnabled).toBe(false);
    expect(await waiting.diagCount()).toBe(0);
    recorder.record('sync', { n: { ms: 1 }, t: { outcome: 'ok' } });
    await recorder.settle();
    expect(await waiting.diagCount()).toBe(0);
  });

  it('survives a restart: the next launch reads the choice and applies it', async () => {
    const { meta, waiting, recorder } = phone();
    await saveDiagnosticsOn(meta, recorder, waiting, false);
    expect(await meta.meta(DIAG_OFF_KEY)).toBe('1');

    // A fresh recorder starts on; the saved choice turns it off before anything is sent.
    const after = phone();
    after.recorder.record('sync', { n: { ms: 1 }, t: { outcome: 'ok' } });
    await applyDiagnosticsOn(after.recorder, after.waiting, await readDiagnosticsOn(meta));
    expect(after.recorder.isEnabled).toBe(false);
    expect(await after.waiting.diagCount()).toBe(0);
  });

  it('turning it back on records again and is kept', async () => {
    const { meta, waiting, recorder } = phone();
    await saveDiagnosticsOn(meta, recorder, waiting, false);
    await saveDiagnosticsOn(meta, recorder, waiting, true);
    expect(await readDiagnosticsOn(meta)).toBe(true);
    recorder.record('sync', { n: { ms: 1 }, t: { outcome: 'ok' } });
    await recorder.settle();
    expect(await waiting.diagCount()).toBe(1);
  });
});
