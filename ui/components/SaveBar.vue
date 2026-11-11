<template>
  <Transition name="bar">
    <div v-if="dirty || saved" class="savebar" role="status">
      <template v-if="saved && !dirty">
        <UIcon name="i-lucide-circle-check" class="size-5 text-success" aria-hidden="true" />
        <span class="savebar-text">{{ savedText }}</span>
      </template>
      <template v-else>
        <span class="savebar-dot" aria-hidden="true" />
        <span class="savebar-text">{{ dirtyText }}</span>
        <UButton color="neutral" variant="ghost" :disabled="saving" @click="emit('discard')">Discard</UButton>
        <UButton :loading="saving" :disabled="saving" @click="emit('save')">Save changes</UButton>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ dirty: boolean; saving?: boolean; saved?: boolean; dirtyText?: string; savedText?: string }>(), {
  saving: false,
  saved: false,
  dirtyText: 'You have unsaved changes',
  savedText: 'Saved',
});
const emit = defineEmits<{ (e: 'save'): void; (e: 'discard'): void }>();
</script>

<style scoped>
.savebar {
  position: sticky; bottom: 1rem; margin: 1.5rem auto 0; width: fit-content; max-width: 100%;
  display: flex; align-items: center; gap: 0.75rem; padding: 0.625rem 0.75rem 0.625rem 1rem;
  border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border-accented);
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.25); z-index: 10;
}
.savebar-dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--wb-wait); }
.savebar-text { font-weight: 600; color: var(--ui-text-highlighted); margin-right: 0.5rem; }
.bar-enter-active, .bar-leave-active { transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(0.5rem); }
</style>
