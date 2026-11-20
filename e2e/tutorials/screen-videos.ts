// Which tutorial videos show each screen, best first: the table help mode's
// play button reads (packages/core/src/tutorialScreens.ts, LAN-244). A video
// lists a screen when two or more of its steps are on it; one step is most
// often the way through to another screen. A screen that no video spends two
// steps on lists the videos that spend the most. The video with the most
// steps on the screen comes first.
//
// npx tsx e2e/tutorials/screen-videos.ts --write   writes the table again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tutorial } from './tutorial';

export const OUT = 'packages/core/src/tutorialScreens.ts';

export function screenVideos(tutorials: Readonly<Record<string, Pick<Tutorial, 'steps'>>>): Record<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const [id, t] of Object.entries(tutorials)) {
    for (const s of t.steps) {
      const m = counts.get(s.screen) ?? new Map<string, number>();
      m.set(id, (m.get(id) ?? 0) + 1);
      counts.set(s.screen, m);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [screen, m] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const most = ranked[0]![1];
    out[screen] = ranked.filter(([, n]) => n >= 2 || n === most).map(([id]) => id);
  }
  return out;
}

export function tableSource(table: Record<string, string[]>): string {
  const lines = Object.entries(table).map(([s, ids]) => `  ${s}: [${ids.map((id) => `'${id}'`).join(', ')}]`);
  return [
    '// Written by e2e/tutorials/screen-videos.ts --write from the tutorial videos\' steps: do not edit by hand.',
    '/** The tutorial videos that show each screen, the one with the most steps on it first (LAN-244). */',
    'export const SCREEN_TUTORIALS: Readonly<Record<string, readonly string[]>> = {',
    lines.join(',\n'),
    '};',
    ''
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { TUTORIALS } = await import('./all');
  const src = tableSource(screenVideos(TUTORIALS));
  if (process.argv.includes('--write')) fs.writeFileSync(OUT, src);
  else process.stdout.write(src);
}
