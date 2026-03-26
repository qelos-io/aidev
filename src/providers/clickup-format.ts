/**
 * Conversion utilities between ClickUp's Quill Delta-like block format and Markdown.
 *
 * ClickUp comments use a block array where each block has `text` and optional
 * `attributes`.  Inline attributes (bold, italic, code, link) decorate the text
 * itself; line-level attributes (list, code-block) appear on the trailing `\n`
 * character and apply to the preceding line content.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ClickUpBlock {
  text?: string;
  type?: string;
  attributes?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ClickUp blocks → Markdown                                         */
/* ------------------------------------------------------------------ */

function inlineToMarkdown(text: string, attrs: Record<string, unknown>): string {
  if (!text) return '';
  let out = text;

  if (attrs.code) out = `\`${out}\``;
  if (attrs.bold) out = `**${out}**`;
  if (attrs.italic) out = `*${out}*`;
  if (attrs.link && typeof attrs.link === 'string') out = `[${out}](${attrs.link})`;

  return out;
}

function resolveListType(attr: unknown): string | undefined {
  if (!attr) return undefined;
  if (typeof attr === 'string') return attr;
  if (typeof attr === 'object' && attr !== null && 'list' in (attr as Record<string, unknown>)) {
    return String((attr as Record<string, string>).list);
  }
  return undefined;
}

function resolveCodeBlock(attr: unknown): string | undefined {
  if (!attr) return undefined;
  if (typeof attr === 'string') return attr;
  if (typeof attr === 'object' && attr !== null && 'code-block' in (attr as Record<string, unknown>)) {
    return String((attr as Record<string, string>)['code-block']);
  }
  return 'plain';
}

export function clickupBlocksToMarkdown(blocks: ClickUpBlock[]): string {
  if (!blocks || blocks.length === 0) return '';

  interface Segment { text: string; attrs: Record<string, unknown> }
  const segments: Segment[] = blocks.map((b) => ({
    text: b.text ?? '',
    attrs: b.attributes ?? {},
  }));

  let result = '';
  let lineContent = '';
  let inCodeBlock = false;
  let orderedCounter = 0;

  const flushLine = (lineAttrs: Record<string, unknown>): void => {
    const listType = resolveListType(lineAttrs.list);
    const codeBlock = resolveCodeBlock(lineAttrs['code-block']);

    if (codeBlock) {
      if (!inCodeBlock) {
        result += '```\n';
        inCodeBlock = true;
      }
      result += lineContent + '\n';
      orderedCounter = 0;
    } else if (listType) {
      if (inCodeBlock) { result += '```\n'; inCodeBlock = false; }
      switch (listType) {
        case 'ordered':
          orderedCounter++;
          result += `${orderedCounter}. ${lineContent}\n`;
          break;
        case 'checked':
          result += `- [x] ${lineContent}\n`;
          orderedCounter = 0;
          break;
        case 'unchecked':
          result += `- [ ] ${lineContent}\n`;
          orderedCounter = 0;
          break;
        default: // bullet, toggled
          result += `- ${lineContent}\n`;
          orderedCounter = 0;
          break;
      }
    } else {
      if (inCodeBlock) { result += '```\n'; inCodeBlock = false; }
      result += lineContent + '\n';
      orderedCounter = 0;
    }

    lineContent = '';
  };

  for (const seg of segments) {
    const { attrs } = seg;
    const parts = seg.text.split('\n');

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        // Inside code blocks, don't apply inline formatting
        if (inCodeBlock || resolveCodeBlock(attrs['code-block'])) {
          lineContent += parts[i];
        } else {
          lineContent += inlineToMarkdown(parts[i], attrs);
        }
      }

      // Each split boundary represents a \n in the original text
      if (i < parts.length - 1) {
        flushLine(attrs);
      }
    }
  }

  // Flush remaining content
  if (inCodeBlock) {
    if (lineContent) result += lineContent + '\n';
    result += '```';
  } else if (lineContent) {
    result += lineContent;
  }

  return result.trimEnd();
}

/* ------------------------------------------------------------------ */
/*  Markdown → ClickUp blocks                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse inline markdown formatting into ClickUp blocks.
 *
 * Handles: **bold**, *italic*, `code`, [text](url).
 * `baseAttrs` is merged into every emitted block (used for headings → bold).
 */
function parseInline(
  text: string,
  out: ClickUpBlock[],
  baseAttrs: Record<string, unknown> = {},
): void {
  // Order matters: bold before italic so ** is tried first
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;

  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    // Plain text before match
    if (m.index > last) {
      pushBlock(out, text.slice(last, m.index), baseAttrs);
    }

    if (m[2] !== undefined) {
      // **bold**
      pushBlock(out, m[2], { ...baseAttrs, bold: true });
    } else if (m[3] !== undefined) {
      // *italic*
      pushBlock(out, m[3], { ...baseAttrs, italic: true });
    } else if (m[4] !== undefined) {
      // `code`
      pushBlock(out, m[4], { ...baseAttrs, code: true });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      // [text](url)
      pushBlock(out, m[5], { ...baseAttrs, link: m[6] });
    }

    last = m.index + m[0].length;
  }

  // Remaining text after last match
  if (last < text.length) {
    pushBlock(out, text.slice(last), baseAttrs);
  } else if (last === 0 && text.length === 0) {
    // empty text, nothing to push
  }
}

function pushBlock(
  out: ClickUpBlock[],
  text: string,
  attrs: Record<string, unknown>,
): void {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) clean[k] = v;
  }
  out.push(Object.keys(clean).length > 0
    ? { text, attributes: clean }
    : { text });
}

export function markdownToClickupBlocks(markdown: string): ClickUpBlock[] {
  const blocks: ClickUpBlock[] = [];
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence toggle
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim() || 'plain';
      } else {
        inCodeBlock = false;
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      blocks.push({ text: line });
      blocks.push({ text: '\n', attributes: { 'code-block': { 'code-block': codeLang } } });
      continue;
    }

    // Heading (## Text) → bold text
    const headingMatch = line.match(/^#{1,6}\s+(.*)/);
    if (headingMatch) {
      parseInline(headingMatch[1], blocks, { bold: true });
      blocks.push({ text: '\n' });
      continue;
    }

    // Checklist: - [x] or - [ ]
    const checkMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (checkMatch) {
      const checked = checkMatch[1].toLowerCase() === 'x';
      parseInline(checkMatch[2], blocks);
      blocks.push({ text: '\n', attributes: { list: { list: checked ? 'checked' : 'unchecked' } } });
      continue;
    }

    // Bullet list: - text, * text, + text
    const bulletMatch = line.match(/^[-*+]\s+(.*)/);
    if (bulletMatch) {
      parseInline(bulletMatch[1], blocks);
      blocks.push({ text: '\n', attributes: { list: { list: 'bullet' } } });
      continue;
    }

    // Ordered list: 1. text or 1) text
    const orderedMatch = line.match(/^\d+[.)]\s+(.*)/);
    if (orderedMatch) {
      parseInline(orderedMatch[1], blocks);
      blocks.push({ text: '\n', attributes: { list: { list: 'ordered' } } });
      continue;
    }

    // Regular line
    if (line === '') {
      blocks.push({ text: '\n' });
    } else {
      parseInline(line, blocks);
      blocks.push({ text: '\n' });
    }
  }

  return blocks;
}
