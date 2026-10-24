/**
 * diff-viewer.mjs
 * Pure, tested parser for unified git diffs into structured hunks and statistics.
 */

/**
 * Parses a raw git unified diff into structured file objects.
 *
 * @param {string} rawDiff - Raw output from git diff
 * @returns {Array<{ filePath: string, additions: number, deletions: number, hunks: Array<{ header: string, lines: Array<{ type: 'add'|'del'|'normal', text: string }> }> }>}
 */
export function parseUnifiedDiff(rawDiff) {
  if (!rawDiff || typeof rawDiff !== 'string' || !rawDiff.trim()) {
    return [];
  }

  // Split files by 'diff --git '
  const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);
  if (fileChunks.length === 0) {
    return parseSingleDiffStream(rawDiff);
  }

  return fileChunks.map((chunk) => {
    const lines = chunk.split('\n');
    const headerLine = lines[0] || '';

    // Extract file path from header: "a/path/file.ts b/path/file.ts"
    let filePath = 'fichier';
    const match = headerLine.match(/a\/(.+?)\s+b\/(.+)/);
    if (match) {
      filePath = match[2].trim();
    } else {
      const parts = headerLine.trim().split(/\s+/);
      filePath = parts[parts.length - 1] || 'fichier';
    }

    const { additions, deletions, hunks } = parseHunks(lines.slice(1));

    return {
      filePath,
      additions,
      deletions,
      hunks,
    };
  });
}

function parseHunks(lines) {
  let additions = 0;
  let deletions = 0;
  const hunks = [];
  let currentHunk = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      currentHunk = { header: line.trim(), lines: [] };
      hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        currentHunk.lines.push({ type: 'add', text: line.slice(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
        currentHunk.lines.push({ type: 'del', text: line.slice(1) });
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'normal', text: line.startsWith(' ') ? line.slice(1) : line });
      }
    }
  }

  return { additions, deletions, hunks };
}

function parseSingleDiffStream(raw) {
  const { additions, deletions, hunks } = parseHunks(raw.split('\n'));

  if (hunks.length === 0) return [];

  return [{
    filePath: 'modifications',
    additions,
    deletions,
    hunks,
  }];
}

/**
 * Summarizes diff stats: total additions, deletions and file count.
 */
export function summarizeDiff(parsedFiles) {
  if (!Array.isArray(parsedFiles) || parsedFiles.length === 0) {
    return { filesCount: 0, additions: 0, deletions: 0, label: 'Aucune modification' };
  }
  const filesCount = parsedFiles.length;
  const additions = parsedFiles.reduce((acc, f) => acc + (f.additions || 0), 0);
  const deletions = parsedFiles.reduce((acc, f) => acc + (f.deletions || 0), 0);
  const label = `${filesCount} fichier${filesCount > 1 ? 's' : ''} modifié${filesCount > 1 ? 's' : ''} (+${additions}, -${deletions})`;
  return { filesCount, additions, deletions, label };
}
