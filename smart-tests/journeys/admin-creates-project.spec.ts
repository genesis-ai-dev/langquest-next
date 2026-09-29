// Avatar P, decision 28: an org admin creates a project, which is one
// language. Judged on the device logs (org and the new project) and the
// server: one ProjectRegistered, a ProjectCreated and exactly one LaneAdded.
import { expect, test } from '@playwright/test';
import { reportRun, runJev } from '../driver';
import { deviceLog, serverEvents, settle } from '../evidence';
import { createProject } from '../goals';
import { accountForDriver, judgeNewProject, registeredProjectId } from '../outcome';
import { openAs, seedTranslatorWorld } from '../world';

test('admin creates a project with its one language', async ({ page }) => {
  const world = await seedTranslatorWorld();
  await openAs(page, world, world.owner);
  const contract = { adminId: world.owner.id, name: 'Mark in Dinka', languoidId: 'din' };

  const run = await runJev(page, createProject(contract.name, contract.languoidId), { timeoutMs: 120_000, maxDecisions: 30 });

  const read = async () => {
    const org = await deviceLog(page, world.orgId, '_org');
    const projectId = registeredProjectId(contract, org);
    return {
      org,
      device: projectId ? await deviceLog(page, world.orgId, projectId) : [],
      // Not yet on the server reads as empty: judged as not synced, never as a pass.
      server: projectId ? await serverEvents(projectId).catch(() => []) : []
    };
  };
  const evidence = await settle(read, (e) => judgeNewProject(contract, e).verdict === 'passed', 45_000);
  const outcome = accountForDriver(judgeNewProject(contract, evidence), run.status);
  await reportRun(page, run, outcome);
  expect(outcome.verdict, 'inconclusive means Jev never created a project; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
