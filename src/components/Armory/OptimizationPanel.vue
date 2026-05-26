<template>
  <div class="optimization-panel">
    <div v-if="optimizing" class="progress-bar-wrap">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: optimizationProgress + '%' }"></div>
      </div>
      <span class="progress-text">{{ optimizationProgress }}%</span>
    </div>

    <div v-if="solverError" class="error-box">{{ solverError }}</div>

    <div v-if="unfarmable.length > 0" class="warning-box">
      {{ $t('armory.unfarmableWarning', { count: unfarmable.length }) }}
    </div>

    <button
      class="upgrade-btn"
      type="button"
      :disabled="!canUpgrade || optimizing"
      @click="$emit('upgrade')"
    >
      {{ $t('armory.upgrade') }}
    </button>

    <div class="eq101-row">
      <button class="adj-btn" type="button" @click="$emit('dec-101')">−</button>
      <img :src="getAssetUrl('assets/icons/equipment_101.webp')" class="eq101-icon" />
      <span class="eq101-label">{{ $t('armory.equipment101') }}</span>
      <span
        v-if="!editing101"
        class="eq101-count"
        @click="startEdit101"
      >{{ equipment101Count }}</span>
      <input
        v-else
        type="number"
        min="0"
        :value="equipment101Count"
        class="eq101-input"
        @blur="commitEdit101(($event.target as HTMLInputElement).value)"
        @keydown.enter="commitEdit101(($event.target as HTMLInputElement).value)"
        @keydown.escape="cancelEdit101"
      />
      <button class="adj-btn" type="button" @click="$emit('inc-101')">+</button>
    </div>

    <div v-if="plan.length > 0" class="results">
      <div class="total-stamina">
        <div class="stamina-line">
          <img :src="getAssetUrl('assets/icons/stamina.webp')" class="summary-icon" />
          {{ $t('armory.totalStamina', { stamina: totalStamina, runs: totalRuns }) }}
        </div>
      </div>

      <div class="plan-list" ref="planListRef">
        <div v-if="equipment101Used > 0 && eq101ReplacedMats.length > 0" class="plan-row plan-row-eq101">
          <div class="plan-stage eq101-stage">
            <img :src="getAssetUrl('assets/icons/equipment_101.webp')" class="eq101-card-icon" />
            <span class="eq101-total-used">×{{ equipment101Used }}</span>
          </div>
          <div class="plan-drops plan-drops-eq101">
            <span v-for="mat in eq101ReplacedMats" :key="mat.uid" class="plan-drop plan-drop-eq101">
              <img
                :src="getGearImageUrl(mat.name)"
                :alt="matDisplayName(mat)"
                class="drop-icon"
                loading="lazy"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span class="drop-rate">×{{ mat.count }}</span>
            </span>
          </div>
        </div>
        <div
          v-for="row in plan"
          :key="row.stage"
          class="plan-row"
        >
          <div class="plan-stage">{{ row.stage }}</div>
          <div class="plan-runs">×{{ row.runs }}</div>
          <div class="plan-stamina">{{ row.stamina }}</div>
          <div class="plan-drops">
            <span v-for="d in row.expectedDrops" :key="d.uid" class="plan-drop">
              <img
                :src="getGearImageUrl(d.name)"
                :alt="d.name"
                class="drop-icon"
                loading="lazy"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span class="drop-info">
                <span class="drop-name">{{ dropName(d) }}</span>
                <span class="drop-rate">{{ (d.dropRate * 100).toFixed(0) }}%</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAssetUrl, getGearImageUrl } from '@/utils/assets'
import type { StagePlanRow, StageDrop, Eq101ReplacedMat } from '@/stores/armory'

const { locale } = useI18n()

const props = defineProps<{
  plan: StagePlanRow[]
  totalStamina: number
  optimizing: boolean
  optimizationProgress: number
  solverError: string | null
  unfarmable: number[]
  canUpgrade: boolean
  equipment101Count: number
  equipment101Used: number
  eq101ReplacedMats: Eq101ReplacedMat[]
}>()

const emit = defineEmits<{
  upgrade: []
  'dec-101': []
  'inc-101': []
  'set-101': [count: number]
}>()

