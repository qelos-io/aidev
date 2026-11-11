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
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--ui-text);
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
  color: var(--ui-text-highlighted);
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
  border-left: 3px solid var(--ui-border-accented);
  color: var(--wb-ink-soft);
}

.md-content :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.md-content :deep(a:hover) {
  color: color-mix(in oklch, var(--ui-primary) 80%, black);
}

.md-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--ui-bg-elevated);
  padding: 0.1em 0.3em;
  border-radius: 0.2rem;
}

.md-content :deep(pre) {
  margin: 0 0 0.5em;
  padding: 0.55rem 0.65rem;
  background: var(--ui-bg-elevated);
  border-radius: 0.625rem;
  overflow-x: auto;
  white-space: pre-wrap;
}

.md-content :deep(pre code) {
  background: none;
  padding: 0;
}

.md-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--ui-border);
  margin: 0.65em 0;
}

.md-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 0.5em;
  font-size: 0.8125rem;
}

.md-content :deep(th),
.md-content :deep(td) {
  border: 1px solid var(--ui-border);
  padding: 0.25rem 0.4rem;
  text-align: left;
}
</style>
