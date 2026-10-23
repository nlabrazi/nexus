/**
 * Lightweight safe markdown renderer for chat bubbles
 */
export function renderMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let html = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang ... ```
  html = html.replace(
    /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    }
  );

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics: *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}
