<template>
  <span class="tile" :class="`tile--${size}`" aria-hidden="true">
    <img v-if="image" :src="image" alt="" class="tile-img" />
    <UIcon v-else :name="icon || 'i-lucide-plug'" class="tile-icon" :style="color ? { color } : undefined" />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ image?: string; icon?: string; color?: string; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' });
</script>

<style scoped>
/* Brand logos assume a light ground, so the tile stays light in both themes. */
.tile { display: inline-grid; place-items: center; flex-shrink: 0; background: oklch(98.5% 0.003 250); border: 1px solid var(--ui-border); border-radius: 0.625rem; color: oklch(30% 0.02 250); }
.tile--sm { width: 1.75rem; height: 1.75rem; border-radius: 0.5rem; }
.tile--md { width: 2.25rem; height: 2.25rem; }
.tile--lg { width: 2.75rem; height: 2.75rem; border-radius: 0.75rem; }
.tile-img { width: 62%; height: 62%; object-fit: contain; }
.tile-icon { width: 58%; height: 58%; }
</style>
