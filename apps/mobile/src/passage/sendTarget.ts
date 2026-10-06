// Send to the usual reviewer (ADR-029, REC-3): where a kind usually goes in
// a language, and whether a request is for the person looking. Core owns
// the rules (`usualTarget`, `requestIsFor`, `requestAddresseeName`, and
// `commands.ask` with a `teamId`, emitting v2.RequestMade); the app adds who
// may review here, from the org's roles, which core does not hold.
import {
  requestIsFor, usualTarget,
  type Commands, type OrgState, type PartitionState, type UsualTarget
} from '@langquest-next/core';
import { holdsIn, type MineFn } from './record';

export type { UsualTarget };

/** Where `kindId` usually goes in this language, as `me` would send it; undefined when nobody usually does it. */
export function usualTargetFor(state: PartitionState, org: OrgState | null, o: { partitionId: string; laneId: string; kindId: string; me: string }): UsualTarget | undefined {
  const target = { partitionId: o.partitionId, laneId: o.laneId };
  return usualTarget(state, o.laneId, o.kindId, o.me, { eligible: (id) => holdsIn(state, org, id, target, 'review') });
}

/** Is a request for `me`: to them, or to a review team they are on. */
export function requestIsMine(state: PartitionState, me: string): MineFn {
  return (r) => requestIsFor(state, r, me);
}

/** A review team's name, for "Waiting on the Community team". */
export function teamNameIn(state: PartitionState): (teamId: string) => string | undefined {
  return (teamId) => state.teams[teamId]?.name.value || undefined;
}

/** The ask command's input for sending a kind to its usual target: a team (open to every member) or one person. */
export function sendToInput(o: { commandId: string; unitId: string; laneId: string; kindId: string; target: UsualTarget }): Parameters<Commands['ask']>[0] {
  const base = { commandId: o.commandId, unitId: o.unitId, laneId: o.laneId, what: 'review' as const, kindId: o.kindId };
  return 'teamId' in o.target ? { ...base, teamId: o.target.teamId } : { ...base, profileId: o.target.profileId };
}
