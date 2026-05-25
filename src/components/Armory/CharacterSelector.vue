<template>
  <div class="character-selector">
    <label for="char-select">{{ $t('armory.selectCharacter') }}</label>
    <select
      id="char-select"
      :value="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>{{ $t('armory.chooseCharacter') }}</option>
      <option v-for="c in charList" :key="c.name" :value="c.name">
        {{ displayName(c) }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: string
  charList: { name: string; en: string }[]
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

const { locale } = useI18n()

function displayName(c: { name: string; en: string }): string {
  return locale.value === 'en' ? c.en : c.name
}
</script>

<style scoped>
.character-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.character-selector label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.character-selector select {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-family: var(--site-font);
  appearance: auto;
  cursor: pointer;
}

.character-selector select:focus {
  outline: none;
  border-color: var(--primary-color);
}
</style>
