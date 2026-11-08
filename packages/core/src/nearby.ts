/**
 * The nearby entry: what phones check when they share with no internet (docs/nearby-sync-plan.md
 * 5.12). Absent from `index.ts`, because the web app shares nothing nearby and its bundle carries
 * every module an entry names, used or not.
 */
export * from './nearbyChain';
export * from './nearbySigning';
export * from './nearbySend';
export * from './nearbyDoor';
export * from './nearbyHoldings';
export * from './nearbyGenerations';
export * from './nearbyFilesNamed';
