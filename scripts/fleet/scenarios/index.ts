import { normalDay } from './normalDay';
import { reducerBump } from './reducerBump';
import { slowLink } from './slowLink';
import { villageReconnect } from './villageReconnect';
import type { Scenario } from './types';

export const SCENARIOS: Record<string, Scenario> = { normalDay, villageReconnect, reducerBump, slowLink };
