<template>
  <div class="server">
    <div class="server-top">
      <IconTile :icon="toolIcon.icon" :color="toolIcon.color" size="lg" class="tool-tile" />
      <UFormField label="Name" description="Any short name you'll recognise" class="name-field">
        <UInput v-model="server.name" placeholder="files" class="w-full" />
      </UFormField>
      <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`Remove ${server.name || 'tool'}`" @click="emit('remove')">Remove</UButton>
    </div>

    <div class="mode" role="group" aria-label="Where does this tool run?">
      <button type="button" class="mode-btn" :class="{ 'mode-btn--on': !remote }" :aria-pressed="!remote" @click="setRemote(false)">
        <UIcon name="i-lucide-laptop" class="size-4" aria-hidden="true" /> Runs on this computer
      </button>
      <button type="button" class="mode-btn" :class="{ 'mode-btn--on': remote }" :aria-pressed="remote" @click="setRemote(true)">
        <UIcon name="i-lucide-globe" class="size-4" aria-hidden="true" /> Online address
      </button>
    </div>

    <div class="fields">
      <UFormField v-if="remote" label="Address" description="The web address the tool provider gave you." class="span-2">
        <UInput v-model="server.url" placeholder="https://mcp.example.com" class="w-full" />
      </UFormField>
      <template v-else>
        <UFormField label="Program" description="What to run, usually npx.">
          <UInput v-model="server.command" placeholder="npx" class="w-full" />
        </UFormField>
        <UFormField label="Options" description="Separated by spaces.">
          <UInput v-model="server.argsText" placeholder="-y @modelcontextprotocol/server-filesystem ." class="w-full" />
        </UFormField>
      </template>
      <UFormField label="Secrets & extra values" description="One per line, written NAME=value. For example an API token." class="span-2">
        <textarea
          v-model="server.envText"
          class="code-area"
          spellcheck="false"
          autocomplete="off"
          placeholder="API_TOKEN=paste-it-here"
          :aria-label="`Secrets for ${server.name || 'tool'}`"
        />
      </UFormField>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface ServerRow { uid: number; name: string; command: string; argsText: string; envText: string; url: string; remote?: boolean }

const props = defineProps<{ server: ServerRow }>();
const emit = defineEmits<{ (e: 'remove'): void }>();

const toolIcon = computed(() => mcpIconFor(props.server.name, props.server.command, props.server.argsText, props.server.url));
const remote = computed(() => props.server.remote ?? !!props.server.url.trim());

// The row object is owned by the page; mutating it here is intentional (same as v-model on its fields).
function setRemote(value: boolean) {
  const s = props.server;
  s.remote = value;
  if (value) {
    s.command = '';
    s.argsText = '';
  } else {
    s.url = '';
    if (!s.command) s.command = 'npx';
  }
}
</script>

<style scoped>
.server { padding: 1.25rem; border-radius: 0.875rem; border: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.server-top { display: flex; align-items: flex-end; gap: 0.875rem; }
.tool-tile { margin-bottom: 0.125rem; }
.server-top > :last-child { margin-left: auto; }
.name-field { flex: 1; max-width: 22rem; }
.mode { display: inline-flex; gap: 0.25rem; padding: 0.25rem; margin: 1rem 0; border-radius: 0.75rem; background: var(--ui-bg-elevated); flex-wrap: wrap; }
.mode-btn { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; padding: 0 0.875rem; border: 0; border-radius: 0.5rem; background: transparent; color: var(--wb-ink-soft); font-size: 0.875rem; font-weight: 600; cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.mode-btn:hover { color: var(--ui-text-highlighted); }
.mode-btn:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.mode-btn--on { background: var(--ui-bg); color: var(--ui-text-highlighted); box-shadow: 0 1px 2px rgb(0 0 0 / 0.1); }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 1.5rem; }
.span-2 { grid-column: 1 / -1; }
.code-area { width: 100%; min-height: 4.5rem; padding: 0.75rem; font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical; border: 1px solid var(--ui-border-accented); border-radius: 0.625rem; background: var(--ui-bg); color: var(--ui-text); }
.code-area:focus { outline: 2px solid var(--ui-primary); outline-offset: 1px; }
@media (max-width: 700px) {
  .fields { grid-template-columns: 1fr; }
  .server-top { flex-wrap: wrap; }
  .name-field { flex-basis: calc(100% - 4rem); }
  .name-field { max-width: none; }
}
</style>
