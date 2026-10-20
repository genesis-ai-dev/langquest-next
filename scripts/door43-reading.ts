/**
 * Readers for Door43's reading material (scripts/door43-seed.ts): Open
 * Bible Stories in both layouts, the Theological Formation guide to them,
 * and the Hebrew, Greek and Aramaic grammars, written in reStructuredText.
 *
 * Pure: no I/O.
 */
import { links, type SourceFile } from './door43-helps';

export interface StoryFrame {
  /** `"01-03"`. */
  id: string;
  /** Door43's picture for the frame, when the story names one. */
  image?: string;
  text: string;
}

export interface Story {
  /** 1 to 50. */
  story: number;
  title: string;
  frames: StoryFrame[];
  /** "A Bible story from: Genesis 1-2", in the story's language. */
  reference?: string;
}

const two = (n: number) => String(n).padStart(2, '0');

/** One story in the markdown layout (`content/01.md`): a title, then each frame's picture and text, then the Bible reference in italics. */
export function markdownStory(story: number, md: string): Story | null {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const titleAt = lines.findIndex((l) => /^#\s+/.test(l));
  if (titleAt < 0) return null;
  const title = lines[titleAt]!.replace(/^#\s+/, '').replace(/^\d+\.\s*/, '').trim();
  const frames: StoryFrame[] = [];
  let reference: string | undefined;
  let current: { image?: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (text || current.image) {
      const fromImage = current.image ? /(\d+)-(\d+)\.jpe?g/i.exec(current.image) : null;
      const id = fromImage ? `${two(Number(fromImage[1]))}-${two(Number(fromImage[2]))}` : `${two(story)}-${two(frames.length + 1)}`;
      frames.push({ id, ...(current.image ? { image: current.image } : {}), text: links(text) });
    }
    current = null;
  };
  for (const line of lines.slice(titleAt + 1)) {
    const img = /^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/.exec(line);
    if (img) {
      flush();
      current = { image: img[1]!.trim(), lines: [] };
      continue;
    }
    const ref = /^\s*_(.+)_\s*$/.exec(line);
    if (ref) {
      flush();
      reference = ref[1]!.trim();
      continue;
    }
    if (!current) {
      if (!line.trim()) continue;
      current = { lines: [] };
    }
    // Without pictures, a blank line ends a frame.
    if (!current.image && !line.trim() && current.lines.some((l) => l.trim())) {
      flush();
      continue;
    }
    current.lines.push(line);
  }
  flush();
  return frames.length ? { story, title, frames, ...(reference ? { reference } : {}) } : null;
}

/**
 * Stories in translationStudio's layout: a folder per story with
 * `title.txt`, `reference.txt` and one `NN.txt` per frame. Pictures are
 * Door43's for the frame.
 */
export function folderStories(files: SourceFile[]): Story[] {
  const byStory = new Map<number, { title?: string; reference?: string; frames: { n: number; text: string }[] }>();
  for (const f of files) {
    const m = /(?:^|\/)(\d{2})\/([a-z0-9]+)\.txt$/i.exec(f.path);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 50) continue;
    const s = byStory.get(n) ?? { frames: [] };
    if (m[2] === 'title') s.title = f.text.trim();
    else if (m[2] === 'reference') s.reference = f.text.trim();
    else if (/^\d+$/.test(m[2]!) && Number(m[2]) > 0) s.frames.push({ n: Number(m[2]), text: f.text.trim() });
    byStory.set(n, s);
  }
  return [...byStory].sort(([a], [b]) => a - b).flatMap(([n, s]) => {
    if (!s.frames.length) return [];
    const frames = s.frames.sort((a, b) => a.n - b.n).map((fr) => ({
      id: `${two(n)}-${two(fr.n)}`,
      image: `https://cdn.door43.org/obs/jpg/360px/obs-en-${two(n)}-${two(fr.n)}.jpg`,
      text: links(fr.text)
    }));
    return [{ story: n, title: s.title?.replace(/^\d+\.\s*/, '') || `${n}`, frames, ...(s.reference ? { reference: s.reference } : {}) }];
  });
}

/**
 * One story of the Theological Formation guide (`obs_story_1.md`): its
 * sections as markdown, the story's own frames (`######### 01-01` with an
 * embedded picture) kept as they are written. Pictures the guide carries
 * (`![[image2.jpeg]]`) are listed by name, in order.
 */
export function formationStory(md: string): { story: number; title: string; body: string; images: string[] } | null {
  const text = md.replace(/\r\n?/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta = front ? front[1]! : '';
  const story = Number(/story_num:\s*(\d+)/.exec(meta)?.[1] ?? NaN);
  if (!Number.isInteger(story)) return null;
  const title = /subtitle:\s*(.+)/.exec(meta)?.[1]?.trim() ?? String(story);
  const rest = front ? text.slice(front[0].length) : text;
  const images = [...rest.matchAll(/!\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.trim());
  const body = links(rest
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{7,}\s*(\d+-\d+)\s*$/gm, '**$1**')
    .replace(/\n{3,}/g, '\n\n'));
  return { story, title, body, images };
}

// ---- reStructuredText ---------------------------------------------------------------------------

const UNDERLINE = /^([=\-~^"'`#*+])\1{2,}\s*$/;

/**
 * The grammars' reStructuredText as markdown, enough to read on a phone:
 * headings by the order their underline marks first appear, `.. include::`
 * followed (`read` gives an included file's text, relative to `content/`),
 * CSV tables as tables (with a header row) or lines, cross references as
 * their words, and directives' indented text kept. Images and labels are
 * left out.
 */
export function rstToMarkdown(rst: string, read: (path: string) => string | undefined, depth = 0): string {
  const lines = rst.replace(/\r\n?/g, '\n').split('\n');
  const levels: string[] = [];
  const out: string[] = [];
  const inline = (s: string) => s
    .replace(/:ref:`([^`<]+?)\s*<[^>]+>`/g, '$1')
    .replace(/:ref:`([^`]+)`/g, '$1')
    .replace(/:[a-z]+:`([^`]+)`/g, '$1')
    .replace(/`([^`<]+?)\s*<([^>]+)>`_+/g, '[$1]($2)')
    .replace(/``([^`]+)``/g, '`$1`');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (/^:[a-z_]+:/.test(line)) continue;
    if (/^\.\. _[^:]+:\s*$/.test(line)) continue;
    const inc = /^\.\.\s+include::\s*(\S+)/.exec(line);
    if (inc) {
      const t = depth < 4 ? read(inc[1]!) : undefined;
      if (t) out.push(rstToMarkdown(t, read, depth + 1));
      continue;
    }
    const dir = /^\.\.\s+([a-z-]+)::\s*(.*)$/.exec(line);
    if (dir) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === '' || /^\s+/.test(lines[j]!))) body.push(lines[j++]!);
      i = j - 1;
      const content = body.filter((l) => !/^\s+:[a-z-]+:/.test(l)).map((l) => l.replace(/^\s{2,4}/, ''));
      if (dir[1] === 'image' || dir[1] === 'figure' || dir[1] === 'toctree') continue;
      if (dir[1] === 'csv-table') {
        const header = body.some((l) => /:header-rows:\s*1/.test(l));
        const rows = content.map((l) => l.trim()).filter(Boolean);
        if (dir[2]) out.push(`**${inline(dir[2].trim())}**`, '');
        if (header && rows.length) {
          const cells = (r: string) => r.split(',').map((c) => inline(c.trim().replace(/^"|"$/g, '')));
          const head = cells(rows[0]!);
          out.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
          for (const r of rows.slice(1)) out.push(`| ${cells(r).join(' | ')} |`);
        } else out.push(...rows.map((r) => `${inline(r)}  `));
        out.push('');
        continue;
      }
      if (dir[2]) out.push(`**${inline(dir[2].trim())}**`);
      out.push(...content.map(inline), '');
      continue;
    }
    if (next !== undefined && line.trim() && UNDERLINE.test(next) && next.trim().length >= line.trim().length - 1) {
      const mark = next.trim()[0]!;
      if (!levels.includes(mark)) levels.push(mark);
      out.push(`${'#'.repeat(Math.min(levels.indexOf(mark) + 1, 6))} ${inline(line.trim())}`, '');
      i++;
      continue;
    }
    if (UNDERLINE.test(line)) continue;
    out.push(inline(line));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The article order a grammar's `index.rst` gives in its `toctree`. */
export function rstToctree(index: string): string[] {
  const out: string[] = [];
  const lines = index.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\.\.\s+toctree::/.test(lines[i]!)) continue;
    for (let j = i + 1; j < lines.length && (lines[j]!.trim() === '' || /^\s+/.test(lines[j]!)); j++) {
      const t = lines[j]!.trim();
      if (t && !t.startsWith(':')) out.push(t);
    }
  }
  return out;
}

/** A grammar article's title: its first heading. */
export function rstTitle(rst: string): string | null {
  const lines = rst.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i]!.trim() && !lines[i]!.startsWith('..') && !lines[i]!.startsWith(':') && UNDERLINE.test(lines[i + 1]!)) return lines[i]!.trim();
  }
  return null;
}
