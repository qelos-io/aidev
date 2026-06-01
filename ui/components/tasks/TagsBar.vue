<template>
  <div class="tags-bar" :class="{ 'tags-bar--saving': saving }">
    <!-- Mutex pairs as joined button-groups -->
    <div v-for="(group, gi) in mutexGroups" :key="gi" class="btn-group">
      <button
        v-for="st in group"
        :key="st.tag"
        type="button"
        class="btn-seg"
        :class="{ 'btn-seg--on': modelValue.includes(st.tag) }"
        :disabled="saving"
        @click="toggle(st.tag, st.label)"
      >
        {{ st.label }}
      </button>
    </div>

    <!-- Independent singleton tags -->
    <button
      v-for="st in singletonList"
      :key="st.tag"
      type="button"
      class="tag-chip"
      :class="{ 'tag-chip--on': modelValue.includes(st.tag) }"
      :disabled="saving"
      @click="toggle(st.tag, st.label)"
    >
      {{ st.label }}
    </button>

    <!-- Other (non-suggested) tags with remove button — shown in edit mode -->
    <template v-if="otherTags && otherTags.length > 0">
      <span
        v-for="tag in otherTags"
        :key="tag"
        class="tag-chip tag-chip--on tag-chip--other"
      >
        {{ tag }}
        <button
          type="button"
          class="tag-chip-remove"
          :disabled="saving"
          :aria-label="`Remove tag ${tag}`"
          @click="emit('removeOther', tag)"
        >
          <UIcon name="i-heroicons-x-mark" />
        </button>
      </span>
    </template>

    <span v-if="suggestedTags.length === 0 && !otherTags?.length" class="muted-empty">
      No tags.
    </span>
  </div>
</template>

<script setup lang="ts">
import type { SuggestedTag } from '~/types/tasks';

const props = defineProps<{
  modelValue: string[];       // currently active tag values
  suggestedTags: SuggestedTag[];
  otherTags?: string[];       // non-suggested active tags (edit mode only)
  saving?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [tags: string[]];
  removeOther: [tag: string];
}>();

const MUTEX_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['code', 'non-code']),
  new Set(['planning', 'thinking']),
];

function mutexGroup(label: string): ReadonlySet<string> | undefined {
  return MUTEX_GROUPS.find((g) => g.has(label));
}

const mutexGroups = computed(() => {
  const result: SuggestedTag[][] = [];
  const placed = new Set<string>();
  for (const s of props.suggestedTags) {
    if (placed.has(s.label)) continue;
    const group = MUTEX_GROUPS.find((g) => g.has(s.label));
    if (group) {
      const members = props.suggestedTags.filter((t) => group.has(t.label));
      members.forEach((m) => placed.add(m.label));
      result.push(members);
    }
  }
  return result;
});

const singletonList = computed(() =>
  props.suggestedTags.filter((s) => !mutexGroup(s.label)),
);

function toggle(tag: string, label: string) {
  const active = [...props.modelValue];
  const idx = active.indexOf(tag);
  const group = mutexGroup(label);

  if (idx === -1) {
    if (group) {
      // Remove any active sibling in the same mutex group
      const siblings = props.suggestedTags
        .filter((s) => group.has(s.label) && s.tag !== tag)
        .map((s) => s.tag);
      for (const sib of siblings) {
        const si = active.indexOf(sib);
        if (si !== -1) active.splice(si, 1);
      }
    }
    active.push(tag);
  } else {
    active.splice(idx, 1);
  }

  emit('update:modelValue', active);
}
</script>

<style scoped>
.tags-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.tags-bar--saving {
  opacity: 0.65;
  pointer-events: none;
}
.muted-empty {
  font-size: 0.78rem;
  color: #94a3b8;
}

.btn-group { display: inline-flex; }
.btn-seg {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1;
  padding: 0.25rem 0.55rem;
  white-space: nowrap;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.btn-seg:first-child { border-radius: 0.3rem 0 0 0.3rem; }
.btn-seg:last-child  { border-radius: 0 0.3rem 0.3rem 0; }
.btn-seg + .btn-seg  { margin-left: -1px; }
.btn-seg:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #334155;
  z-index: 1;
  position: relative;
}
.btn-seg:disabled { cursor: default; opacity: 0.5; }
.btn-seg--on {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
  z-index: 1;
  position: relative;
}
.btn-seg--on:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1;
  border-radius: 0.3rem;
  padding: 0.25rem 0.55rem;
  white-space: nowrap;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.tag-chip:hover:not(:disabled) {
  border-color: #94a3b8;
  background: #f1f5f9;
  color: #334155;
}
.tag-chip:disabled { cursor: default; opacity: 0.5; }
.tag-chip--on {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1e40af;
}
.tag-chip--on:hover:not(:disabled) {
  background: #bfdbfe;
  border-color: #60a5fa;
}
.tag-chip--other {
  cursor: default;
  padding-right: 0.3rem;
}
.tag-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-left: 0.05rem;
  padding: 0;
  border: none;
  border-radius: 0.2rem;
  background: transparent;
  color: #1e40af;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.1s, background 0.1s;
}
.tag-chip-remove:hover:not(:disabled) {
  opacity: 1;
  background: rgba(30, 64, 175, 0.1);
}
.tag-chip-remove:disabled { cursor: default; opacity: 0.3; }
.tag-chip-remove :deep(svg) { width: 0.65rem; height: 0.65rem; }
</style>
