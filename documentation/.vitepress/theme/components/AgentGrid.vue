<script setup lang="ts">
import { agents } from '../../data/agents';
</script>

<template>
  <div class="icon-grid">
    <a
      v-for="agent in agents"
      :key="agent.id"
      :href="agent.docsUrl"
      class="icon-card"
      target="_blank"
      rel="noopener noreferrer"
    >
      <img :src="agent.icon" :alt="`${agent.name} logo`" class="icon-card__logo" loading="lazy" />
      <div class="icon-card__body">
        <strong>{{ agent.name }}</strong>
        <code class="agent-id">{{ agent.id }}</code>
        <p>{{ agent.requires }}</p>
      </div>
    </a>
  </div>
</template>

<style scoped>
.icon-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
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
  margin-bottom: 0.15rem;
}

.agent-id {
  display: inline-block;
  font-size: 0.75rem;
  margin-bottom: 0.5rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
}

.icon-card__body p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}
</style>
