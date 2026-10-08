// Screens added by the simple redesign (decision 71; demo ADR-037, ADR-039).
// Each is filled in by its own module; these placeholders keep the flow whole.
// Microphone setup by ear (demo MicSetup, MicPick) is simple/micSetup.tsx.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { contractsFor } from '../screenContracts';
import { MicSetupScreen } from '../simple/micSetup';

export function MicSetup(ctx: Ctx) {
  return <MicSetupScreen ctx={ctx} />;
}

export function GetReady(ctx: Ctx) {
  return <Screen header={<Header title="Get ready" onBack={ctx.back} close />}><EmptyState icon="check" title="Get the language ready" /></Screen>;
}

export const contracts = contractsFor('mic_setup', 'get_ready');
