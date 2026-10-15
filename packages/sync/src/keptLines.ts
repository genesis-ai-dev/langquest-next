import {
  derivePassage, eventPassage, languageLines, passageInMemory, passageLine, stateRevision, withoutParts,
  type AnyEvent, type LanguageState, type PassageLine, type PassageLines, type PassageOf
} from '@langquest-next/core';
import { KeptLanguage, LINE, PART_KINDS, RECORD_KINDS } from './keptLanguage';
import type { EventStore, KeptRecord, WriteBatch } from './types';

/** Passages worked out per read from disk: a bounded slice of the language in memory at once. */
const LINES_PER_BATCH = 25;

/** What is still to work out, kept beside the checkpoint so a pruned log never leaves a line behind. */
interface Owed {
  /** The build and settings the kept lines were worked out under (`KeptLines.stamp`); absent when no line was ever kept. */
  settings?: string;
  /** Every line is owed (no lines yet, or the settings changed). */
  all: boolean;
  dirty: string[];
  unplaced: PassageOf[];
}

/**
 * One line per passage for a language kept on disk (decisions.md 109):
 * what Map, Progress, My Work and the Inbox read instead of every
 * passage's record. Lines are kept as rows beside the passages and held in
 * memory whole (a few hundred bytes a passage).
 *
 * A line is core's own reading of its passage (`passageLine`), worked out
 * from that passage's rows and memory, so it cannot disagree with the
 * passage's screen. An event marks its passage's line owed; a change to
 * the flow, its kinds or the teams marks every line owed, and so does a new
 * build of the app, whose code may read a passage differently. What is owed is
 * written beside each checkpoint, since the checkpoint prunes the events
 * that would otherwise say so after a restart.
 */
export class KeptLines {
  private readonly lines = new Map<string, PassageLine>();
  private readonly dirty = new Set<string>();
  private unplaced: PassageOf[] = [];
  private all = false;
  private settings: string | undefined;
  /** Passages being worked out now: still owed if a checkpoint is written meanwhile. */
  private inFlight = new Set<string>();
  private defaults = { settings: '', template: null as PassageLine | null, byUnit: new Map<string, PassageLine>() };
  private current: PassageLines;
  private running: Promise<boolean> | null = null;
  private again = false;

  constructor(
    private readonly store: EventStore,
    private readonly orgId: string,
    private readonly streamId: string,
    private readonly kept: KeptLanguage,
    /** Writes go through the sync client's single writer. */
    private readonly commit: (batch: WriteBatch) => Promise<void>,
    private readonly live: () => LanguageState,
    /** The app's build: lines kept by another build are all owed. */
    private readonly appBuild = ''
  ) {
    this.current = this.makeView();
  }

  /** What every line was worked out under: this build, and the settings every line depends on. */
  private stamp(state: LanguageState): string {
    return `${this.appBuild}|${settingsStamp(state)}`;
  }

  /** The key the owed lines are kept under, beside the checkpoint. */
  owedKey(): string {
    return `linesOwed:${this.orgId}/${this.streamId}`;
  }

  /** Read the kept lines and what is owed. */
  async open(): Promise<void> {
    this.lines.clear();
    for (const row of await this.store.keptAll(this.orgId, this.streamId, LINE)) this.lines.set(row.unitId, JSON.parse(row.json) as PassageLine);
    let owed: Owed | null = null;
    try { owed = JSON.parse((await this.store.meta(this.owedKey())) || 'null') as Owed | null; } catch { owed = null; }
    if (!owed?.settings) this.all = true;
    else {
      this.settings = owed.settings;
      if (owed.all) this.all = true;
      for (const u of owed.dirty) this.dirty.add(u);
      this.unplaced.push(...owed.unplaced);
    }
    this.current = this.makeView();
  }

