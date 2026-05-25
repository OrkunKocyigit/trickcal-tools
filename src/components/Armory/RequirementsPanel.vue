<template>
  <div v-if="matList.length === 0" class="empty-state">
    {{ $t('armory.noRequirements') }}
  </div>

  <div v-else class="req-grid">
    <div
      v-for="m in matList"
      :key="m.uid"
      class="req-card"
      :class="{ met: m.have >= m.need }"
    >
      <img
        :src="getGearImageUrl(m.name)"
        :alt="m.name"
        class="card-icon"
        loading="lazy"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div class="card-name">{{ namePrefix(m) }}</div>
      <div v-if="nameSuffix(m)" class="card-tier">{{ nameSuffix(m) }}</div>
      <div class="card-shortage">{{ shortageText(m) }}</div>
      <div class="card-footer">
        <div class="mat-adj-group">
          <button class="adj-btn" type="button" @click="$emit('set-material-zero', m.uid)">«</button>
          <button class="adj-btn" type="button" @click="$emit('dec-material', m.uid)">−</button>
          <span
            v-if="editingUid !== m.uid"
            class="adj-count"
            @click="startEdit(m.uid)"
          >{{ m.have }}</span>
          <input
            v-else
            type="number"
            min="0"
            :value="m.have"
            class="adj-input"
            @blur="commitEdit(m.uid, ($event.target as HTMLInputElement).value)"
            @keydown.enter="commitEdit(m.uid, ($event.target as HTMLInputElement).value)"
            @keydown.escape="cancelEdit"
          />
          <button class="adj-btn" type="button" @click="$emit('inc-material', m.uid)">+</button>
          <button class="adj-btn" type="button" @click="$emit('set-material-need', m.uid)">»</button>
        </div>
        <span v-if="!m.farmable" class="unfarmable-tag">{{ $t('armory.unfarmable') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getGearImageUrl } from '@/utils/assets'
import type { MaterialRequirement } from '@/stores/armory'

const { locale } = useI18n()

defineProps<{
  matList: MaterialRequirement[]
}>()

const emit = defineEmits<{
  'dec-material': [uid: number]
  'inc-material': [uid: number]
  'set-material-zero': [uid: number]
  'set-material-need': [uid: number]
  'set-material-count': [uid: number, count: number]
}>()

const editingUid = ref<number | null>(null)

function startEdit(uid: number) {
  editingUid.value = uid
  nextTick(() => {
    const el = document.querySelector('.adj-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitEdit(uid: number, raw: string) {
  editingUid.value = null
  const count = parseInt(raw, 10)
  if (!isNaN(count) && count >= 0) {
    emit('set-material-count', uid, count)
  }
}

function cancelEdit() {
  editingUid.value = null
}

function displayName(m: MaterialRequirement): string {
  return (locale.value === 'en' ? m.nameEn : m.name).replace(/\\n/g, ' ')
}

function namePrefix(m: MaterialRequirement): string {
  const name = displayName(m)
  const idx = Math.max(name.lastIndexOf('('), name.lastIndexOf('\uff08'))
  if (idx > 0) return name.slice(0, idx).trimEnd()
  return name
}

function nameSuffix(m: MaterialRequirement): string {
  const name = displayName(m)
  const idx = Math.max(name.lastIndexOf('('), name.lastIndexOf('\uff08'))
  if (idx > 0) return name.slice(idx)
  return ''
}

function shortageText(m: MaterialRequirement): string {
  const diff = m.need - m.have
  if (diff <= 0) return '✓'
  return `-${diff}`
}
</script>

<style scoped>
.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.req-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.req-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.5rem 0.375rem;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: opacity 0.2s, border-color 0.2s;
  min-width: 0;
}

.req-card.met {
  opacity: 0.55;
}

.card-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--panel-bg);
  flex-shrink: 0;
}

.card-name {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-primary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  line-height: 1.2;
}

.card-tier {
  font-size: 0.625rem;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.2;
}

.card-shortage {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--warning-color, #f59e0b);
  line-height: 1.2;
}

.req-card.met .card-shortage {
  color: var(--success-color, #4caf50);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  width: 100%;
  margin-top: 2px;
}

.mat-adj-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.adj-btn {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.adj-btn:hover {
  border-color: var(--primary-color);
}

.adj-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  width: 3rem;
  text-align: center;
  cursor: pointer;
  padding: 1px 3px;
}

.adj-input {
  width: 3rem;
  padding: 1px 3px;
  border: 1px solid var(--primary-color);
  border-radius: 3px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-family: var(--site-font);
  text-align: center;
  outline: none;
  box-sizing: border-box;
  -moz-appearance: textfield;
}

.adj-input::-webkit-inner-spin-button,
.adj-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.unfarmable-tag {
  font-size: 0.5625rem;
  color: var(--warning-color, #f59e0b);
  border: 1px solid var(--warning-color, #f59e0b);
  border-radius: 3px;
  padding: 1px 3px;
  white-space: nowrap;
}

@media (max-width: 1200px) {
  .req-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .req-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
