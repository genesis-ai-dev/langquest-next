// The picture of a screen for a display fix of the agent team (docs/agent-team.md).
// The picture job of .github/workflows/user-issues.yml runs the manager's steps
// to the screen twice, without the change and with it, and each run keeps one
// picture: PICTURE_DIR/<PICTURE_NAME>.jpg. The world is the suite's fixture
// world, so a picture never shows a person's work. JPEG, so the two fit in
// what the Worker takes (scripts/agent-team.mjs PICTURES).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

/** Keep the picture of the page, or of one part of it, as it is now. Outside the picture job it does nothing. */
export async function takePicture(target: Page | Locator): Promise<void> {
  const dir = process.env['PICTURE_DIR'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const name = process.env['PICTURE_NAME'] === 'after' ? 'after' : 'before';
  await target.screenshot({ path: path.join(dir, `${name}.jpg`), type: 'jpeg', quality: 70, animations: 'disabled' });
}