  /** What `open` reads back: written in the same commit as a checkpoint. */
  owed(): Record<string, string> {
    const owed: Owed = {
      ...(this.settings !== undefined ? { settings: this.settings } : {}),
      all: this.all, dirty: [...new Set([...this.dirty, ...this.inFlight])], unplaced: this.unplaced
    };
    return { [this.owedKey()]: JSON.stringify(owed) };
  }

  /** These events were folded: their passages' lines are owed. */
  touched(state: LanguageState, events: Iterable<AnyEvent>): void {
    for (const e of events) {
      const of = eventPassage(e);
      if (of === null) continue;
      // A settings event changes the stamp `refresh` compares; nothing to mark.
      if (of === 'settings') continue;
      const unitId = passageInMemory(state, of);
      if (unitId) this.dirty.add(unitId);
      else this.unplaced.push(of);
    }
  }

  /** Everything is owed: a fresh snapshot, a refold that undid an event. */
  invalidate(): void {
    this.all = true;
  }

  /** The lines as they stand: a new object whenever any changed. */
  view(): PassageLines {
    return this.current;
  }

  /**
   * Work out the owed lines and write them. Resolves to whether any line
   * changed. One run at a time; a call during a run runs again after it.
   */
  refresh(): Promise<boolean> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let changed = false;
      try {
        do {
          this.again = false;
          if (await this.once()) changed = true;
        } while (this.again || this.owes());
      } finally {
        this.running = null;
      }
      return changed;
    })();
    return this.running;
  }

  private owes(): boolean {
    return this.all || this.dirty.size > 0 || this.unplaced.length > 0 || this.settings !== this.stamp(this.live());
  }

  private async once(): Promise<boolean> {
    const live = this.live();
    const stamp = this.stamp(live);
    let units: string[];
    if (this.all || stamp !== this.settings) {
      this.all = false;
      this.dirty.clear();
      this.unplaced = [];
      const every = new Set([...this.lines.keys(), ...await this.store.keptUnits(this.orgId, this.streamId, PART_KINDS), ...languageLines(live).worked()]);
      units = [...every];
    } else {
      const unplaced = this.unplaced;
      this.unplaced = [];
      for (const of of unplaced) {
        const u = await this.kept.passageOf(live, of);
        if (u) this.dirty.add(u);
      }
      units = [...this.dirty];
      this.dirty.clear();
    }
    for (const u of units) this.inFlight.add(u);
    try {
      // A passage whose whole record is in memory reads off memory; the rest read their rows.
      const whole = languageLines(live);
      const fresh = await this.work(live, units.filter((u) => !this.kept.isWhole(u)), this.streamId);
      for (const u of units) if (this.kept.isWhole(u)) fresh.set(u, whole.get(u));
      const rows: KeptRecord[] = [];
      let changed = false;
      for (const [u, line] of fresh) {
        const was = this.lines.get(u);
        if (was && JSON.stringify(was) === JSON.stringify(line)) continue;
        this.lines.set(u, line);
        rows.push(lineRow(line));
        changed = true;
      }
      this.settings = stamp;
      for (const u of units) this.inFlight.delete(u);
      await this.commit({ meta: this.owed(), ...(rows.length ? { kept: { orgId: this.orgId, streamId: this.streamId, upsert: rows } } : {}) });
      if (changed || settingsStamp(live) !== this.defaults.settings) this.current = this.makeView();
      return changed;
    } catch (err) {
      // Owed again; the next change tries once more.
      for (const u of units) { this.inFlight.delete(u); this.dirty.add(u); }
      throw err;
    }
  }

  /**
   * Work out these passages' lines from memory and the rows kept under
   * `streamId` (a fresh snapshot's, before it is switched in), a slice at a
   * time.
   */
  async work(live: LanguageState, units: readonly string[], streamId: string): Promise<Map<string, PassageLine>> {
    const out = new Map<string, PassageLine>();
    if (units.length === 0) return out;
    const recorded = new Set(await this.store.keptUnits(this.orgId, streamId, ['recording']));
    for (let i = 0; i < units.length; i += LINES_PER_BATCH) {
      const batch = units.slice(i, i + LINES_PER_BATCH);
      const view = await this.kept.view(live, batch, RECORD_KINDS, streamId);
      const lines = languageLines(view);
      for (const u of batch) {
        const line = lines.get(u);
        out.set(u, line.worked || !recorded.has(u) ? line : { ...line, worked: true });
      }
    }
    return out;
  }

  /** Lines for a fresh snapshot, written under the stream its rows wait in until its checkpoint switches them in. */
  async build(lite: LanguageState, streamId: string): Promise<Record<string, string>> {
    const units = await this.store.keptUnits(this.orgId, streamId, PART_KINDS);
    const rows: KeptRecord[] = [];
    const flush = async () => {
      if (rows.length) await this.store.commit({ kept: { orgId: this.orgId, streamId, upsert: rows.splice(0) } });
    };
    for (let i = 0; i < units.length; i += LINES_PER_BATCH * 8) {
      for (const line of (await this.work(lite, units.slice(i, i + LINES_PER_BATCH * 8), streamId)).values()) rows.push(lineRow(line));
      await flush();
    }
    // What the switch writes beside the checkpoint: nothing owed.
    const owed: Owed = { settings: this.stamp(lite), all: false, dirty: [], unplaced: [] };
    this.lines.clear();
    this.dirty.clear();
    this.unplaced = [];
    this.all = false;
    return { [this.owedKey()]: JSON.stringify(owed) };
  }

  /**
   * A passage whose line is owed but whose whole record is in memory (the
   * one on screen, or one never written to disk) reads off memory at once,
   * so a list never shows it behind what the screen shows.
   */
  private makeView(): PassageLines {
    const lines = this.lines;
    const owedNow = (unitId: string) => (this.dirty.has(unitId) || this.inFlight.has(unitId)) && this.kept.isWhole(unitId);
    return {
      get: (unitId) => (owedNow(unitId) ? languageLines(this.live()).get(unitId) : lines.get(unitId) ?? this.fallback(unitId)),
      worked: () => {
        const owed = [...this.dirty, ...this.inFlight].filter((u) => !lines.has(u) && this.kept.isWhole(u));
        return owed.length ? new Set([...lines.keys(), ...owed]).values() : lines.keys();
      }
    };
  }

  /** The line of a passage with nothing on its record: the same for every such passage but its id. */
  private fallback(unitId: string): PassageLine {
    const live = this.live();
    const stamp = settingsStamp(live);
    if (this.defaults.settings !== stamp || !this.defaults.template) {
      this.defaults = { settings: stamp, template: passageLine(derivePassage(withoutParts(live), '')), byUnit: new Map() };
    }
    let line = this.defaults.byUnit.get(unitId);
    if (!line) this.defaults.byUnit.set(unitId, (line = { ...this.defaults.template!, unitId }));
    return line;
  }
}

function lineRow(line: PassageLine): KeptRecord {
  return { kind: LINE, id: line.unitId, unitId: line.unitId, ref: '', json: JSON.stringify(line) };
}

/**
 * What every line depends on beyond its own passage: the flow, its steps
 * and kinds, which steps take shared links, and the review teams. A change
 * here owes every line.
 */
export function settingsStamp(state: LanguageState): string {
  const revision = stateRevision(state);
  const hit = stamps.get(state);
  if (hit && hit.revision === revision) return hit.stamp;
  const stamp = stampOf(state);
  stamps.set(state, { revision, stamp });
  return stamp;
}

const stamps = new WeakMap<LanguageState, { revision: number; stamp: string }>();

function stampOf(state: LanguageState): string {
  const text = JSON.stringify([state.flow, state.flowSteps, state.removedSteps, state.reviewKinds, state.stepLinks ?? null, state.teams]);
  // Two 32-bit FNV-1a hashes, so a stamp is short and a collision is out of the question in practice.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}
