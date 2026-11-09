import { fraction, isOpen, lineOf, type ExportItem } from '../src/org/exportModel';

/** What the admin reads of an export in the making (decisions.md 206). */
const item = (over: Partial<ExportItem>): ExportItem => ({ id: 'x', languageIds: null, status: 'running', createdAt: '2026-11-07T00:00:00Z', progress: null, sizeBytes: null, expiresAt: null, ...over });

describe('export status', () => {
  it('says where each stage stands', () => {
    expect(lineOf(item({ status: 'queued' }))).toEqual({ key: 'orgExport.waiting' });
    expect(lineOf(item({}))).toEqual({ key: 'orgExport.reading' });
    expect(lineOf(item({ progress: { phase: 'audio', filesDone: 5, filesTotal: 20, bytes: 1 } }))).toEqual({ key: 'orgExport.audio', done: 5, total: 20 });
    expect(lineOf(item({ progress: { phase: 'log', filesDone: 20, filesTotal: 20, bytes: 1 } }))).toEqual({ key: 'orgExport.log' });
    expect(lineOf(item({ status: 'ready' }))).toEqual({ key: 'orgExport.ready' });
    expect(lineOf(item({ status: 'failed' }))).toEqual({ key: 'orgExport.failed' });
    expect(lineOf(item({ status: 'expired' }))).toEqual({ key: 'orgExport.expired' });
  });

  it('measures the audio for the bar, and nothing before it', () => {
    expect(fraction(item({ progress: { phase: 'audio', filesDone: 5, filesTotal: 20, bytes: 1 } }))).toBe(0.25);
    expect(fraction(item({ progress: { phase: 'audio', filesDone: 0, filesTotal: 0, bytes: 0 } }))).toBeNull();
    expect(fraction(item({ status: 'queued' }))).toBeNull();
    expect(fraction(item({ status: 'ready' }))).toBe(1);
  });

  it('holds a new request back while one is being made', () => {
    expect(isOpen(item({ status: 'queued' }))).toBe(true);
    expect(isOpen(item({ status: 'running' }))).toBe(true);
    expect(isOpen(item({ status: 'ready' }))).toBe(false);
    expect(isOpen(undefined)).toBe(false);
  });
});
