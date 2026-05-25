import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OwnedGearStorage } from '@/utils/storage'

export const useOwnedGearStore = defineStore('ownedGear', () => {
  const ownedUids = ref<Set<number>>(new Set())

  function loadData() {
    const saved = OwnedGearStorage.get()
    if (saved) {
      ownedUids.value = new Set(saved)
    }
  }

  function saveData() {
    OwnedGearStorage.set([...ownedUids.value])
  }

  function isOwned(uid: number): boolean {
    return ownedUids.value.has(uid)
  }

  function toggleOwned(uid: number) {
    if (ownedUids.value.has(uid)) {
      ownedUids.value.delete(uid)
    } else {
      ownedUids.value.add(uid)
    }
    ownedUids.value = new Set(ownedUids.value)
    saveData()
  }

  function setOwned(uid: number, owned: boolean) {
    if (owned) {
      ownedUids.value.add(uid)
    } else {
      ownedUids.value.delete(uid)
    }
    ownedUids.value = new Set(ownedUids.value)
    saveData()
  }

  function clearAll() {
    ownedUids.value = new Set()
    saveData()
  }

  return {
    ownedUids,
    loadData,
    saveData,
    isOwned,
    toggleOwned,
    setOwned,
    clearAll,
  }
})
