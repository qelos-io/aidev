<template>
  <section class="drawer-section">
    <h3 class="section-title">Execute</h3>
    <p class="muted">
      Runs <code>aidev run --task {{ taskId }}</code> in
      <code>{{ cwd }}</code>. Streams stdout/stderr live below.
    </p>
    <div class="exec-row">
      <UButton size="sm" color="primary" :disabled="running" @click="emit('run')">
        {{ running ? 'Running…' : 'Execute task' }}
      </UButton>
      <UButton
        v-if="running"
        size="sm"
        color="error"
        variant="soft"
        @click="emit('stop')"
      >
        Cancel
      </UButton>
      <UButton
        v-if="lines.length > 0 && !running"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="emit('clear')"
      >
        Clear output
      </UButton>
    </div>
    <pre v-if="lines.length > 0" ref="viewerRef" class="exec-viewer"><code>{{ text }}</code></pre>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  taskId: string;
  cwd: string;
  running: boolean;
  lines: string[];
  text: string;
}>();

const emit = defineEmits<{
  run: [];
  stop: [];
  clear: [];
}>();

const viewerRef = ref<HTMLPreElement | null>(null);

defineExpose({ viewerRef });

watch(
  () => props.lines.length,
  () => {
    nextTick(() => {
      const el = viewerRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
);
</script>

<style scoped>
.drawer-section { margin-top: 1rem; }
.section-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--ui-text-highlighted);
  margin-bottom: 0.5rem;
}
.muted { font-size: 0.85rem; color: var(--wb-ink-soft); }
.exec-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0.5rem 0;
}
.exec-viewer {
  background: oklch(21% 0.02 250);
  color: oklch(92% 0.01 250);
  border-radius: 0.75rem;
  padding: 0.6rem 0.85rem;
  max-height: 18rem;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre;
  margin: 0;
}
</style>
