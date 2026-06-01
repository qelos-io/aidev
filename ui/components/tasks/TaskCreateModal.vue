<template>
  <UModal :model-value="open" :ui="{ width: 'sm:max-w-xl' }" @update:model-value="emit('update:open', $event)">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">New Task</h2>
          <UButton size="xs" color="gray" variant="ghost" @click="emit('close')">Close</UButton>
        </div>
      </template>

      <UAlert
        v-if="error"
        color="red"
        variant="soft"
        :title="error"
        class="mb-4"
      />

      <form class="create-form" @submit.prevent="submit">
        <div class="field">
          <label class="field-label">Title <span class="required">*</span></label>
          <UInput
            v-model="form.title"
            placeholder="Task title"
            autofocus
            :disabled="saving"
          />
        </div>

        <div class="field">
          <label class="field-label">Description</label>
          <UTextarea
            v-model="form.description"
            placeholder="Optional description…"
            :rows="4"
            :disabled="saving"
          />
        </div>

        <div v-if="suggestedTags.length > 0" class="field">
          <label class="field-label">Tags</label>
          <TasksTagsBar
            v-model="form.tags"
            :suggested-tags="suggestedTags"
            :saving="saving"
          />
        </div>

        <div class="field">
          <label class="field-label">Priority</label>
          <USelect
            v-model="form.priority"
            :options="priorityOptions"
            value-attribute="value"
            option-attribute="label"
            :disabled="saving"
          />
        </div>

        <div class="actions">
          <UButton
            color="gray"
            variant="ghost"
            :disabled="saving"
            @click="emit('close')"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            color="primary"
            :loading="saving"
            :disabled="!form.title.trim() || saving"
          >
            Create Task
          </UButton>
        </div>
      </form>
    </UCard>
  </UModal>
</template>

<script setup lang="ts">
import type { SuggestedTag } from '~/types/tasks';

const props = defineProps<{
  open: boolean;
  saving: boolean;
  error: string;
  suggestedTags: SuggestedTag[];
}>();

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'close'): void;
  (e: 'submit', params: { title: string; description: string; tags: string[]; priority?: number }): void;
}>();

const priorityOptions = [
  { label: '— none —', value: '' },
  { label: 'Urgent', value: '1' },
  { label: 'High', value: '2' },
  { label: 'Medium', value: '3' },
  { label: 'Low', value: '4' },
];

const defaultCodeTag = computed(() => {
  const code = props.suggestedTags.find((t) => t.label === 'code');
  return code?.tag ?? '';
});

const form = reactive({
  title: '',
  description: '',
  tags: [] as string[],
  priority: '',
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      form.title = '';
      form.description = '';
      form.tags = defaultCodeTag.value ? [defaultCodeTag.value] : [];
      form.priority = '';
    }
  },
);

function submit() {
  if (!form.title.trim()) return;
  const priority = form.priority ? parseInt(form.priority, 10) : undefined;
  emit('submit', {
    title: form.title.trim(),
    description: form.description.trim(),
    tags: [...form.tags],
    priority,
  });
}
</script>

<style scoped>
.create-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.required { color: #ef4444; }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
}
</style>
