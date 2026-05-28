<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
useHead({
  title: 'aidev dashboard',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
});
</script>
