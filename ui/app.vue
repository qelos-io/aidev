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
  link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
});
</script>
