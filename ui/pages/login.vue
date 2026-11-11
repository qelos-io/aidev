<template>
  <div class="login-wrap">
    <main class="login">
      <img src="/aidev-logo.png" alt="AI Dev" class="logo" width="200" height="100" />
      <h1>Sign in to your dashboard</h1>
      <p class="lead">
        Run <code>aidev ui</code> in your terminal. It opens this page already signed in.
        If you got here another way, paste the access token it printed.
      </p>

      <form class="form" @submit.prevent="submit">
        <UFormField label="Access token" :error="error || undefined" description="A long string of letters and numbers, printed once when the dashboard starts.">
          <UInput
            v-model="manualToken"
            :type="reveal ? 'text' : 'password'"
            placeholder="Paste your token"
            autocomplete="off"
            autofocus
            class="w-full"
            :ui="{ base: 'font-mono', trailing: 'pe-1' }"
            @update:model-value="error = ''"
          >
            <template #trailing>
              <UButton color="neutral" variant="link" size="sm" :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="reveal ? 'Hide token' : 'Show token'" @click="reveal = !reveal" />
            </template>
          </UInput>
        </UFormField>
        <UButton type="submit" block size="lg" :disabled="!manualToken.trim()">Continue</UButton>
      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false });

const route = useRoute();
const router = useRouter();
const manualToken = ref('');
const error = ref('');
const reveal = ref(false);

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
    error.value = 'Paste your access token to continue.';
    return;
  }
  localStorage.setItem(TOKEN_KEY, value);
  router.replace('/');
}
</script>

<style scoped>
.login-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 2rem 1rem; }
.login { width: 100%; max-width: 26rem; padding: 2rem; border-radius: 1.25rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.logo { display: block; height: 4rem; width: auto; margin: -0.5rem 0 0.5rem -0.25rem; }
h1 { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; color: var(--ui-text-highlighted); }
.lead { margin: 0.5rem 0 1.5rem; font-size: 0.9375rem; color: var(--wb-ink-soft); }
.lead code { font-family: var(--font-mono); font-size: 0.8125rem; padding: 0.0625rem 0.375rem; border-radius: 0.375rem; background: var(--ui-bg-elevated); }
.form { display: flex; flex-direction: column; gap: 1.25rem; }
</style>
