/**
 * A report's Open (UI audit, finding 113) reaches the passage screen as one
 * param, `<kind>:<id>`, and the screen opens the reported version or review
 * over its passage. Take and review ids hold colons themselves
 * (`take:<command>`), so only the first colon separates the kind.
 */
export type ReportLink = { kind: 'version' | 'review'; id: string };

export function reportLink(kind: ReportLink['kind'], id: string): string {
  return `${kind}:${id}`;
}

export function parseReportLink(param: string | undefined): ReportLink | null {
  if (!param) return null;
  const at = param.indexOf(':');
  if (at < 0) return null;
  const kind = param.slice(0, at);
  const id = param.slice(at + 1);
  return (kind === 'version' || kind === 'review') && id ? { kind, id } : null;
}
