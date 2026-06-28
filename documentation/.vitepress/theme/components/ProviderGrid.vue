<script setup lang="ts">
import { providers, type ProviderInfo } from '../../data/providers';

defineProps<{
  highlight?: string;
}>();

function initLabel(provider: ProviderInfo): string {
  if (provider.initSupport === true) return 'aidev init';
  if (provider.initSupport === 'manual') return 'Manual config';
  return '—';
}

function blockingLabel(blocking: ProviderInfo['blocking']): string {
  switch (blocking) {
    case 'native':
      return 'Native blocking';
    case 'optional':
      return 'Optional blocking';
    default:
      return 'No blocking';
  }
}
</script>

<template>
  <div class="icon-grid">
    <a
      v-for="provider in providers"
      :key="provider.id"
      :href="`/guide/providers#${provider.id}`"
      class="icon-card"
      :class="{ highlight: highlight === provider.id }"
    >
      <img :src="provider.icon" :alt="`${provider.name} logo`" class="icon-card__logo" loading="lazy" />
      <div class="icon-card__body">
        <strong>{{ provider.name }}</strong>
        <p>{{ provider.description }}</p>
        <div class="icon-card__tags">
          <span class="tag tag--ok">Implemented</span>
          <span class="tag">{{ initLabel(provider) }}</span>
          <span class="tag tag--muted">{{ blockingLabel(provider.blocking) }}</span>
        </div>
      </div>
    </a>
  </div>
</template>

<style scoped>
.icon-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  margin: 1.5rem 0;
}

.icon-card {
  display: flex;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}

.icon-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.icon-card.highlight {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
}

.icon-card__logo {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: contain;
  background: var(--vp-c-bg);
  padding: 4px;
}

.icon-card__body strong {
  display: block;
  margin-bottom: 0.25rem;
}

.icon-card__body p {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.icon-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.tag--ok {
  background: color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
  color: var(--vp-c-brand-1);
}

.tag--muted {
  opacity: 0.85;
}
</style>
