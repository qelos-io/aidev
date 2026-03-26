import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClickUpBlock,
  clickupBlocksToMarkdown,
  markdownToClickupBlocks,
} from '../providers/clickup-format';

describe('clickupBlocksToMarkdown', () => {
  it('converts plain text blocks', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'Hello world' },
      { text: '\n' },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), 'Hello world');
  });

  it('converts bold text', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'This is ', attributes: {} },
      { text: 'bold', attributes: { bold: true } },
      { text: ' text\n' },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), 'This is **bold** text');
  });

  it('converts italic text', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'This is ', attributes: {} },
      { text: 'italic', attributes: { italic: true } },
      { text: '\n' },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), 'This is *italic*');
  });

  it('converts inline code', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'Use ' },
      { text: 'npm install', attributes: { code: true } },
      { text: '\n' },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), 'Use `npm install`');
  });

  it('converts links', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'Click ' },
      { text: 'here', attributes: { link: 'https://example.com' } },
      { text: '\n' },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), 'Click [here](https://example.com)');
  });

  it('converts bullet list', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'First item' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
      { text: 'Second item' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '- First item\n- Second item');
  });

  it('converts ordered list', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'First' },
      { text: '\n', attributes: { list: { list: 'ordered' } } },
      { text: 'Second' },
      { text: '\n', attributes: { list: { list: 'ordered' } } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '1. First\n2. Second');
  });

  it('converts checklist', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'Done task' },
      { text: '\n', attributes: { list: { list: 'checked' } } },
      { text: 'Pending task' },
      { text: '\n', attributes: { list: { list: 'unchecked' } } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '- [x] Done task\n- [ ] Pending task');
  });

  it('converts code block', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'const x = 1;' },
      { text: '\n', attributes: { 'code-block': 'javascript' } },
      { text: 'const y = 2;' },
      { text: '\n', attributes: { 'code-block': 'javascript' } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '```\nconst x = 1;\nconst y = 2;\n```');
  });

  it('handles code-block with nested object format', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'hello()' },
      { text: '\n', attributes: { 'code-block': { 'code-block': 'plain' } as unknown as string } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '```\nhello()\n```');
  });

  it('handles mixed content', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'Title', attributes: { bold: true } },
      { text: '\n' },
      { text: 'Item A' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
      { text: 'Item B' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '**Title**\n- Item A\n- Item B');
  });

  it('returns empty string for empty/null input', () => {
    assert.equal(clickupBlocksToMarkdown([]), '');
    assert.equal(clickupBlocksToMarkdown(null as unknown as ClickUpBlock[]), '');
  });

  it('handles list attribute as plain string', () => {
    const blocks: ClickUpBlock[] = [
      { text: 'item' },
      { text: '\n', attributes: { list: 'bullet' } },
    ];
    assert.equal(clickupBlocksToMarkdown(blocks), '- item');
  });
});

describe('markdownToClickupBlocks', () => {
  it('converts plain text', () => {
    const blocks = markdownToClickupBlocks('Hello world');
    assert.deepEqual(blocks, [
      { text: 'Hello world' },
      { text: '\n' },
    ]);
  });

  it('converts bold text', () => {
    const blocks = markdownToClickupBlocks('This is **bold** text');
    assert.deepEqual(blocks, [
      { text: 'This is ' },
      { text: 'bold', attributes: { bold: true } },
      { text: ' text' },
      { text: '\n' },
    ]);
  });

  it('converts italic text', () => {
    const blocks = markdownToClickupBlocks('This is *italic* text');
    assert.deepEqual(blocks, [
      { text: 'This is ' },
      { text: 'italic', attributes: { italic: true } },
      { text: ' text' },
      { text: '\n' },
    ]);
  });

  it('converts inline code', () => {
    const blocks = markdownToClickupBlocks('Use `npm install` now');
    assert.deepEqual(blocks, [
      { text: 'Use ' },
      { text: 'npm install', attributes: { code: true } },
      { text: ' now' },
      { text: '\n' },
    ]);
  });

  it('converts links', () => {
    const blocks = markdownToClickupBlocks('Click [here](https://example.com)');
    assert.deepEqual(blocks, [
      { text: 'Click ' },
      { text: 'here', attributes: { link: 'https://example.com' } },
      { text: '\n' },
    ]);
  });

  it('converts bullet list', () => {
    const blocks = markdownToClickupBlocks('- First\n- Second');
    assert.deepEqual(blocks, [
      { text: 'First' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
      { text: 'Second' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
    ]);
  });

  it('converts ordered list', () => {
    const blocks = markdownToClickupBlocks('1. First\n2. Second');
    assert.deepEqual(blocks, [
      { text: 'First' },
      { text: '\n', attributes: { list: { list: 'ordered' } } },
      { text: 'Second' },
      { text: '\n', attributes: { list: { list: 'ordered' } } },
    ]);
  });

  it('converts checklist', () => {
    const blocks = markdownToClickupBlocks('- [x] Done\n- [ ] Todo');
    assert.deepEqual(blocks, [
      { text: 'Done' },
      { text: '\n', attributes: { list: { list: 'checked' } } },
      { text: 'Todo' },
      { text: '\n', attributes: { list: { list: 'unchecked' } } },
    ]);
  });

  it('converts code block', () => {
    const blocks = markdownToClickupBlocks('```js\nconst x = 1;\n```');
    assert.deepEqual(blocks, [
      { text: 'const x = 1;' },
      { text: '\n', attributes: { 'code-block': 'js' } },
    ]);
  });

  it('converts headings to bold', () => {
    const blocks = markdownToClickupBlocks('## My Heading');
    assert.deepEqual(blocks, [
      { text: 'My Heading', attributes: { bold: true } },
      { text: '\n' },
    ]);
  });

  it('handles empty lines as paragraph breaks', () => {
    const blocks = markdownToClickupBlocks('Line 1\n\nLine 2');
    assert.deepEqual(blocks, [
      { text: 'Line 1' },
      { text: '\n' },
      { text: '\n' },
      { text: 'Line 2' },
      { text: '\n' },
    ]);
  });

  it('handles inline formatting inside list items', () => {
    const blocks = markdownToClickupBlocks('- **bold** item');
    assert.deepEqual(blocks, [
      { text: 'bold', attributes: { bold: true } },
      { text: ' item' },
      { text: '\n', attributes: { list: { list: 'bullet' } } },
    ]);
  });
});

describe('round-trip conversion', () => {
  it('preserves plain text through round-trip', () => {
    const md = 'Hello world';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });

  it('preserves bullet list through round-trip', () => {
    const md = '- Item A\n- Item B\n- Item C';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });

  it('preserves ordered list through round-trip', () => {
    const md = '1. First\n2. Second\n3. Third';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });

  it('preserves bold and italic through round-trip', () => {
    const md = 'This is **bold** and *italic* text';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });

  it('preserves inline code through round-trip', () => {
    const md = 'Run `npm test` now';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });

  it('preserves links through round-trip', () => {
    const md = 'Visit [docs](https://docs.example.com) for info';
    const blocks = markdownToClickupBlocks(md);
    const result = clickupBlocksToMarkdown(blocks);
    assert.equal(result, md);
  });
});
