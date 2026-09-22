import { TelegramMessageEntity, TelegramTextMessage } from './types';

const MESSAGE_LIMIT = 4000;
type Style = Omit<TelegramMessageEntity, 'offset' | 'length'>;
interface Span {
  text: string;
  style?: Style;
}

/** A deliberately small Markdown subset. Unknown syntax stays readable as text. */
export function formatTelegramResponse(source: string): TelegramTextMessage[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const spans: Span[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(line);
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      let end = index + 1;
      while (end < lines.length && !closing.test(lines[end])) {
        end++;
      }
      const language = fence[2].trim().split(/\s+/)[0];
      spans.push({
        text: lines.slice(index + 1, end).join('\n'),
        style: { type: 'pre', ...(/^[\w+-]+$/.test(language) ? { language } : {}) },
      });
      index = end;
    } else {
      const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      const content = heading ? heading[1] : line.replace(/^(\s*)[-+*]\s+/, '$1• ');
      spans.push(...inlineSpans(content, heading ? { type: 'bold' } : undefined));
    }
    if (index < lines.length - 1) {
      spans.push({ text: '\n' });
    }
  }

  let text = '';
  const entities: TelegramMessageEntity[] = [];
  for (const span of spans) {
    if (span.style && span.text.length > 0) {
      entities.push({ ...span.style, offset: text.length, length: span.text.length });
    }
    text += span.text;
  }
  // An empty/unsupported construction must not swallow an otherwise nonempty reply.
  return text.trim() ? splitTelegramMessage(text, entities) : splitTelegramMessage(source);
}

function inlineSpans(text: string, style?: Style, depth = 0): Span[] {
  if (depth >= 8) {
    return [{ text, style }];
  }
  // Code is consumed before its contents can be interpreted as other styles.
  const pattern = new RegExp(
    [
      /\\(?<escaped>[\\`*_[\]()#!+>.~-])/.source,
      /(?<ticks>`+)(?<code>.+?)\k<ticks>(?!`)/.source,
      /(?<boldMark>\*\*|__)(?=\S)(?<bold>.+?\S|\S)\k<boldMark>/.source,
      /(?<!!)\[(?<label>[^\]\n]+)\]\((?<destination><[^>\n]+>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"\n]*")?\)/
        .source,
    ].join('|'),
    'g'
  );
  const spans: Span[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const groups = match.groups!;
    spans.push({ text: text.slice(offset, match.index), style });
    if (groups.escaped) {
      spans.push({ text: groups.escaped, style });
    } else if (groups.code) {
      spans.push({ text: groups.code, style: { type: 'code' } });
    } else if (groups.bold) {
      const insideWord =
        groups.boldMark === '__' &&
        (/[\p{L}\p{N}_]/u.test(text[match.index - 1] ?? '') ||
          /[\p{L}\p{N}_]/u.test(text[match.index + match[0].length] ?? ''));
      spans.push(
        ...(insideWord
          ? [{ text: match[0], style }]
          : inlineSpans(groups.bold, { type: 'bold' }, depth + 1))
      );
    } else {
      const label = groups.label;
      const destination = groups.destination.replace(/^<|>$/g, '');
      if (isWebUrl(destination)) {
        spans.push(...inlineSpans(label, { type: 'text_link', url: destination }, depth + 1));
      } else if (
        !/^[a-z][a-z\d+.-]*:/i.test(destination) ||
        /^[a-z]:[\\/]/i.test(destination) ||
        /^[^:\s]+\.[^:\s]+:\d+(?::\d+)?$/.test(destination)
      ) {
        // Local editor links cannot be opened by Telegram; keep the actual path visible.
        if (label !== destination) {
          spans.push(...inlineSpans(label, style, depth + 1), { text: ' — ' });
        }
        spans.push({ text: destination, style: { type: 'code' } });
      } else {
        spans.push({ text: match[0], style });
      }
    }
    offset = match.index + match[0].length;
  }
  spans.push({ text: text.slice(offset), style });
  // Each span has one style: Telegram forbids nesting code/pre within other entities.
  return spans.filter((span) => span.text.length > 0);
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Split the displayed text, then rebase styles using Telegram's UTF-16 offsets. */
export function splitTelegramMessage(
  text: string,
  entities: TelegramMessageEntity[] = []
): TelegramTextMessage[] {
  const messages: TelegramTextMessage[] = [];
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + MESSAGE_LIMIT, text.length);
    if (end < text.length) {
      // Prefer a paragraph, line or word boundary without producing tiny messages.
      for (const separator of ['\n\n', '\n', ' ']) {
        const boundary = text.lastIndexOf(separator, end - separator.length);
        if (boundary >= start + MESSAGE_LIMIT / 2) {
          end = boundary + separator.length;
          break;
        }
      }
      const boundary = graphemes.containing(end)?.index;
      if (boundary !== undefined && boundary > start) {
        end = boundary;
      } else if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) {
        end--;
      }
    }
    messages.push({
      text: text.slice(start, end),
      entities: entities
        .filter((entity) => entity.offset < end && entity.offset + entity.length > start)
        .map((entity) => ({
          ...entity,
          offset: Math.max(start, entity.offset) - start,
          length: Math.min(end, entity.offset + entity.length) - Math.max(start, entity.offset),
        })),
    });
    start = end;
  }
  return messages;
}
