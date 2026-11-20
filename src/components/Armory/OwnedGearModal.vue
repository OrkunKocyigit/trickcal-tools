<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-panel">
        <header class="modal-header">
          <h2>{{ $t('armory.ownedGearTitle') }}</h2>
          <button class="close-btn" type="button" @click="$emit('close')">✕</button>
        </header>

        <div class="modal-body">
          <p v-if="rankGroups.length === 0" class="empty-note">{{ $t('armory.noRequirements') }}</p>
          <div v-for="group in rankGroups" :key="group.rank" class="rank-group">
            <div class="rank-group-header">{{ $t('armory.rankHeader', { rank: group.rank }) }}</div>
            <div class="gear-grid">
                <div
                  v-for="g in group.slots"
                  :key="g.uid"
                  class="gear-card"
                  :class="{ owned: g.count > 0 }"
                >
                <img
                  :src="getGearImageUrl(g.name)"
                  :alt="g.name"
                  class="gear-icon"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <div class="gear-name">{{ displayName(g) }}</div>
                <div class="gear-slot">{{ $t(`armory.slot${g.slotIdx}`) }}</div>
                <div class="gear-count-row">
                  <button class="gear-count-btn" type="button" @click.stop="dec(g.uid)">−</button>
                  <span
                    v-if="editingUid !== g.uid"
                    class="gear-count"
                    @click.stop="startEdit(g.uid)"
                  >{{ g.count }}</span>
                  <input
                    v-else
                    type="number"
                    min="0"
                    class="gear-count-input"
                    :value="g.count"
                    @blur="commitEdit(g.uid, ($event.target as HTMLInputElement).value)"
                    @keydown.enter="commitEdit(g.uid, ($event.target as HTMLInputElement).value)"
                    @keydown.escape="cancelEdit"
                  />
                  <button class="gear-count-btn" type="button" @click.stop="inc(g.uid)">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArmoryStore } from '@/stores/armory'
import { useOwnedGearStore } from '@/stores/ownedGear'
import { getGearImageUrl } from '@/utils/assets'

const { locale } = useI18n()
const armoryStore = useArmoryStore()
const ownedGearStore = useOwnedGearStore()
const editingUid = ref<number | null>(null)

defineEmits<{
  close: []
}>()

interface GearDisplayInfo {
  uid: number
  name: string
  nameEn: string
  slotIdx: number
  count: number
}

const rankGroups = computed(() =>
  armoryStore.ownedGearWindow.map(({ rank, slots }) => ({
    rank,
    slots: slots.map(({ uid, slotIdx }): GearDisplayInfo => {
      const info = armoryStore.getGearNameByUid(uid)
      return {
        uid,
        name: info.name,
        nameEn: info.nameEn,
        slotIdx,
        count: ownedGearStore.getCount(uid),
      }
    }),
  })),
)

function displayName(g: GearDisplayInfo): string {
  return locale.value === 'en' ? g.nameEn : g.name
}

function startEdit(uid: number) {
  editingUid.value = uid
  nextTick(() => {
    const el = document.querySelector('.gear-count-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitEdit(uid: number, raw: string) {
  editingUid.value = null
  const count = parseInt(raw, 10)
  if (!isNaN(count) && count >= 0) {
    ownedGearStore.setCount(uid, count)
  }
}

function cancelEdit() {
  editingUid.value = null
}

function inc(uid: number) {
  ownedGearStore.addCount(uid, 1)
}

function dec(uid: number) {
  ownedGearStore.addCount(uid, -1)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-panel {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  width: 90%;
  max-width: 640px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.125rem;
  cursor: pointer;
}

.close-btn:hover {
  background: var(--hover-bg);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.empty-note {
  margin: 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.rank-group {
  margin-bottom: 1.25rem;
}

.rank-group:last-child {
  margin-bottom: 0;
}

.rank-group-header {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid var(--border-color);
}

.gear-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.gear-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.5rem;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: default;
  transition: all 0.2s;
  opacity: 0.85;
}

.gear-card.owned {
  opacity: 1;
  border-color: var(--primary-color);
}

.gear-card:hover {
  border-color: var(--primary-color);
}

.gear-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--card-bg);
}

.gear-name {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-primary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.gear-slot {
  font-size: 0.625rem;
  color: var(--text-secondary);
}

.gear-count-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.gear-count-btn {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}

.gear-count {
  min-width: 1.5rem;
  text-align: center;
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 0.125rem;
}

.gear-count-input {
  width: 3rem;
  padding: 1px 3px;
  border: 1px solid var(--primary-color);
  border-radius: 3px;
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: 0.625rem;
  font-family: var(--site-font);
  text-align: center;
  outline: none;
  box-sizing: border-box;
  -moz-appearance: textfield;
}

.gear-count-input::-webkit-inner-spin-button,
.gear-count-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.gear-card.owned .gear-count {
  color: var(--primary-color);
}
</style>
