// Screens added by the simple redesign (decision 71; demo ADR-037, ADR-039).
// Each is filled in by its own module; these placeholders keep the flow whole.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { contractsFor } from '../screenContracts';

export function MicSetup(ctx: Ctx) {
  return <Screen header={<Header title="Set up your microphone" onBack={ctx.back} close />}><EmptyState icon="mic" title="Microphone setup" /></Screen>;
}

// Get ‹language› ready lives in its own module (getReady.tsx).
export { GetReady } from './getReady';

export const contracts = contractsFor('mic_setup', 'get_ready');
