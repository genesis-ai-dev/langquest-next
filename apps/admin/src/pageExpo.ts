/**
 * The picture at the top of "Phone app builds and updates (Expo)" (part
 * `expo`, Releases): the latest EAS builds as a list, newest first, each by
 * its phone, what it is for and its version, with the store send that took
 * it; and the newest phone update (no store) on each branch, by the phones
 * that take it. Which build each phone runs is the part "Where each build
 * and update is", and the page says so. Before 2026-11-21 this was three
 * rows of squares (builds, store submissions, updates) named only under the
 * pointer. It uses the list styles of pageCode.ts.
 */

/** Pure helpers, no page state: apps/admin/test/code.test.ts runs them with new Function. */
export const EXPO_LOGIC = String.raw`
const EAS_PHONE = { IOS: 'iPhone', ANDROID: 'Android' };
const EAS_STORE = { IOS: 'the App Store', ANDROID: 'Google Play' };
/** What a build profile (apps/mobile/eas.json) is for, as people say it. */
function easFor(b) {
  if (b.profile === 'production') return 'for ' + (EAS_STORE[b.platform] || 'the store');
  if (b.profile === 'carried') return 'install file to share nearby';
  if (b.profile === 'preview') return 'for test phones';
  if (b.profile === 'development') return 'for developers';
  if (b.profile === 'simulator') return 'for the iPhone simulator';
  return b.profile || 'build';
}
const EAS_STATE = (st) => st === 'ERRORED' ? 'fail' : st === 'FINISHED' ? 'ok' : st === 'CANCELED' ? 'off' : 'run';
const EAS_RESULT = { fail: 'Failed', ok: 'Built', off: 'Cancelled', run: 'Building' };
/** Who takes an update branch's updates. */
function easBranch(name) {
  if (name === 'production') return 'For phones with a store build';
  if (name === 'preview') return 'For test phones';
  if (name === 'development') return 'For developers\' builds';
  return 'Branch ' + name;
}
const easPhones = (p) => String(p || '').split(',').map((x) => EAS_PHONE[x.trim().toUpperCase()] || x.trim()).filter(Boolean).join(' and ');

/** The builds newest first, each with the store send of the same phone and version; the newest update of each branch. */
function expoView(d) {
  d = d || {};
  const subs = d.submissions || [];
  const builds = (d.builds || []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((b) => {
    const s = EAS_STATE(b.status);
    const sent = b.appVersion ? subs.find((x) => x.platform === b.platform && x.version === b.appVersion) : null;
    const store = EAS_STORE[b.platform] || 'the store';
    let note = '';
    if (s === 'fail') note = 'The build failed on Expo.';
    else if (sent && sent.status === 'ERRORED') note = 'Sending it to ' + store + ' failed' + (sent.error ? ': ' + sent.error.split(':')[0] : '') + '.';
    else if (sent && sent.status === 'FINISHED') note = 'Sent to ' + store;
    else if (sent) note = 'Sending it to ' + store;
    else if (b.profile !== 'production') note = 'Not for a store';
    return { s: sent && sent.status === 'ERRORED' ? 'fail' : s, name: (EAS_PHONE[b.platform] || b.platform) + ', ' + easFor(b) + (b.appVersion ? ' · ' + b.appVersion : ''),
      result: EAS_RESULT[s], at: b.at, note, sentAt: sent && sent.status === 'FINISHED' ? sent.at : null };
  });
  const updates = (d.updates || []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((u) => ({
    s: 'ok', name: easBranch(u.branch) + (easPhones(u.platform) ? ' · ' + easPhones(u.platform) : ''), result: 'Sent', at: u.at,
    note: u.branch === 'production' ? 'Phones take it the next time they open the app. "Update adoption", below, counts them.'
      : u.branch === 'preview' ? 'Only the team\'s test builds take it.' : '' }));
  const counts = Object.fromEntries(['fail', 'run', 'ok', 'off'].map((k) => [k, builds.filter((b) => b.s === k).length]));
  return { builds, updates, counts };
}
`;

/** Drawing the part: the builds, then the phone updates; on a card, the builds that failed. */
export const EXPO_SCRIPT = String.raw`
const EXPO_PILL = { fail: 'failed', run: 'building', ok: 'built', off: 'cancelled' };
function expoRow(x) {
  const note = x.note ? esc(x.note) + (x.sentAt ? ' ' + when(x.sentAt) : '') : '';
  return '<li class="' + x.s + '"><i aria-hidden="true">' + CODE_MARK[x.s] + '</i><span>' + esc(x.name) + (note ? '<small>' + note + '</small>' : '') + '</span>' +
    '<em>' + esc(x.result) + (x.at ? ' ' + when(x.at) : '') + '</em></li>';
}
function expoBox(d, mini) {
  const v = expoView(d);
  const pills = ['fail', 'run', 'ok', 'off'].filter((k) => v.counts[k]).map((k) => '<span class="cdp ' + k + '">' + num(v.counts[k]) + ' ' + EXPO_PILL[k] + '</span>').join('');
  const head = '<div class="ct"><span>New app versions (builds), newest first</span><b>' + num(v.builds.length) + (v.builds.length === 1 ? ' build' : ' builds') + pills + '</b></div>';
  if (mini) {
    const bad = v.builds.filter((b) => b.s === 'fail').slice(0, 4);
    return bad.length ? '<div class="chart codebox mini" data-part="expo">' + head + '<ul class="cdj">' + bad.map(expoRow).join('') + '</ul></div>' : '';
  }
  return '<div class="codebox" data-part="expo">' +
    '<p class="muted cdn">Which build each phone runs, and which builds wait for the stores, are in "Where each build and update is", above.</p>' +
    (v.builds.length ? '<div class="chart">' + head + '<ul class="cdj">' + v.builds.map(expoRow).join('') + '</ul></div>' : '') +
    (v.updates.length ? '<div class="chart"><div class="ct"><span>Phone updates (no store), the newest of each</span><b>' + num(v.updates.length) + (v.updates.length === 1 ? ' update' : ' updates') + '</b></div>' +
      '<ul class="cdj">' + v.updates.map(expoRow).join('') + '</ul></div>' : '') + '</div>';
}
`;
