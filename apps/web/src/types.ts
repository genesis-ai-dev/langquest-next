import type { LaneReport } from '@langquest-next/core';

export interface Organization {
  orgId: string;
  name: string;
}

/** What `GET /api/orgs/:org/reports` returns: the languages this person may see. */
export interface OrgReportsResponse {
  rows: { projectId: string; laneId: string; report: LaneReport }[];
  /** When the dashboard's server last caught up with the log, ISO. */
  asOf: string;
}

/** One language's report, as the page holds it. */
export interface LaneRow {
  orgId: string;
  projectId: string;
  laneId: string;
  /** When the server last caught up with the log (the response's `asOf`). */
  updatedAt: string;
  report: LaneReport;
}
