import { fiveInRoom } from './fiveInRoom';
import { lostPhone } from './lostPhone';
import { nearbyCarry } from './nearbyCarry';
import { nearbyNewcomer } from './nearbyNewcomer';
import { nearbyTown } from './nearbyTown';
import { normalDay } from './normalDay';
import { reducerBump } from './reducerBump';
import { refoldTriggers } from './refoldTriggers';
import { slowLink } from './slowLink';
import { villageMonth } from './villageMonth';
import { villageReconnect } from './villageReconnect';
import { wrongDate } from './wrongDate';
import type { Scenario } from './types';

export const SCENARIOS: Record<string, Scenario> = { normalDay, villageReconnect, reducerBump, slowLink, refoldTriggers, villageMonth, fiveInRoom, wrongDate, lostPhone, nearbyCarry, nearbyTown, nearbyNewcomer };
