// Which Cloudflare worker a push to main should deploy.
// Patterns match the workflow's `paths` filter: `*` does not cross a
// directory, `**` does. The workflow reads email= and web= from stdout.
import { fileURLToPath } from 'node:url';

const EMAIL = ['apps/invite-email/**'];
const WEB = ['apps/web/**', 'packages/core/**', 'packages/client/**', 'package-lock.json'];

/** @param {string[]} files paths relative to the repository root */
export function jobsFor(files) {
  const list = files.map((file) => file.trim()).filter(Boolean);
  return {
    email: list.some((file) => EMAIL.some((pattern) => matches(pattern, file))),
    web: list.some((file) => WEB.some((pattern) => matches(pattern, file)))
  };
}

function matches(pattern, file) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += /[\\.^$+{}()|[\]?]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source}$`).test(file);
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    const jobs = jobsFor(raw.split('\n'));
    process.stdout.write(`email=${jobs.email}\nweb=${jobs.web}\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
