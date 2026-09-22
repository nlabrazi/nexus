import { isAbsolute, relative, sep } from 'node:path';

/** A compact list of confirmed file-change events, not a working-tree diff. */
export function formatFileSummary(paths: readonly string[], workspace: string): string | undefined {
  const files = [...new Set(paths)];
  if (!files.length) {
    return undefined;
  }
  const lines = files.slice(0, 10).map((path) => {
    const local = isAbsolute(path) ? relative(workspace, path) : path;
    const inside = local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
    const label = (inside ? local : path).replace(
      /[\r\n\t]/g,
      (char) => ({ '\r': '\\r', '\n': '\\n', '\t': '\\t' })[char]!
    );
    const shortened =
      Array.from(label).slice(0, 160).join('') + (Array.from(label).length > 160 ? '…' : '');
    return `• ${shortened.replace(/[\\\x60*_[\]]/g, '\\$&')}`;
  });
  if (files.length > 10) {
    lines.push(`… et ${files.length - 10} autre(s) fichier(s).`);
  }
  return [`📄 **Fichiers signalés par Codex (${files.length})**`, ...lines].join('\n');
}
