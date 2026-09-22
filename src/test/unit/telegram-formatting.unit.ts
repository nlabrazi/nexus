import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { formatTelegramResponse, splitTelegramMessage } from '../../telegram/formatting';
import { TelegramTextMessage } from '../../telegram/types';

function styledText(message: TelegramTextMessage) {
  return message.entities.map((entity) => ({
    type: entity.type,
    text: message.text.slice(entity.offset, entity.offset + entity.length),
  }));
}

suite('Telegram response formatting', () => {
  test('renders a restrained heading, list, emphasis and inline code layout', () => {
    const [message] = formatTelegramResponse(
      '## Résultat\n\n**Terminé** :\n- Fichier `src/app.ts` modifié.\n- __Tests OK__.\n\n1. Relancer VS Code.'
    );
    assert.equal(
      message.text,
      'Résultat\n\nTerminé :\n• Fichier src/app.ts modifié.\n• Tests OK.\n\n1. Relancer VS Code.'
    );
    assert.deepEqual(styledText(message), [
      { type: 'bold', text: 'Résultat' },
      { type: 'bold', text: 'Terminé' },
      { type: 'code', text: 'src/app.ts' },
      { type: 'bold', text: 'Tests OK' },
    ]);
  });

  test('keeps HTML and unsupported or incomplete Markdown as literal text', () => {
    const source = '<b>texte</b> & "valeur" < 3\n\n*italique* **incomplet `code\n| a | b |';
    assert.deepEqual(formatTelegramResponse(source), [{ text: source, entities: [] }]);
    assert.deepEqual(formatTelegramResponse('```'), [{ text: '```', entities: [] }]);
    assert.deepEqual(formatTelegramResponse(''), []);
  });

  test('preserves underscores in identifiers and leaves unsupported image syntax visible', () => {
    const source = 'prefix__value__suffix et é__nom__é\n![capture](https://example.com/image.png)';
    assert.deepEqual(formatTelegramResponse(source), [{ text: source, entities: [] }]);
    const [message] = formatTelegramResponse('[app.ts](app.ts:12)');
    assert.equal(message.text, 'app.ts — app.ts:12');
    assert.deepEqual(styledText(message), [{ type: 'code', text: 'app.ts:12' }]);
  });

  test('preserves code contents, indentation and Markdown characters inside fences', () => {
    const code = '  const label = "**brut** & <tag>";\n\t// [lien](https://example.com)\n\n  fin  ';
    const [message] = formatTelegramResponse(`Avant\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAprès`);
    assert.equal(message.text, `Avant\n\n${code}\n\nAprès`);
    assert.deepEqual(message.entities, [
      { type: 'pre', language: 'ts', offset: 7, length: code.length },
    ]);
    assert.equal(formatTelegramResponse('~~~~js\r\n```\r\n~~~~')[0].text, '```');
    assert.equal(formatTelegramResponse('```ts\nx < 2\ny')[0].text, 'x < 2\ny');
  });

  test('handles escaped markers and code inside bold without forbidden entity nesting', () => {
    const [message] = formatTelegramResponse('\\*littéral\\* **voir `a_b` ici** et ``a ` b``');
    assert.equal(message.text, '*littéral* voir a_b ici et a ` b');
    assert.deepEqual(styledText(message), [
      { type: 'bold', text: 'voir ' },
      { type: 'code', text: 'a_b' },
      { type: 'bold', text: ' ici' },
      { type: 'code', text: 'a ` b' },
    ]);
  });

  test('supports web links and preserves local targets instead of making unusable links', () => {
    const [message] = formatTelegramResponse(
      '[Guide](https://example.com/doc_(v2)?a=1&b=2)\n[app.ts](</work/My Project/app.ts:12>)\n[src/a.ts](src/a.ts)'
    );
    assert.equal(message.text, 'Guide\napp.ts — /work/My Project/app.ts:12\nsrc/a.ts');
    assert.equal(message.entities[0].url, 'https://example.com/doc_(v2)?a=1&b=2');
    assert.deepEqual(styledText(message), [
      { type: 'text_link', text: 'Guide' },
      { type: 'code', text: '/work/My Project/app.ts:12' },
      { type: 'code', text: 'src/a.ts' },
    ]);
    const unsafe = '[action](javascript:alert(1)) [fichier](file:///tmp/a)';
    assert.deepEqual(formatTelegramResponse(unsafe), [{ text: unsafe, entities: [] }]);
  });

  test('prefers paragraph, line and word boundaries without dropping text', () => {
    for (const separator of ['\n\n', '\n', ' ']) {
      const source = 'a'.repeat(2800) + separator + 'b'.repeat(2200);
      const messages = splitTelegramMessage(source);
      assert.equal(messages.length, 2);
      assert.equal(messages[0].text, 'a'.repeat(2800) + separator);
      assert.equal(messages.map((message) => message.text).join(''), source);
    }
  });

  test('preserves emoji graphemes and rebases UTF-16 entity offsets in every chunk', () => {
    for (const emoji of ['😀', '👩🏽‍💻', '👨‍👩‍👧‍👦', 'e\u0301']) {
      const source = `${'a'.repeat(3999) + emoji} fin`;
      const messages = formatTelegramResponse(`**${source}**`);
      assert.equal(messages.length, 2);
      assert.equal(messages[0].text, 'a'.repeat(3999));
      assert.equal(messages[1].text, `${emoji} fin`);
      for (const message of messages) {
        assert.deepEqual(message.entities, [
          { type: 'bold', offset: 0, length: message.text.length },
        ]);
        assert.equal(Buffer.from(message.text, 'utf8').toString('utf8'), message.text);
      }
    }
    const [message] = formatTelegramResponse('😀 `code`');
    assert.deepEqual(message.entities, [{ type: 'code', offset: 3, length: 4 }]);
  });

  test('splits oversized code blocks and links with valid, independent styles and no lost content', () => {
    const code = 'const value = "<tag> & 😀";\n'.repeat(400);
    const messages = formatTelegramResponse(`\`\`\`ts\n${code}\n\`\`\``);
    assert.ok(messages.length > 2);
    assert.equal(messages.map((message) => message.text).join(''), code);
    for (const message of messages) {
      assert.ok(message.text.length <= 4000);
      assert.deepEqual(message.entities, [
        { type: 'pre', language: 'ts', offset: 0, length: message.text.length },
      ]);
    }
    const links = formatTelegramResponse(`[${'a'.repeat(8001)}](https://example.com)`);
    assert.deepEqual(
      links.map((message) => message.text.length),
      [4000, 4000, 1]
    );
    for (const message of links) {
      assert.deepEqual(message.entities, [
        {
          type: 'text_link',
          url: 'https://example.com',
          offset: 0,
          length: message.text.length,
        },
      ]);
    }
  });
});
