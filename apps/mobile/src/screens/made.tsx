// Something made from a version (decisions.md 147; demo branch
// caleb-written-translations wMadeRead), opened from the passage's Reviews by
// version and from a version's page. It loads the first time someone opens
// one, as the screens most people never open do (decisions.md 123): a team
// that only records never fetches it.
import type { Ctx } from '../shell/ctx';
import { contractsFor } from '../shell/screenContracts';
import { MadeDetail as MadeDetailScreen } from '../writing/MadeDetail';

export function MadeDetail(ctx: Ctx) {
  return <MadeDetailScreen {...ctx} />;
}

export const contracts = contractsFor('made_detail');
