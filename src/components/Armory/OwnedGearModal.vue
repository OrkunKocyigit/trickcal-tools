<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-panel">
        <header class="modal-header">
          <h2>{{ $t('armory.ownedGearTitle') }}</h2>
          <button class="close-btn" type="button" @click="$emit('close')">✕</button>
        </header>

        <div class="modal-body">
          <div v-for="rank in rankList" :key="rank" class="rank-group">
            <div class="rank-group-header">Rank {{ rank }}</div>
            <div class="gear-grid">
              <div
                v-for="g in gearByRank(rank)"
                :key="g.uid"
                class="gear-card"
                :class="{ owned: g.owned }"
                @click="toggle(g.uid)"
              >
                <img
                  :src="getGearImageUrl(g.name)"
                  :alt="g.name"
                  class="gear-icon"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <div class="gear-name">{{ locale === 'en' ? g.nameEn : g.name }}</div>
                <div class="gear-slot">{{ $t(`armory.slot${g.slotIdx}`) }}</div>
                <div class="gear-check">{{ g.owned ? '✓' : '○' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArmoryStore } from '@/stores/armory'
import { useOwnedGearStore } from '@/stores/ownedGear'
import { getGearImageUrl } from '@/utils/assets'

const { locale } = useI18n()
const armoryStore = useArmoryStore()
const ownedGearStore = useOwnedGearStore()

defineEmits<{
  close: []
}>()

interface GearSlotInfo {
  uid: number
  name: string
  nameEn: string
  slotIdx: number
  owned: boolean
}

const rankList = computed(() => {
  const charName = armoryStore.selectedCharacter
  if (!charName) return []
  const char = armoryStore.charData[charName]
  if (!char) return []
  const gear = (char as any)?.gear
  if (!gear) return []
  return gear.map((_: unknown, idx: number) => idx + 1).filter((r: number) => {
    const g = gear[r - 1]
    return g && g.length === 6
  })
})

function gearByRank(rank: number): GearSlotInfo[] {
  const charName = armoryStore.selectedCharacter
  if (!charName) return []
  const char = armoryStore.charData[charName]
  if (!char) return []
  const gear = (char as any)?.gear
  if (!gear) return []
  const rankGear = gear[rank - 1]
  if (!rankGear) return []
  return rankGear.map((uid: number, slotIdx: number) => {
    const info = armoryStore.getGearNameByUid(uid)
    return {
      uid,
      name: info.name,
      nameEn: info.nameEn,
      slotIdx,
      owned: ownedGearStore.isOwned(uid),
    }
  })
}

function toggle(uid: number) {
  ownedGearStore.toggleOwned(uid)
  armoryStore.computeRequirements()
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
  cursor: pointer;
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

.gear-check {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  color: var(--text-secondary);
}

.gear-card.owned .gear-check {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}
</style>
