/**
 * Test doubles and the fleet simulator (docs/fleet-simulation.md). Node
 * only: tests and `scripts/` import this; the app never does, so none of
 * it reaches the phone bundle.
 */
export * from './fakeServer';
export * from './virtualTime';
export * from './random';
export * from './shapedTransport';
export * from './fleet/links';
export * from './fleet/personas';
export * from './fleet/device';
export * from './fleet/fleet';
