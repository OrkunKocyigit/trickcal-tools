import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch } from 'vue'
import { Logger } from '@/utils/logger'
import i18n from '@/i18n'
import { useRosterStore } from './roster'
import { useMaterialInventoryStore } from './materialInventory'
import { useOwnedGearStore } from './ownedGear'
import {
  Equipment101Storage,
  SelectedCharactersStorage,
  Storage,
  TargetRankStorage,
} from '@/utils/storage'
import { STORAGE_KEYS } from '@/constants'
import type {
  CharacterInput,
  CharactersData,
  Eq101ReplacedMat,
  GearDb,
  MaterialDb,
  MaterialRequirement,
  StageDrop,
  StageIndex,
  StagePlanRow,
  StaticData,
  Stock,
  SweepData,
} from '@/utils/armory/types'
import { MAX_SELECTED, STAMINA_PER_RUN } from '@/utils/armory/constants'
import { allSlotsEquipped, buildStageIndex, computeNeeds, computeUpgrade, solverBudget } from '@/utils/armory/needs'
import type { NeedsResult, UpgradeResult } from '@/utils/armory/needs'
import { problemKey } from '@/utils/armory/lpModel'
import { clampTarget, sanitizeSelection } from '@/utils/armory/selection'
import { createSolverService, createWorkerSolve } from '@/services/armorySolver'
import type { SolverService, SolverView } from '@/services/armorySolver'

export type { Eq101ReplacedMat, GearDb, MaterialDb, MaterialRequirement, StageDrop, StagePlanRow }

const DEBOUNCE_MS = 500
const UPGRADE_GUARD_MS = 500
const DEFAULT_MAX_RANK = 8
const SLOT_COUNT = 6

const EMPTY_VIEW: SolverView = { key: '', result: null, solving: false, stale: false, error: null }

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function toCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
}

