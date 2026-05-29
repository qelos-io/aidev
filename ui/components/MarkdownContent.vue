<template>
  <div v-if="html" class="md-content" v-html="html" />
</template>

<script setup lang="ts">
import { renderMarkdown } from '~/composables/useMarkdown';

const props = defineProps<{
  content: string;
}>();

const html = computed(() => renderMarkdown(props.content));
</script>

<style scoped>
.md-content {
  font-size: 0.8rem;
  line-height: 1.45;
  color: #0f172a;
  word-break: break-word;
}

.md-content :deep(p) {
  margin: 0 0 0.5em;
}

.md-content :deep(p:last-child) {
  margin-bottom: 0;
}

.md-content :deep(h1),
.md-content :deep(h2),
.md-content :deep(h3),
.md-content :deep(h4) {
  font-weight: 600;
  color: #0f172a;
  margin: 0.75em 0 0.35em;
  line-height: 1.25;
}

.md-content :deep(h1) { font-size: 1.1rem; }
.md-content :deep(h2) { font-size: 1rem; }
.md-content :deep(h3) { font-size: 0.95rem; }

.md-content :deep(ul),
.md-content :deep(ol) {
  margin: 0 0 0.5em;
  padding-left: 1.35em;
}

.md-content :deep(li) {
  margin: 0.15em 0;
}

.md-content :deep(blockquote) {
  margin: 0 0 0.5em;
  padding-left: 0.65em;
  border-left: 3px solid #cbd5e1;
  color: #475569;
}

.md-content :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}

.md-content :deep(a:hover) {
  color: #1d4ed8;
}

.md-content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: #e2e8f0;
  padding: 0.1em 0.3em;
  border-radius: 0.2rem;
}

.md-content :deep(pre) {
  margin: 0 0 0.5em;
  padding: 0.55rem 0.65rem;
  background: #e2e8f0;
  border-radius: 0.375rem;
  overflow-x: auto;
  white-space: pre-wrap;
}

.md-content :deep(pre code) {
  background: none;
  padding: 0;
}

.md-content :deep(hr) {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 0.65em 0;
}

.md-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 0.5em;
  font-size: 0.75rem;
}

.md-content :deep(th),
.md-content :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 0.25rem 0.4rem;
  text-align: left;
}
</style>
