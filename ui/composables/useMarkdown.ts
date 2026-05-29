import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const PURIFY_OPTS = {
  USE_PROFILES: { html: true },
};

/**
 * Render markdown to sanitized HTML for `v-html` in the dashboard.
 * Task descriptions and provider comments are treated as untrusted input.
 */
export function renderMarkdown(source: string): string {
  const text = source.trim();
  if (!text) return '';
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, PURIFY_OPTS);
}