const editing101 = ref(false)

function startEdit101() {
  editing101.value = true
  nextTick(() => {
    const el = document.querySelector('.eq101-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitEdit101(raw: string) {
  editing101.value = false
  const count = parseInt(raw, 10)
  if (!isNaN(count) && count >= 0) {
    emit('set-101', count)
  }
}

function cancelEdit101() {
  editing101.value = false
}

const totalRuns = computed(() => props.plan.reduce((sum, r) => sum + r.runs, 0))

function dropName(d: StageDrop): string {
  const raw = locale.value === 'en' ? d.nameEn : d.name
  return raw.replace(/\\n/g, ' ')
}

function matDisplayName(mat: Eq101ReplacedMat): string {
  return mat.name.replace(/\\n/g, ' ')
}
</script>

<style scoped>
.optimization-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  min-width: 2.5rem;
  text-align: right;
}

.error-box {
  padding: 0.75rem;
  background: var(--error-bg, rgba(239, 68, 68, 0.1));
  border-left: 3px solid var(--error-color, #ef4444);
  border-radius: 6px;
  color: var(--error-color, #ef4444);
  font-size: 0.8125rem;
}

.warning-box {
  padding: 0.75rem;
  background: var(--warning-bg);
  border-left: 3px solid var(--warning-color);
  border-radius: 6px;
  color: var(--warning-text);
  font-size: 0.8125rem;
}

.upgrade-btn {
  width: 100%;
  padding: 0.875rem;
  border: none;
  border-radius: 8px;
  background: var(--success-color, #22c55e);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  font-family: var(--site-font);
  cursor: pointer;
  transition: opacity 0.2s;
}

.upgrade-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.upgrade-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.eq101-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--panel-bg);
  border-radius: 8px;
}

.eq101-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.eq101-count {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 2rem;
  text-align: center;
  cursor: pointer;
  padding: 1px 3px;
}

.eq101-input {
  width: 3rem;
  padding: 1px 3px;
  border: 1px solid var(--primary-color);
  border-radius: 3px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: var(--site-font);
  font-weight: 700;
  text-align: center;
  outline: none;
  box-sizing: border-box;
  -moz-appearance: textfield;
}

.eq101-input::-webkit-inner-spin-button,
.eq101-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.total-stamina {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.75rem;
  background: var(--panel-bg);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 600;
}

.stamina-line {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.summary-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.eq101-icon, .stamina-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.stamina-icon {
  vertical-align: middle;
  margin-right: 0.25rem;
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

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 60vh;
  overflow-y: auto;
}

:where(.plan-row, .plan-row-eq101) {
  display: grid;
  gap: 0.5rem;
  align-items: center;
  padding: 0.625rem;
  border-radius: 8px;
  font-size: 0.8125rem;
}

.plan-row {
  grid-template-columns: 60px 50px 60px 1fr;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}

.plan-stage {
  font-weight: 600;
  color: var(--primary-color);
}

.plan-runs {
  color: var(--text-primary);
  text-align: center;
}

.plan-stamina {
  color: var(--text-secondary);
  text-align: right;
}

.plan-drops {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.plan-drop {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.drop-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  border-radius: 3px;
  background: var(--panel-bg);
}

.drop-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.drop-name {
  font-size: 0.6875rem;
  color: var(--text-primary);
  line-height: 1;
}

.drop-rate {
  font-size: 0.625rem;
  color: var(--text-secondary);
  line-height: 1;
}

.plan-row-eq101 {
  grid-template-columns: 56px 1fr;
  background: var(--panel-bg);
  border: 1px solid var(--warning-color, #f59e0b);
  opacity: 0.9;
}

.eq101-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.eq101-stage .eq101-card-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
}

.eq101-total-used {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--warning-color, #f59e0b);
  line-height: 1;
}

.plan-drops-eq101 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 42px));
  justify-content: end;
  gap: 2px;
  padding: 0;
}

.plan-drop-eq101 {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 2px 0;
}

.plan-drop-eq101 .drop-icon {
  width: 18px;
  height: 18px;
}

.plan-drop-eq101 .drop-rate {
  font-size: 0.625rem;
  line-height: 1;
}


</style>
