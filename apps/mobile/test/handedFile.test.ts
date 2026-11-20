import { readFileSync } from 'node:fs';
import { CARRIED_FILE_TYPE } from '@langquest-next/core';
import { handedFileNow, holdHandedFile, receiveHandedFile, subscribeHandedFile, takeHandedFile } from '../src/nearby/handedFile.android';
import { isHandedFile, openForHandedFile } from '../src/nearby/handedFileModel';

// The install file a carrier's browser hands the app with its Open (docs/nearby-sync-plan.md 14.4;
// docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended 2026-11-20). On an Android 14
// emulator Chrome 113's Open sent VIEW content://media/external/downloads/<n> with the type.

describe('a file the browser hands the app', () => {
  it('is a content address, which only the app\'s own file type brings', () => {
    expect(isHandedFile('content://media/external/downloads/1000000024')).toBe(true);
    expect(isHandedFile('content://com.android.chrome.FileProvider/downloads/r21-l1-p1-401de22e.carried')).toBe(true);
    for (const url of ['https://next.langquest.org/invite/abc', 'langquestnext://invite/abc', 'file:///sdcard/Download/r21-l1-p1-401de22e.carried', 'content:', '']) {
      expect(isHandedFile(url), url).toBe(false);
    }
  });

  it('comes only through app.json\'s filter for core\'s type, on content addresses, which the disguise copies onto its aliases', () => {
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as { expo: { android: { intentFilters: { action: string; data: { scheme?: string; mimeType?: string; host?: string }[]; category: string[] }[] } } };
    const typed = app.expo.android.intentFilters.filter((f) => f.data.some((d) => d.mimeType));
    expect(typed).toEqual([{ action: 'VIEW', data: [{ scheme: 'content', mimeType: CARRIED_FILE_TYPE }], category: ['DEFAULT'] }]);
    // No other filter takes a content address, so a content link is always this one.
    expect(app.expo.android.intentFilters.flatMap((f) => f.data).filter((d) => d.scheme === 'content')).toHaveLength(1);
    const plugin = readFileSync(new URL('../plugins/withAndroidAppIcons.js', import.meta.url), 'utf8');
    expect(plugin).toContain('Every VIEW filter of .MainActivity is copied onto each alias.');
  });

  it('is held until Download the install file takes it, once', () => {
    let told = 0;
    const off = subscribeHandedFile(() => { told++; });
    expect(receiveHandedFile('https://next.langquest.org/invite/abc')).toBe(false);
    expect(handedFileNow()).toBeNull();
    expect(receiveHandedFile('content://media/external/downloads/1')).toBe(true);
    // A second before the first is taken replaces it.
    holdHandedFile('content://media/external/downloads/2');
    expect(handedFileNow()).toBe('content://media/external/downloads/2');
    expect(takeHandedFile()).toBe('content://media/external/downloads/2');
    expect([handedFileNow(), takeHandedFile()]).toEqual([null, null]);
    expect(told).toBe(3);
    off();
  });
});

describe('opening Download the install file for it', () => {
  const base = { held: true, signedIn: true, ready: true, screen: 'my_work' as const };
  it('opens once someone signed in is past signing in', () => {
    expect(openForHandedFile(base)).toBe(true);
    expect(openForHandedFile({ ...base, screen: 'share_nearby' })).toBe(true);
  });
  it('waits for a file, a session, the navigator and routing, and stays on that screen when it shows', () => {
    expect(openForHandedFile({ ...base, held: false })).toBe(false);
    expect(openForHandedFile({ ...base, signedIn: false })).toBe(false);
    expect(openForHandedFile({ ...base, ready: false })).toBe(false);
    expect(openForHandedFile({ ...base, screen: 'sign_in' })).toBe(false);
    expect(openForHandedFile({ ...base, screen: 'get_install_file' })).toBe(false);
  });
});
