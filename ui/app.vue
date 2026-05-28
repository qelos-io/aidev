<template>
  <UApp>
    <div class="aidev-shell">
      <header>
        <h1>aidev dashboard</h1>
        <p>Scaffolding placeholder — screens land in subsequent steps.</p>
      </header>
    </div>
  </UApp>
</template>

<script setup lang="ts">
// Placeholder shell — subsequent steps add the layout, login flow, and pages
// (Dashboard, Config, Logs, Tasks, Run). See ui/docs/handover/ for the plan.
useHead({
  title: 'aidev dashboard',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
});
</script>

<style scoped>
.aidev-shell {
  padding: 2rem;
  font-family: system-ui, -apple-system, sans-serif;
}
</style>
