import { always, Fleet, FLEET_EPOCH, NETWORKS, offlineBetween, TIME } from '@langquest-next/sync/src/testing';
import { cpuSince, mark, type Scenario } from './types';

/**
 * A team sets up in town, works out of reach for weeks, and comes back
 * into signal on the same morning: everyone's backlog reaches the server
 * at once (audit item 8 on the real server; here, the clients' side).
 * Read how long the backlog takes to drain, how many append calls it
 * takes, and the sync CPU while it drains. With `--audio=1` the weeks of
 * recordings go up the same links: read how long the audio takes to reach
 * the server, and whether it holds the events back.
 */
export const villageReconnect: Scenario = {
  name: 'villageReconnect',
  summary: 'Everyone offline for weeks, then back in signal on the same morning.',
  defaults: { seed: 1, passages: 1200, translators: 10, reviewers: 6, offlineDays: 14, audio: 0, audioKBps: 16 },
  async run(k) {
    const started = performance.now();
    // Back in signal at 07:00 on the morning after the offline stretch.
    const back = FLEET_EPOCH + k.offlineDays! * TIME.DAY + 7 * TIME.HOUR;
    const fleet = new Fleet({
      seed: k.seed!,
      audio: k.audio ? { bytesPerSecond: k.audioKBps! * 1000 } : null,
      crew: {
        passages: k.passages!,
        translators: k.translators!,
        reviewers: k.reviewers!,
        link: () => offlineBetween(FLEET_EPOCH + 2 * TIME.HOUR, back, always(NETWORKS.phone, 'phone'))
      }
    });
    await fleet.start();
    await fleet.time.runUntil(back);
    const pendingBefore = await pending(fleet);
    const audioBefore = fleet.audioBacklog();
    const calls = fleet.server.appendCalls;
    const cpu = mark(fleet.devices);
    let drainMinutes: number | null = null;
    let audioDrainMinutes: number | null = audioBefore === 0 ? 0 : null;
    for (let m = 1; m <= 24 * 60 && (drainMinutes === null || audioDrainMinutes === null); m++) {
      await fleet.runFor(TIME.MINUTE);
      if (drainMinutes === null && (await pending(fleet)) === 0) drainMinutes = m;
      if (audioDrainMinutes === null && fleet.audioBacklog() === 0) audioDrainMinutes = m;
    }
    const findings = {
      backlogAtReconnect: pendingBefore,
      drainMinutes,
      appendCallsToDrain: fleet.server.appendCalls - calls,
      syncCpuMsWhileDraining: cpuSince(fleet.devices, cpu),
      ...(k.audio ? { audioFilesAtReconnect: audioBefore, audioDrainMinutes } : {})
    };
    const agreement = await fleet.settle();
    return { report: fleet.report(agreement, performance.now() - started), findings };
  }
};

async function pending(fleet: Fleet): Promise<number> {
  const counts = await Promise.all(fleet.devices.map((d) => d.client.pendingCount()));
  return counts.reduce((a, b) => a + b, 0);
}
