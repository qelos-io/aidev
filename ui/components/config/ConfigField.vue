<template>
  <UFormField :name="def.key" :description="def.help" class="cfg-field">
    <template #label>
      <span class="cfg-label">
        {{ def.label }}
        <span v-if="changed" class="cfg-edited">Edited</span>
      </span>
    </template>
    <template #hint>
      <span class="cfg-key">{{ def.key }}</span>
    </template>

    <div v-if="def.kind === 'bool'" class="cfg-switch">
      <USwitch
        :model-value="boolOn"
        :aria-label="def.label"
        @update:model-value="onToggle"
      />
      <span class="cfg-switch-text">{{ boolOn ? 'On' : 'Off' }}<template v-if="isUnset"> · default</template></span>
    </div>

    <USelect
      v-else-if="def.kind === 'select'"
      :model-value="modelValue"
      :items="def.options ?? []"
      :icon="selectedOption?.icon"
      :avatar="selectedOption?.avatar"
      :placeholder="def.placeholder ?? 'Use the default'"
      class="w-full"
      @update:model-value="emit('update:modelValue', String($event ?? ''))"
    />

    <UInput
      v-else
      :model-value="modelValue"
      :type="def.secret && !reveal ? 'password' : 'text'"
      :placeholder="def.placeholder ?? ''"
      autocomplete="off"
      class="w-full"
      :ui="def.secret ? { trailing: 'pe-1' } : undefined"
      @update:model-value="emit('update:modelValue', String($event ?? ''))"
    >
      <template v-if="def.secret" #trailing>
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="reveal ? 'Hide value' : 'Show value'"
          @click="reveal = !reveal"
        />
      </template>
    </UInput>
  </UFormField>
</template>

<script setup lang="ts">
export interface FieldDef {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  kind?: 'text' | 'bool' | 'select';
  /** For bool fields: the value aidev uses when the key is blank. */
  defaultOn?: boolean;
  options?: { label: string; value: string; icon?: string; avatar?: { src: string; alt?: string } }[];
}

const props = withDefaults(defineProps<{ def: FieldDef; modelValue?: string; changed?: boolean }>(), { modelValue: '' });
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const reveal = ref(false);
const selectedOption = computed(() => props.def.options?.find((o) => o.value === props.modelValue));
const isUnset = computed(() => (props.modelValue ?? '').trim() === '');
const boolOn = computed(() =>
  isUnset.value ? !!props.def.defaultOn : !/^(false|0|no|off)$/i.test(props.modelValue.trim()),
);
function onToggle(v: boolean) {
  emit('update:modelValue', v ? 'true' : 'false');
}
</script>

<style scoped>
.cfg-label { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--ui-text-highlighted); }
.cfg-edited {
  font-size: 0.6875rem; font-weight: 600; padding: 0.0625rem 0.4rem; border-radius: 999px;
  background: color-mix(in oklch, var(--wb-wait) 25%, transparent);
  color: var(--ui-text-highlighted);
}
.cfg-key { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--wb-ink-soft); }
.cfg-switch { display: flex; align-items: center; gap: 0.625rem; min-height: 2.25rem; }
.cfg-switch-text { font-size: 0.875rem; color: var(--wb-ink-soft); }
</style>