export const useArmoryStore = defineStore('armory', () => {
  const gearDb = ref<GearDb>({})
  const materialDb = ref<MaterialDb>({})
  const charData = ref<CharactersData>({})
  const sweepData = ref<SweepData>({})
  const isLoaded = ref(false)
  const loading = ref(false)

  const selectedCharacters = ref<string[]>([])
  const openPanel = ref<string | null>(null)
  const focusedCharacter = ref<string | null>(null)
  const targetRanks = ref<Record<string, number>>(TargetRankStorage.get())
  const equipment101Count = ref(0)

  const stageIndex = shallowRef<StageIndex | null>(null)
  const view = shallowRef<SolverView>(EMPTY_VIEW)
  const debouncePending = ref(false)

  let service: SolverService | null = null
  let workerSolve: ReturnType<typeof createWorkerSolve> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastRequestedKey: string | null = null
  let active = false
  let loadPromise: Promise<void> | null = null
  const lastUpgradeAt = new Map<string, number>()

  const staticData = computed<StaticData>(() => ({
    gearDb: gearDb.value,
    materialDb: materialDb.value,
    charData: charData.value,
    sweepData: sweepData.value,
  }))

  function isKnown(name: string): boolean {
    return hasOwn(charData.value, name) && Array.isArray(charData.value[name].gear)
  }

  const charList = computed(() =>
    Object.keys(charData.value)
      .filter(isKnown)
      .map((name) => ({ name, en: charData.value[name].en || name }))
      .sort((a, b) => a.en.localeCompare(b.en)),
  )

  function maxRankOf(name: string): number {
    if (!hasOwn(charData.value, name)) return DEFAULT_MAX_RANK
    return charData.value[name].gear?.length || DEFAULT_MAX_RANK
  }

  function currentRankOf(name: string): number {
    const raw = useRosterStore().getUnitProgress(name).currentRank
    return Number.isInteger(raw) ? Math.min(maxRankOf(name), Math.max(1, raw)) : 1
  }

  function equipmentOf(name: string): (string | null)[] {
    const equipment = useRosterStore().getUnitProgress(name).equipment
    return Array.isArray(equipment) ? equipment : []
  }

  /** Lowest sensible target: one above the current rank once all its slots are equipped (unless at max rank). */
  function minTargetOf(name: string): number {
    const current = currentRankOf(name)
    if (current >= maxRankOf(name)) return current
    const equipped = allSlotsEquipped(
      { name, currentRank: current, targetRank: current, equipment: equipmentOf(name) },
      staticData.value,
    )
    return equipped ? current + 1 : current
  }

  function targetRankOf(name: string): number {
    const stored = hasOwn(targetRanks.value, name) ? targetRanks.value[name] : undefined
    return Math.max(clampTarget(stored, currentRankOf(name), maxRankOf(name)), minTargetOf(name))
  }

  function inputOf(name: string): CharacterInput {
    return {
      name,
      currentRank: currentRankOf(name),
      targetRank: targetRankOf(name),
      equipment: equipmentOf(name),
    }
  }

  const stock = computed<Stock>(() => ({
    ownedGear: useOwnedGearStore().ownedCounts,
    inventory: useMaterialInventoryStore().inventory,
    tokens: equipment101Count.value,
  }))

  const activeNeeds = computed<NeedsResult>(() => {
    const names = focusedCharacter.value ? [focusedCharacter.value] : selectedCharacters.value
    return computeNeeds(names.map(inputOf), staticData.value, stock.value, stageIndex.value ?? undefined)
  })

  const ownedGearWindow = computed(() => activeNeeds.value.gearWindow)

  function getGearNameByUid(uid: number): { name: string; nameEn: string; type: string } {
    const entry = gearDb.value[String(uid)]
    if (entry) return { name: entry.name, nameEn: entry.nameEn, type: entry.type }
    const matEntry = materialDb.value[String(uid)]
    if (matEntry) return { name: matEntry.name, nameEn: matEntry.nameEn, type: 'material' }
    const fallback = i18n.global.t('errors.unknownUid', { uid })
    return { name: fallback, nameEn: fallback, type: 'unknown' }
  }

  function getNameToUidMap(): Map<string, number> {
    const map = new Map<string, number>()
    for (const entry of Object.values(gearDb.value)) {
      map.set(entry.name, entry.uid)
    }
    for (const entry of Object.values(materialDb.value)) {
      map.set(entry.name, entry.uid)
    }
    return map
  }

  const materialNeeds = computed<MaterialRequirement[]>(() =>
    activeNeeds.value.materials.map((m) => {
      if (gearDb.value[String(m.uid)] || materialDb.value[String(m.uid)]) return m
      const { name, nameEn } = getGearNameByUid(m.uid)
      return { ...m, name, nameEn }
    }),
  )

  const upgradeInfo = computed<Record<string, UpgradeResult>>(() =>
    Object.fromEntries(
      selectedCharacters.value.map((name) => [name, computeUpgrade(inputOf(name), staticData.value, stock.value)]),
    ),
  )

  const problem = computed(() => {
    const { shortfall } = activeNeeds.value
    const budget = solverBudget(activeNeeds.value, equipment101Count.value)
    return { shortfall, budget, key: problemKey(shortfall, budget) }
  })

  const dropsByStage = computed(() => {
    const byStage = new Map<string, { uid: number; dropRate: number }[]>()
    for (const [uid, drops] of stageIndex.value ?? []) {
      for (const d of drops) {
        const list = byStage.get(d.stage)
        if (list) list.push({ uid, dropRate: d.dropRate })
        else byStage.set(d.stage, [{ uid, dropRate: d.dropRate }])
      }
    }
    return byStage
  })

  const planRows = computed<StagePlanRow[]>(() => {
    const result = view.value.result
    if (!result) return []

    const haveByUid = new Map(activeNeeds.value.materials.map((m) => [m.uid, m.have]))
    const shortUids = new Set(activeNeeds.value.shortfall.map((e) => e.uid))

    const uidRank = new Map<number, number>()
    let maxSweepRank = 0
    for (const entry of Object.values(sweepData.value)) {
      uidRank.set(entry.uid, entry.rank)
      if (entry.rank > maxSweepRank) maxSweepRank = entry.rank
    }

    const rows: StagePlanRow[] = []
    for (const [stage, runs] of Object.entries(result.runsByStage)) {
      if (!(runs > 0)) continue
      const expectedDrops: StageDrop[] = (dropsByStage.value.get(stage) ?? [])
        .filter((d) => shortUids.has(d.uid))
        .map((d) => {
          const info = getGearNameByUid(d.uid)
          return { uid: d.uid, name: info.name, nameEn: info.nameEn, dropRate: d.dropRate }
        })
        .sort((a, b) => (haveByUid.get(b.uid) ?? 0) - (haveByUid.get(a.uid) ?? 0) || a.uid - b.uid)
      rows.push({ stage, runs, stamina: runs * STAMINA_PER_RUN, expectedDrops })
    }

    const meanRank = (row: StagePlanRow): number => {
      const ranks = [...new Set(row.expectedDrops.map((d) => uidRank.get(d.uid) ?? maxSweepRank))]
      if (ranks.length === 0) return 0
      return ranks.reduce((s, r) => s + r, 0) / ranks.length
    }
    rows.sort((a, b) => meanRank(a) - meanRank(b) || b.runs - a.runs)
    return rows
  })

  const totalStamina = computed(() => view.value.result?.stamina ?? 0)
  const equipment101Used = computed(() => view.value.result?.tokensUsed ?? 0)
  const planGap = computed(() => view.value.result?.gap ?? 0)

  const eq101ReplacedMats = computed<Eq101ReplacedMat[]>(() => {
    const byUid = new Map<number, number>()
    for (const [key, count] of Object.entries(view.value.result?.tokensByEntry ?? {})) {
      const uid = Number(key.split('@')[0])
      if (!Number.isInteger(uid) || !(count > 0)) continue
      byUid.set(uid, (byUid.get(uid) ?? 0) + count)
    }
    return [...byUid.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([uid, count]) => {
        const info = getGearNameByUid(uid)
        return { uid, name: info.name, nameEn: info.nameEn, count }
      })
  })

  const infeasibleMaterials = computed(() => activeNeeds.value.unfarmable)
  const solving = computed(() => view.value.solving)
  const planStale = computed(() => view.value.stale || debouncePending.value)

  const solverError = computed<string | null>(() => {
    const failure = view.value.error
    if (!failure) return null
    switch (failure.kind) {
      case 'timeout':
        return i18n.global.t('errors.solverTimeout')
      case 'wasm':
        return i18n.global.t('errors.solverWasmFail')
      case 'init':
        return i18n.global.t('errors.solverInitFail')
      default: {
        const status = typeof failure.status === 'string' && /^[A-Za-z ]{1,32}$/.test(failure.status)
          ? failure.status
          : '-'
        return i18n.global.t('errors.solverStatus', { status })
      }
    }
  })

  function ensureService(): SolverService | null {
    if (service) return service
    const index = stageIndex.value
    if (!index) return null
    workerSolve = createWorkerSolve()
    service = createSolverService({
      solve: workerSolve.solve,
      index,
      onChange: (v) => {
        view.value = v
      },
    })
    return service
  }

  function cancelDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
    debouncePending.value = false
  }

  function requestNow() {
    cancelDebounce()
    if (!active) return
    const svc = ensureService()
    if (!svc) return
    lastRequestedKey = problem.value.key
    svc.request(problem.value.shortfall, problem.value.budget)
  }

  watch(
    () => problem.value.key,
    (key) => {
      cancelDebounce()
      if (!active || !service || key === lastRequestedKey) return
      debouncePending.value = true
      debounceTimer = setTimeout(requestNow, DEBOUNCE_MS)
    },
  )

  /** The Armory view is on screen. Leaving keeps the solver service (cache, plan, failed keys) but stops its worker. */
  function setActive(value: boolean) {
    if (active === value) return
    active = value
    if (value) return
    cancelDebounce()
    service?.suspend()
    workerSolve?.dispose()
  }

  function resetSolver() {
    cancelDebounce()
    service?.dispose()
    service = null
    workerSolve?.dispose()
    workerSolve = null
    lastRequestedKey = null
  }

  function retrySolve() {
    if (!active) return
    service?.retry()
  }

  function setStaticData(d: StaticData) {
    resetSolver()
    gearDb.value = d.gearDb
    materialDb.value = d.materialDb
    charData.value = d.charData
    sweepData.value = d.sweepData
    stageIndex.value = buildStageIndex(d.sweepData)
    view.value = EMPTY_VIEW
    requestNow()
  }

  function persistSelection() {
    SelectedCharactersStorage.set(selectedCharacters.value)
  }

  function restoreSelection() {
    let names: string[]
    const stored = SelectedCharactersStorage.get()
    if (stored !== null) {
      names = sanitizeSelection(stored, isKnown)
    } else {
      const legacy = SelectedCharactersStorage.getLegacy()
      names = typeof legacy === 'string' && isKnown(legacy) ? [legacy] : []
      SelectedCharactersStorage.set(names)
      SelectedCharactersStorage.removeLegacy()
    }
    selectedCharacters.value = names
    beginVisit()
  }

  function beginVisit() {
    focusedCharacter.value = null
    openPanel.value = selectedCharacters.value[0] ?? null
  }

  /** Call once per visit: loads on first use, then opens the visit and (re)requests the current plan. */
  function loadData(): Promise<void> {
    if (isLoaded.value) {
      beginVisit()
      requestNow()
      return Promise.resolve()
    }
    if (!loadPromise) {
      loadPromise = fetchAndRestore().finally(() => {
        loadPromise = null
      })
    }
    return loadPromise
  }

  async function fetchAndRestore() {
    loading.value = true
    try {
      const base = import.meta.env.BASE_URL
      const [gearResp, materialResp, charResp, sweepResp] = await Promise.all([
        fetch(`${base}gear/data.json`),
        fetch(`${base}gear/material.json`),
        fetch(`${base}shared/characters.json`),
        fetch(`${base}sweep/data.json`),
      ])
      setStaticData({
        gearDb: await gearResp.json() as GearDb,
        materialDb: await materialResp.json() as MaterialDb,
        charData: await charResp.json() as CharactersData,
        sweepData: await sweepResp.json() as SweepData,
      })

      const ogStore = useOwnedGearStore()

      if (!Storage.get(STORAGE_KEYS.GEAR_MIGRATED_V2)) {
        ogStore.clearAll()
        Storage.set(STORAGE_KEYS.GEAR_MIGRATED_V2, true)
        Logger.info('[armory] migrated ownedGearStore for v2')
      }

      equipment101Count.value = toCount(Equipment101Storage.get())
      restoreSelection()
      isLoaded.value = true
    } catch (error) {
      Logger.error('裝備工坊數據載入失敗:', error)
      throw error
    } finally {
      loading.value = false
    }
    requestNow()
  }

  function addCharacter(name: string): boolean {
    if (typeof name !== 'string' || !isKnown(name)) return false
    if (selectedCharacters.value.includes(name)) return false
    if (selectedCharacters.value.length >= MAX_SELECTED) return false
    selectedCharacters.value = [...selectedCharacters.value, name]
    openPanel.value = name
    persistSelection()
    return true
  }

  function removeCharacter(name: string) {
    if (!selectedCharacters.value.includes(name)) return
    selectedCharacters.value = selectedCharacters.value.filter((n) => n !== name)
    if (openPanel.value === name) openPanel.value = null
    persistSelection()
    if (focusedCharacter.value === name) {
      focusedCharacter.value = null
      requestNow()
    }
  }

  function togglePanel(name: string) {
    openPanel.value = openPanel.value === name ? null : name
  }

  function toggleFocus(name: string) {
    if (!selectedCharacters.value.includes(name)) return
    focusedCharacter.value = focusedCharacter.value === name ? null : name
    requestNow()
  }

  function clearFocus() {
    if (focusedCharacter.value === null) return
    focusedCharacter.value = null
    requestNow()
  }

  function setTargetRank(name: string, rank: number) {
    if (!isKnown(name)) return
    const next = clampTarget(rank, currentRankOf(name), maxRankOf(name))
    targetRanks.value = { ...targetRanks.value, [name]: next }
    TargetRankStorage.set(targetRanks.value)
  }

  function setEquipment101Count(n: number) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return
    equipment101Count.value = Math.max(0, Math.floor(n))
    Equipment101Storage.set(equipment101Count.value)
  }

  function upgradeCharacter(name: string): boolean {
    if (!selectedCharacters.value.includes(name)) return false
    const now = Date.now()
    const last = lastUpgradeAt.get(name)
    if (last !== undefined && now - last < UPGRADE_GUARD_MS) return false

    const result = computeUpgrade(inputOf(name), staticData.value, stock.value)
    if (!result.ready) {
      Logger.debug('[armory] upgrade refused:', result.reason)
      return false
    }

    const rosterStore = useRosterStore()
    const ogStore = useOwnedGearStore()
    const miStore = useMaterialInventoryStore()
    const previousTarget = targetRankOf(name)

    for (const [uid, n] of Object.entries(result.consumeOwned)) ogStore.addCount(Number(uid), -n)
    for (const [uid, n] of Object.entries(result.consumeInventory)) miStore.addCount(Number(uid), -n)
    if (result.tokens > 0) {
      equipment101Count.value = Math.max(0, equipment101Count.value - result.tokens)
      Equipment101Storage.set(equipment101Count.value)
    }

    rosterStore.setUnitRank(name, result.nextRank)
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      rosterStore.setEquippedGear(name, slot, result.nextEquipment[slot] ?? null)
    }
    if (result.nextRank !== previousTarget) setTargetRank(name, result.nextRank)

    lastUpgradeAt.set(name, now)
    return true
  }

  return {
    gearDb,
    materialDb,
    charData,
    sweepData,
    isLoaded,
    loading,
    selectedCharacters,
    openPanel,
    focusedCharacter,
    equipment101Count,
    charList,
    maxRankOf,
    currentRankOf,
    minTargetOf,
    targetRankOf,
    activeNeeds,
    materialNeeds,
    ownedGearWindow,
    upgradeInfo,
    planRows,
    totalStamina,
    planGap,
    equipment101Used,
    eq101ReplacedMats,
    infeasibleMaterials,
    solving,
    planStale,
    solverError,
    loadData,
    setStaticData,
    addCharacter,
    removeCharacter,
    togglePanel,
    toggleFocus,
    clearFocus,
    setTargetRank,
    setEquipment101Count,
    upgradeCharacter,
    retrySolve,
    setActive,
    getGearNameByUid,
    getNameToUidMap,
  }
})
