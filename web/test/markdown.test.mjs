import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../app/utils/markdown.mjs';

test('renderMarkdown escapes dangerous HTML and renders safe tags', () => {
  const input = '<script>alert("xss")</script>';
  const html = renderMarkdown(input);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
});

test('renderMarkdown formats bold, italic, inline code and code blocks', () => {
  const input = 'Texte **gras** et *italique* avec `code inline` et :\n```ts\nconst a = 1;\n```';
  const html = renderMarkdown(input);
  assert.match(html, /<strong>gras<\/strong>/);
  assert.match(html, /<em>italique<\/em>/);
  assert.match(html, /<code class="inline-code">code inline<\/code>/);
  assert.match(html, /<pre class="code-block"><code>const a = 1;<\/code><\/pre>/);
});

test('renderMarkdown handles empty or non-string input safely', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});
