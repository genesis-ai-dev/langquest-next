import { useEffect, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { diagnosticsEnabled, setDiagnosticsEnabled } from '../diagnostics/diagnostics';
import { failureMessage as failure } from '../diagnostics/report';

/** The diagnostics switch: the saved choice once read (null until then), flipped at once and put back if saving fails. */
export function useDiagnosticsSwitch(ctx: Ctx): { on: boolean | null; toggle: () => void } {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void diagnosticsEnabled().then((v) => { if (active) setOn(v); });
    return () => { active = false; };
  }, []);
  function toggle() {
    if (on === null) return;
    const next = !on;
    setOn(next);
    void setDiagnosticsEnabled(next).catch((e: unknown) => {
      setOn(!next);
      ctx.toast(failure('diagnostics setting', e), 'problem');
    });
  }
  return { on, toggle };
}
