import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MaterialInventoryStorage } from '@/utils/storage'

export const useMaterialInventoryStore = defineStore('materialInventory', () => {
  const inventory = ref<Record<number, number>>({})

  function loadData() {
    const saved = MaterialInventoryStorage.get()
    if (saved) {
      inventory.value = saved
    }
  }

  function saveData() {
    MaterialInventoryStorage.set(inventory.value)
  }

  function getCount(materialUid: number): number {
    return inventory.value[materialUid] ?? 0
  }

  function setCount(materialUid: number, count: number) {
    if (count <= 0) {
      delete inventory.value[materialUid]
    } else {
      inventory.value[materialUid] = count
    }
    saveData()
  }

  function addCount(materialUid: number, delta: number) {
    const current = getCount(materialUid)
    setCount(materialUid, Math.max(0, current + delta))
  }

  function clearAll() {
    inventory.value = {}
    saveData()
  }

  return {
    inventory,
    loadData,
    saveData,
    getCount,
    setCount,
    addCount,
    clearAll,
  }
})
