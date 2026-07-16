import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OwnedGearStorage } from '@/utils/storage'

export const useOwnedGearStore = defineStore('ownedGear', () => {
  const ownedCounts = ref<Record<number, number>>({})

  const saved = OwnedGearStorage.get()
  const counts: Record<number, number> = {}
  for (const uid of saved) {
    counts[uid] = (counts[uid] || 0) + 1
  }
  ownedCounts.value = counts

  function loadData() {
    const saved = OwnedGearStorage.get()
    const counts: Record<number, number> = {}
    for (const uid of saved) {
      counts[uid] = (counts[uid] || 0) + 1
    }
    ownedCounts.value = counts
  }

  function saveData() {
    const data: number[] = []
    for (const uid of Object.keys(ownedCounts.value).map(Number).sort((a, b) => a - b)) {
      const count = ownedCounts.value[uid] || 0
      for (let i = 0; i < count; i++) {
        data.push(uid)
      }
    }
    OwnedGearStorage.set(data)
  }

  function isOwned(uid: number): boolean {
    return getCount(uid) > 0
  }

  function getCount(uid: number): number {
    return ownedCounts.value[uid] || 0
  }

  function setCount(uid: number, count: number) {
    const next = Math.max(0, Math.floor(count))
    if (next <= 0) {
      delete ownedCounts.value[uid]
    } else {
      ownedCounts.value[uid] = next
    }
    ownedCounts.value = { ...ownedCounts.value }
    saveData()
  }

  function addCount(uid: number, delta: number) {
    setCount(uid, getCount(uid) + delta)
  }

  function toggleOwned(uid: number) {
    if (getCount(uid) > 0) {
      addCount(uid, -1)
    } else {
      addCount(uid, 1)
    }
  }

  function setOwned(uid: number, owned: boolean) {
    setCount(uid, owned ? 1 : 0)
  }

  function clearAll() {
    ownedCounts.value = {}
    saveData()
  }

  return {
    ownedCounts,
    loadData,
    saveData,
    isOwned,
    getCount,
    setCount,
    addCount,
    toggleOwned,
    setOwned,
    clearAll,
  }
})
