// Sets every tracked file's modification time from its content. A fresh CI checkout gives every file a new mtime,
// so caches that compare mtimes (ESLint's --cache, by default) miss on every file. With these times an unchanged
// file has the same mtime on every run, and any edit changes it.
import { execFileSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 946684800; // 2000-01-01, so pinned times stay in the past and outputs built now are always newer

/** Seconds since the epoch for a git blob id: same content, same time. */
export const contentTime = (blob) => BASE + parseInt(blob.slice(0, 7), 16);

export function pin(root) {
  const out = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  // Files edited since checkout keep their real times: their content no longer matches the recorded blob.
  const edited = new Set(execFileSync('git', ['ls-files', '-m', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0'));
  let pinned = 0;
  for (const rec of out.split('\0')) {
    const m = /^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/.exec(rec);
    // Regular files only: symlinks and submodules keep their times.
    if (!m || (m[1] !== '100644' && m[1] !== '100755') || edited.has(m[3])) continue;
    const t = contentTime(m[2]);
    try {
      utimesSync(join(root, m[3]), t, t);
      pinned++;
    } catch {
      // deleted or unreadable in the working tree
    }
  }
  return pinned;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`ci-sdk: pinned file times for ${pin(process.cwd())} files`);
