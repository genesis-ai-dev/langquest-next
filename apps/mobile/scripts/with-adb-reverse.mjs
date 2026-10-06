#!/usr/bin/env node
// Runs a command (`expo start`, `expo run:android`) and, while it runs, keeps
// every attached Android device's local Supabase port forwarded to this
// machine: `npm start` and `npm run android -- …` wrap themselves in it.
//
// `.env.development` points the app at `http://127.0.0.1:54421`. Inside the
// emulator that address is the emulator itself, so sign-in fails with a
// network error. `adb reverse` maps the device's port onto this machine's.
// It is lost when the emulator restarts, and the emulator is often booted by
// the command itself, so one `adb reverse` up front is not enough: this
// repeats it every few seconds for whatever devices are attached.
//
// Not `10.0.2.2` (the emulator's name for this machine): Supabase hands back
// URLs on 127.0.0.1 (supabase/config.toml), and a phone on USB has no 10.0.2.2.
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The port to forward when `url` is a server on this machine, else null. */
export function localPort(url) {
  let u;
  try {
    u = new URL(url ?? '');
  } catch {
    return null;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null;
  return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
}

const adb = (args) =>
  new Promise((resolve) => execFile('adb', args, (error, stdout) => resolve(error ? { error } : { stdout })));

function keepForwarded(port) {
  const done = new Set();
  let stopped = false;
  const tick = async () => {
    const list = await adb(['devices']);
    if (list.error) {
      // No adb on this machine: nothing to forward to, now or later.
      if (list.error.code === 'ENOENT') stopped = true;
      return;
    }
    const serials = list.stdout
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t'))
      .filter(([, state]) => state?.trim() === 'device')
      .map(([serial]) => serial);
    for (const serial of serials) {
      const r = await adb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
      if (!r.error && !done.has(serial)) {
        done.add(serial);
        console.log(`[adb] ${serial}: 127.0.0.1:${port} forwarded to this machine's Supabase`);
      }
    }
    for (const serial of done) if (!serials.includes(serial)) done.delete(serial);
  };
  const timer = setInterval(() => void (stopped ? clearInterval(timer) : tick()), 3000);
  void tick();
  return () => clearInterval(timer);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('usage: with-adb-reverse.mjs <command> [args…]');
    process.exit(2);
  }
  const port = localPort(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const stop = port ? keepForwarded(port) : () => {};
  const child = spawn(command, args, { stdio: 'inherit' });
  // Ctrl-C already reaches the child through the terminal; wait for it to exit.
  process.on('SIGINT', () => {});
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => {
    stop();
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on('error', (error) => {
    stop();
    console.error(error.message);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
