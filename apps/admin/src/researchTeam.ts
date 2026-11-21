/**
 * The research team as the Research page draws it before its first report:
 * each scout's subject, when it runs and its model (docs/research-team.md).
 * scripts/research-team.mjs BEATS is the source the workflow runs;
 * apps/admin/test/research.test.ts holds this list to it.
 */
export interface ResearchBeat {
  id: string;
  title: string;
  /** 'day', a day of the week (mon to sun), or 'sat-even' / 'sat-odd': every two weeks. */
  every: string;
  model: 'opus' | 'sonnet' | 'haiku';
}

export const RESEARCH_TEAM: readonly ResearchBeat[] = [
  { id: 'security', title: 'Security holes', every: 'day', model: 'sonnet' },
  { id: 'versions', title: 'New versions', every: 'day', model: 'haiku' },
  { id: 'twins', title: 'Same mistake in other places', every: 'day', model: 'opus' },
  { id: 'packages', title: 'Package health', every: 'mon', model: 'haiku' },
  { id: 'offline', title: 'Offline and sync safety', every: 'tue', model: 'sonnet' },
  { id: 'code-security', title: 'Code security and privacy', every: 'wed', model: 'sonnet' },
  { id: 'speed', title: 'Speed, size and cost', every: 'thu', model: 'sonnet' },
  { id: 'platform', title: 'Store and platform rules', every: 'fri', model: 'haiku' },
  { id: 'alternatives', title: 'Better packages', every: 'sat-even', model: 'sonnet' },
  { id: 'supply-chain', title: 'Supply chain and licenses', every: 'sat-odd', model: 'haiku' }
];
