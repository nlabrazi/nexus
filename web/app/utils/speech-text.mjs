/** Produce a spoken rendering only; the displayed answer stays intact. */
export function cleanTextForSpeech(text) {
  const clean = text
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, ' Le code est disponible à l’écran. ')
    .replace(/~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, ' Le code est disponible à l’écran. ')
    .replace(/(?:^|\n)(?:\|[^\n]*\|[ \t]*(?:\n|$))+/g, '\nLe tableau est disponible à l’écran.\n')
    .replace(/La commande\s+`npm run build`/gi, 'La compilation')
    .replace(/La commande\s+`npm (?:run )?test`/gi, 'Les tests')
    .replace(/`[^`]*`/g, ' élément de code ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, ' et ')
    .replace(/&(?:lt|gt|quot|nbsp);/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /[.!?:;…]$/.test(line) ? line : `${line}.`)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 6000) return clean;
  const end = clean.lastIndexOf(' ', 5900);
  return `${clean.slice(0, end > 0 ? end : 5900)}. La suite est disponible à l’écran.`;
}

export function splitSpeechText(text, limit = 240) {
  const chunks = [];
  const sentences = new Intl.Segmenter('fr', { granularity: 'sentence' }).segment(text);
  for (const { segment } of sentences) {
    let chunk = '';
    for (const word of segment.trim().split(/\s+/)) {
      // Even a very long technical identifier must remain bounded.
      for (let offset = 0; offset < word.length; offset += limit) {
        const part = word.slice(offset, offset + limit);
        if (chunk && chunk.length + 1 + part.length > limit) { chunks.push(chunk); chunk = ''; }
        chunk += `${chunk ? ' ' : ''}${part}`;
      }
    }
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/** Native engines support longer passages; preserve their intonation across sentences. */
export function splitNativeSpeechText(text, limit = 1200) {
  const chunks = [];
  for (const sentence of splitSpeechText(text, limit)) {
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + sentence.length <= limit) chunks[last] += ` ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}
