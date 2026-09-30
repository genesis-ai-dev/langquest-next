import type { LaneReport } from '@langquest-next/core';

export interface Organization {
  orgId: string;
  name: string;
}

/** One language's stored report, as row-level security lets this person read it. */
export interface LaneRow {
  orgId: string;
  projectId: string;
  laneId: string;
  /** When the server last folded it. */
  updatedAt: string;
  report: LaneReport;
}

/** One day's point on a language's progress line. */
export interface LaneDay {
  day: string;
  total: number;
  recorded: number;
  done: number;
}
