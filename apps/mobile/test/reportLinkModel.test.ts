import { parseReportLink, reportLink } from '../src/passage/reportLinkModel';

describe("a report's Open link (UI audit, finding 113)", () => {
  it('opens the reported version or review whole, though its id holds colons', () => {
    // Why: take and review ids are `take:<command>` and `review:<command>`, so splitting on every colon
    // opened a version called "take" instead of the one reported.
    expect(parseReportLink(reportLink('version', 'take:5f2c:0'))).toEqual({ kind: 'version', id: 'take:5f2c:0' });
    expect(parseReportLink(reportLink('review', 'review:9a1b'))).toEqual({ kind: 'review', id: 'review:9a1b' });
    expect(parseReportLink('version:take:5f2c')).toEqual({ kind: 'version', id: 'take:5f2c' });
  });

  it('opens nothing for a link it cannot read', () => {
    for (const bad of [undefined, '', 'version', 'version:', 'note:n1', 'take:5f2c']) expect(parseReportLink(bad), String(bad)).toBeNull();
  });
});
