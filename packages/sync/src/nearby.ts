/**
 * The nearby entry: what phones use to find each other and talk with no internet
 * (docs/nearby-sync-plan.md 5.12). Absent from `index.ts`, so the web bundle does
 * not carry it.
 */
export * from './nearbyClient';
export * from './nearbyIntake';
export * from './nearbyKeep';
export * from './nearbyLink';
export * from './nearbyOpening';
export * from './nearbyPartners';
export * from './nearbyRoom';
export * from './nearbySession';
export * from './nearbyWire';
export { isServerVerdict, type NearbyPlatform } from './nearbyUpkeep';
