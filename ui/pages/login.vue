<template>
  <div class="login-wrap">
    <UCard class="login-card">
      <template #header>
        <h1 class="text-xl font-semibold">aidev login</h1>
        <p class="text-sm text-gray-500">
          Paste the token printed by <code>aidev ui</code> in your terminal.
        </p>
      </template>

      <div class="space-y-3">
        <UInput
          v-model="manualToken"
          placeholder="32-byte hex token"
          autocomplete="off"
          :ui="{ base: 'font-mono' }"
          @keydown.enter="submit"
        />
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      </div>

      <template #footer>
        <UButton block :disabled="!manualToken" @click="submit">
          Continue
        </UButton>
      </template>
    </UCard>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const router = useRouter();
const manualToken = ref('');
const error = ref('');

const TOKEN_KEY = 'aidev-ui-token';

onMounted(() => {
  const raw = route.query.token;
  const fromQuery = typeof raw === 'string' ? raw : '';
  if (fromQuery) {
    localStorage.setItem(TOKEN_KEY, fromQuery);
    router.replace('/');
    return;
  }
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) manualToken.value = existing;
});

function submit() {
  const value = manualToken.value.trim();
  if (!value) {
    error.value = 'Token is required';
    return;
  }
  localStorage.setItem(TOKEN_KEY, value);
  router.replace('/');
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}
.login-card {
  width: 100%;
  max-width: 28rem;
}
</style>
