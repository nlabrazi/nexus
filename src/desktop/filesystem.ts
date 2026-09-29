import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse } from 'node:path';
import type { DirectoryListing } from '../protocol/types';

/** Runs on Desktop, never on Core: paths belong to the user's workstation. */
export async function browseDirectory(path?: string): Promise<DirectoryListing> {
  if (path && !isAbsolute(path)) throw new Error('Indiquez un chemin absolu.');
  const current = await realpath(path || homedir());
  const entries = await readdir(current, { withFileTypes: true });
  const directories: DirectoryListing['directories'][number][] = [];
  // Resolve symlinks too, including mounted disks exposed as directory links.
  for (const entry of entries) {
    const target = join(current, entry.name);
    if (
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (await stat(target).then(
          (s) => s.isDirectory(),
          () => false
        )))
    ) {
      directories.push({ name: entry.name, path: target, hidden: entry.name.startsWith('.') });
    }
  }
  directories.sort((a, b) =>
    a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })
  );
  const roots = [{ name: parse(current).root, path: parse(current).root }];
  if (process.platform === 'win32') {
    roots.length = 0;
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      if (
        await stat(drive).then(
          (s) => s.isDirectory(),
          () => false
        )
      )
        roots.push({ name: drive, path: drive });
    }
  }
  return {
    path: current,
    parent: dirname(current) === current ? null : dirname(current),
    home: homedir(),
    roots,
    directories,
  };
}
