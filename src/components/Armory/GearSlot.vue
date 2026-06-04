<template>
  <div
    class="gear-slot"
    :class="gearSlotClass"
    @click="toggleOwnedForSlot"
  >
    <button
      class="slot-radio"
      :class="{ checked: isSlotOwned }"
      type="button"
      @click.stop="toggleOwnedForSlot"
      :aria-label="'Toggle ' + slotGearDisplayName"
    >
      <span class="radio-dot"></span>
    </button>
    <img
      v-if="slotGearName"
      :src="getGearImageUrl(slotGearName)"
      :alt="slotGearName"
      class="slot-icon"
      loading="lazy"
      @error="($event.target as HTMLImageElement).style.display = 'none'"
    />
    <div class="slot-label">{{ $t(`armory.slot${slotIndex}`) }}</div>
    <div class="slot-gear-name">{{ slotGearDisplayName }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArmoryStore } from '@/stores/armory'
import { useRosterStore } from '@/stores/roster'
import { useOwnedGearStore } from '@/stores/ownedGear'
import { getGearImageUrl } from '@/utils/assets'

const props = defineProps<{
  slotIndex: number
  selectedChar: string
}>()

const { locale } = useI18n()
const armoryStore = useArmoryStore()
const rosterStore = useRosterStore()
const ownedGearStore = useOwnedGearStore()

const slotGearUid = computed(() => {
  const charName = props.selectedChar
  if (!charName) return null
  const char = armoryStore.charData[charName]
  if (!char) return null
  const gear = char.gear
  if (!gear) return null
  const currentRank = rosterStore.getUnitProgress(props.selectedChar).currentRank
  const rankIdx = currentRank - 1
  if (!gear[rankIdx]) return null
  return gear[rankIdx][props.slotIndex] as number
})

const slotGearName = computed(() => {
  const uid = slotGearUid.value
  if (!uid) return ''
  const info = armoryStore.getGearNameByUid(uid)
  return info.name
})

const slotGearDisplayName = computed(() => {
  const uid = slotGearUid.value
  if (!uid) return ''
  const info = armoryStore.getGearNameByUid(uid)
  return locale.value === 'en' ? info.nameEn : info.name
})

const isSlotOwned = computed(() => {
  const uid = slotGearUid.value
  if (!uid) return false
  const roster = rosterStore.rosterData[props.selectedChar]
  if (roster) {
    const equippedName = roster.equipment[props.slotIndex]
    if (equippedName) {
      const nameToUid = armoryStore.getNameToUidMap()
      const rosterUid = nameToUid.get(equippedName)
      if (rosterUid === uid) return true
    }
  }
  return false
})

const gearSlotClass = computed(() => ({
  equipped: isSlotOwned.value
}))

function toggleOwnedForSlot() {
  const uid = slotGearUid.value
  if (!uid) return
  const name = slotGearName.value
  if (!name) return
  const currentEquipped = rosterStore.rosterData[props.selectedChar]?.equipment[props.slotIndex]
  if (currentEquipped === name) {
    rosterStore.setEquippedGear(props.selectedChar, props.slotIndex, null)
  } else {
    rosterStore.setEquippedGear(props.selectedChar, props.slotIndex, name)
    if (ownedGearStore.getCount(uid) > 0) {
      ownedGearStore.addCount(uid, -1)
    }
  }
  armoryStore.computeRequirements()
}
</script>

<style scoped>
.gear-slot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  opacity: 0.65;
  filter: grayscale(0.85);
}

.gear-slot.equipped {
  opacity: 1;
  filter: none;
  border-color: var(--primary-color);
}

.gear-slot:hover {
  border-color: var(--primary-color);
}

.slot-radio {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--text-secondary);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
}

.slot-radio .radio-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
  transition: background 0.2s;
}

.slot-radio.checked {
  border-color: var(--primary-color);
  background: var(--primary-color);
}

.slot-radio.checked .radio-dot {
  background: #fff;
}

.slot-radio:hover {
  border-color: var(--primary-color);
}

.slot-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
  background: var(--card-bg);
}

.slot-label {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  min-width: 2.5rem;
}

.slot-gear-name {
  font-size: 0.6875rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
</style>
