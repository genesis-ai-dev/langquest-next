import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { EmptyState, GhostBtn, PrimaryBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { reportError } from '../diagnostics/report';
import { allowStorage, onStoreFailure } from '../storage/store';
import { startTab, type TabDeps, type TabState } from './tabLock';
import { tabBusy } from './tabBusy';
import { C, space } from '../ui/theme';

const WEB = Platform.OS === 'web';

const MOVED_KEY = 'langquest-moved';
/** Set when a failed first open reloaded the page, so it reloads only once before the error screen. */
const REOPEN_KEY = 'langquest-reopen';
/**
 * The page before this one (a reload, or another tab that just handed the
 * database over) lets go of its lock with the page, but the browser can take
 * a moment longer to stop its SQLite worker and free its file handles; an
 * open at once can find them still held (seen on CI's Linux Chromium under
 * load). Wait this long after a takeover before opening, and after a failed
 * first open before reloading.
 */
const SETTLE_MS = 1500;
/** A failure this soon after storage may open is taken for the page before still letting go. */
const FIRST_OPEN_MS = 30_000;

/** True when the flag is set, or was just set; false without session storage, so a page never reloads without end. */
function reopenFlag(op: 'get' | 'set' | 'clear'): boolean {
  try {
    if (op === 'get') return sessionStorage.getItem(REOPEN_KEY) === '1';
    if (op === 'set') { sessionStorage.setItem(REOPEN_KEY, '1'); return true; }
    sessionStorage.removeItem(REOPEN_KEY);
  } catch { /* no session storage: the error screen's Try again still works */ }
  return false;
}

/** When this page let storage open (store.ts), and whether a failure has already sent it to reload. */
let openedAt: number | null = null;
let reloading = false;
function openStorage(): void {
  openedAt = Date.now();
  allowStorage();
}

/** A failed first open reloads once, after the page before has had time to let go; true when it will. */
function reopenOnce(): boolean {
  if (reloading) return true;
  if (openedAt === null || Date.now() - openedAt > FIRST_OPEN_MS) return false;
  if (reopenFlag('get') || !reopenFlag('set')) return false;
  reloading = true;
  setTimeout(() => window.location.reload(), SETTLE_MS);
  return true;
}

function browserTab(): TabDeps | null {
  if (!WEB || typeof navigator === 'undefined' || !navigator.locks || typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel('langquest-tabs');
  return {
    request: async (name, opts, callback) => { await navigator.locks.request(name, opts, callback); },
    busy: tabBusy,
    post: (m) => channel.postMessage(m),
    listen: (handler) => {
      const on = (e: MessageEvent) => handler(String(e.data));
      channel.addEventListener('message', on);
      return () => channel.removeEventListener('message', on);
    },
    movedFlag: {
      get: () => { try { return sessionStorage.getItem(MOVED_KEY) === '1'; } catch { return false; } },
      set: () => { try { sessionStorage.setItem(MOVED_KEY, '1'); } catch { /* the reload still frees the pool */ } },
      clear: () => { try { sessionStorage.removeItem(MOVED_KEY); } catch { /* nothing kept */ } }
    },
    reload: () => window.location.reload()
  };
}

interface TabControl {
  state: TabState;
  listeners: Set<(s: TabState) => void>;
  useHere(): void;
  cancel(): void;
}
const TAB_KEY = '__langquestTabLock';

/**
 * One lock per page, however often the gate mounts. The lock is held for the
 * page's life, so a gate mounted again in the same page (Fast Refresh remounts
 * it in development) must not ask for it again: it would find it taken, by
 * itself, and say LangQuest is open in another tab. Kept on the page's global
 * object so a reloaded module finds it too.
 */
function tabControl(): TabControl | null {
  const g = globalThis as { [TAB_KEY]?: TabControl };
  if (g[TAB_KEY]) return g[TAB_KEY];
  const deps = browserTab();
  if (!deps) return null;
  const control: TabControl = { state: 'checking', listeners: new Set(), useHere: () => {}, cancel: () => {} };
  const lock = startTab(deps, (s) => {
    control.state = s;
    for (const l of control.listeners) l(s);
  });
  control.useHere = lock.useHere;
  control.cancel = lock.cancel;
  g[TAB_KEY] = control;
  return control;
}

/**
 * Ask the browser to keep this site's files when space runs low (it may say
 * no; Chrome grants it to sites people use, Safari after the site is added
 * to the home screen). Without it, a browser can clear the database and
 * recordings like a cache.
 */
function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
}

/**
 * Nothing opens the device's storage until this says so (store.ts). On the
 * web that waits for this tab to hold the database (tabLock.ts); a phone
 * goes straight through. Either way, storage that will not open is a screen
 * with a code and a way to try again, not a spinner that never ends.
 */
export function StorageGate(props: { children: ReactNode }) {
  const [tab, setTab] = useState<TabState>(WEB ? 'checking' : 'ready');
  const [actions, setActions] = useState<{ useHere(): void; cancel(): void } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /**
   * Reported once until Try again. Reporting writes a diagnostic, and on the
   * web the diagnostics file waits on the event log (store.ts), so the write
   * fails the same way and calls back here: reporting every call gave the
   * screen a new code many times a second (a private Safari window).
   */
  const reported = useRef(false);

  useEffect(() => onStoreFailure((e) => {
    // Right after a reload or a takeover the page before may still hold the files: reload once and open again.
    if (WEB && reopenOnce()) return;
    if (reported.current) return;
    reported.current = true;
    setFailure(reportError('open storage', e));
  }), []);

  useEffect(() => {
    if (!WEB) return;
    const control = tabControl();
    if (!control) {
      // No Web Locks (an old browser): open as before.
      setTab('ready');
      return;
    }
    setTab(control.state);
    control.listeners.add(setTab);
    setActions({ useHere: control.useHere, cancel: control.cancel });
    return () => { control.listeners.delete(setTab); };
  }, []);

  const last = useRef<TabState>(tab);
  useEffect(() => {
    const prev = last.current;
    last.current = tab;
    if (tab !== 'ready') return;
    if (!WEB) { allowStorage(); return; }
    keepStorage();
    // Taken over just now: give the other tab's files a moment to be let go of.
    const delay = prev === 'waiting' ? SETTLE_MS : 0;
    const open = delay ? setTimeout(openStorage, delay) : (openStorage(), undefined);
    // Open a while without failing: a later failure is a new one, and may reload once again.
    const settled = setTimeout(() => { if (!reloading) reopenFlag('clear'); }, delay + FIRST_OPEN_MS);
    return () => { clearTimeout(open); clearTimeout(settled); };
  }, [tab]);

  if (failure) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, flexGrow: 1, justifyContent: 'center', backgroundColor: C.bg }}>
        <Text style={txt.h2} accessibilityRole="header">{t('entry.storage.title')}</Text>
        <Text style={txt.body}>{WEB ? t('entry.storage.webBody') : t('entry.storage.phoneBody')}</Text>
        <Text style={txt.smMuted} selectable>{t('entry.storage.code', { code: failure })}</Text>
        <PrimaryBtn label={t('common.tryAgain')} icon="restart" help={t('help.details.tryAgain')} onPress={() => {
          if (WEB) window.location.reload();
          else { reported.current = false; setFailure(null); setAttempt((n) => n + 1); }
        }} />
      </ScrollView>
    );
  }
  if (tab === 'ready') return <View key={attempt} style={{ flex: 1 }}>{props.children}</View>;
  if (tab === 'checking') return null;
  const title = tab === 'moved' ? t('entry.storage.moved') : tab === 'waiting' ? t('entry.storage.moving')
    : tab === 'busy' ? t('entry.storage.otherRecording') : t('entry.storage.elsewhere');
  const sub = tab === 'waiting' ? t('entry.storage.movingSub') : tab === 'busy' ? t('entry.storage.otherRecordingSub') : t('entry.storage.elsewhereSub');
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: C.bg, padding: space.xl }}>
      <EmptyState icon={tab === 'busy' ? 'mic' : 'layers'} title={title} sub={sub}>
        {tab === 'waiting' && actions ? (
          <View style={{ alignSelf: 'center' }}><GhostBtn label={t('common.cancel')} icon="close" full={false} help={t('entry.storage.cancelMoveHelp')} onPress={actions.cancel} /></View>
        ) : tab === 'busy' && actions ? (
          <View style={{ alignSelf: 'center' }}><GhostBtn label={t('common.tryAgain')} icon="restart" full={false} help={t('entry.storage.useHereHelp')} onPress={actions.useHere} /></View>
        ) : actions ? (
          <View style={{ alignSelf: 'center' }}><GhostBtn label={t('entry.storage.useHere')} icon="swap" full={false} help={t('entry.storage.useHereHelp')} onPress={actions.useHere} /></View>
        ) : null}
      </EmptyState>
    </View>
  );
}

