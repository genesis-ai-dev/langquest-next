import { headersOf } from '../src/server/textFetch';

describe('headers read back from XMLHttpRequest (server/textFetch.ts)', () => {
  it('keeps every header, a value with a colon whole, and skips blank lines', () => {
    const h = headersOf('content-type: application/json\r\ncontent-range: 0-24/*\r\nx-time: 12:30:00\r\n\r\n');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('content-range')).toBe('0-24/*');
    expect(h.get('x-time')).toBe('12:30:00');
  });
});
