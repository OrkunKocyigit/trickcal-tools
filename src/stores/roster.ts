import { defineStore } from 'pinia'
import { ref } from 'vue'
import { RosterStorage } from '@/utils/storage'
import { useBoardStore } from './board'

export const GEAR_SLOTS = ['hat', 'weapon', 'accessory', 'bodyArmor', 'ring', 'boots'] as const
export type GearSlot = typeof GEAR_SLOTS[number]

export interface UnitProgress {
  currentRank: number
  equipment: (string | null)[]
}

export interface RosterData {
  [characterName: string]: UnitProgress
}

const DEFAULT_UNIT: UnitProgress = {
  currentRank: 1,
  equipment: [null, null, null, null, null, null],
}

function ensureOwnedInBoard(characterName: string) {
  const boardStore = useBoardStore()
  if (!boardStore.userProgress.ownedCharacters.has(characterName)) {
    boardStore.userProgress.ownedCharacters.add(characterName)
    boardStore.saveUserProgress()
  }
}

export const useRosterStore = defineStore('roster', () => {
  const rosterData = ref<RosterData>({})

  function loadData() {
    const saved = RosterStorage.get<RosterData>()
    if (saved) {
      rosterData.value = saved
    }
  }

  function saveData() {
    RosterStorage.set(rosterData.value)
  }

  function getUnitProgress(characterName: string): UnitProgress {
    return rosterData.value[characterName] ?? { ...DEFAULT_UNIT, equipment: [...DEFAULT_UNIT.equipment] }
  }

  function ensureUnitProgress(characterName: string): UnitProgress {
    if (!rosterData.value[characterName]) {
      rosterData.value[characterName] = { ...DEFAULT_UNIT, equipment: [...DEFAULT_UNIT.equipment] }
    }
    return rosterData.value[characterName]
  }

  function setUnitRank(characterName: string, rank: number) {
    ensureOwnedInBoard(characterName)
    ensureUnitProgress(characterName).currentRank = rank
    saveData()
  }

  function setEquippedGear(characterName: string, slotIndex: number, gearName: string | null) {
    ensureOwnedInBoard(characterName)
    ensureUnitProgress(characterName).equipment[slotIndex] = gearName
    saveData()
  }

  function clearAll() {
    rosterData.value = {}
    saveData()
  }

  return {
    rosterData,
    loadData,
    saveData,
    getUnitProgress,
    ensureUnitProgress,
    setUnitRank,
    setEquippedGear,
    clearAll,
  }
})
