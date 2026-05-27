import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Logger } from '@/utils/logger'
import { useRosterStore } from './roster'
import { useMaterialInventoryStore } from './materialInventory'
import { useOwnedGearStore } from './ownedGear'
import { Equipment101Storage, SelectedCharacterStorage } from '@/utils/storage'

const STAMINA_PER_RUN = 10

const EQUIPMENT_101_COST: Record<number, number> = {
  1: 4, 2: 5, 3: 6, 4: 10, 5: 12, 6: 14, 7: 22, 8: 24,
}

export interface GearRequirement {
  uid: number
  name: string
  nameEn: string
  rank: number
  slot: number
  owned: boolean
  recipe: { uid: number; count: number }[]
}

export interface MaterialRequirement {
  uid: number
  name: string
  nameEn: string
  have: number
  need: number
  farmable: boolean
  minRank: number
}

export interface StageDrop {
  uid: number
  name: string
  nameEn: string
  dropRate: number
}

export interface StagePlanRow {
  stage: string
  runs: number
  stamina: number
  expectedDrops: StageDrop[]
}

export interface Eq101ReplacedMat {
  uid: number
  name: string
  nameEn: string
  count: number
}

export interface GearDb {
  [uidStr: string]: {
    uid: number
    name: string
    nameEn: string
    type: string
    recipe?: { uid: number; count: number }[]
  }
}

export interface MaterialDb {
  [uidStr: string]: {
    uid: number
    name: string
    nameEn: string
  }
}

interface SweepEntry {
  uid: number
  rank: number
  stages: { code: string; dropRate: number }[]
}

interface SweepData {
  [materialName: string]: SweepEntry
}

interface CharactersData {
  [name: string]: {
    name?: string
    gear?: number[][]
  }
}

export const useArmoryStore = defineStore('armory', () => {
  const gearDb = ref<GearDb>({})
  const materialDb = ref<MaterialDb>({})
  const charData = ref<CharactersData>({})
  const sweepData = ref<SweepData>({})
  const isLoaded = ref(false)
  const loading = ref(false)

  const selectedCharacter = ref<string | null>(null)
  const targetRank = ref(7)

  const maxRank = computed(() => {
    const name = selectedCharacter.value
    if (!name) return 8
    const char = charData.value[name]
    if (!char) return 8
    return char.gear?.length || 8
  })

  const requirements = ref<GearRequirement[]>([])
  const materialNeeds = ref<MaterialRequirement[]>([])
  const plan = ref<StagePlanRow[]>([])
  const totalStamina = ref(0)
  const optimizing = ref(false)
  const optimizationProgress = ref(0)
  const solverError = ref<string | null>(null)
  const infeasibleMaterials = ref<number[]>([])
  const equipment101Count = ref(0)
  const equipment101Used = ref(0)
  const eq101ReplacedMats = ref<Eq101ReplacedMat[]>([])
  const rankedNeeds = ref<Map<number, Map<number, number>>>(new Map())

  const canUpgrade = computed(() => {
    if (!selectedCharacter.value) return false
    const rosterStore = useRosterStore()
    const prog = rosterStore.getUnitProgress(selectedCharacter.value)
    if (prog.currentRank >= targetRank.value) return false

    // Check if materials are sufficient or coverable by 101
    const rn = rankedNeeds.value
    if (rn.size === 0) return materialNeeds.value.length === 0

    let total101Needed = 0
    const miStore = useMaterialInventoryStore()
    const ogStore = useOwnedGearStore()

    for (const [uid, rankMap] of rn) {
      let have = miStore.getCount(uid)
      if (gearDb.value[String(uid)] && ogStore.isOwned(uid)) {
        have += 1
      }

      // Allocate inventory from highest-cost rank to lowest
      const sortedRanks = [...rankMap.entries()].sort(
        (a, b) => (EQUIPMENT_101_COST[b[0]] || 99) - (EQUIPMENT_101_COST[a[0]] || 99),
      )
      for (const [rank, need] of sortedRanks) {
        const take = Math.min(need, have)
        have -= take
        const remaining = need - take
        if (remaining > 0) {
          total101Needed += remaining * (EQUIPMENT_101_COST[rank] || 99)
        }
      }
    }

    return total101Needed <= equipment101Count.value
  })

  const charNames = computed(() => Object.keys(charData.value).filter(k => {
    const c = charData.value[k]
    return c && typeof c === 'object' && Array.isArray(c.gear)
  }))

  const charList = computed(() => {
    return charNames.value
      .map(name => ({
        name,
        en: (charData.value[name] as any)?.en || name,
      }))
      .sort((a, b) => a.en.localeCompare(b.en))
  })

  async function loadData() {
    if (isLoaded.value) return
    loading.value = true
    try {
      const base = import.meta.env.BASE_URL
      const [gearResp, materialResp, charResp, sweepResp] = await Promise.all([
        fetch(`${base}gear/data.json`),
        fetch(`${base}gear/material.json`),
        fetch(`${base}shared/characters.json`),
        fetch(`${base}sweep/data.json`),
      ])
      gearDb.value = await gearResp.json() as GearDb
      materialDb.value = await materialResp.json() as MaterialDb
      charData.value = await charResp.json() as CharactersData
      sweepData.value = await sweepResp.json() as SweepData

      const rosterStore = useRosterStore()
      rosterStore.loadData()
      const miStore = useMaterialInventoryStore()
      miStore.loadData()
      const ogStore = useOwnedGearStore()
      ogStore.loadData()

      isLoaded.value = true
    } catch (error) {
      Logger.error('裝備工坊數據載入失敗:', error)
      throw error
    } finally {
      loading.value = false
    }
    equipment101Count.value = Equipment101Storage.get()
    const savedChar = SelectedCharacterStorage.get()
    if (savedChar && charData.value[savedChar]) {
      selectedCharacter.value = savedChar
    }
  }

  function setEquipment101Count(count: number) {
    equipment101Count.value = Math.max(0, count)
    Equipment101Storage.set(equipment101Count.value)
    scheduleOptimization()
  }

  function getGearNameByUid(uid: number): { name: string; nameEn: string; type: string } {
    const entry = gearDb.value[String(uid)]
    if (entry) return { name: entry.name, nameEn: entry.nameEn, type: entry.type }
    const matEntry = materialDb.value[String(uid)]
    if (matEntry) return { name: matEntry.name, nameEn: matEntry.nameEn, type: 'material' }
    return { name: `Unknown (${uid})`, nameEn: `Unknown (${uid})`, type: 'unknown' }
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

  function selectCharacter(name: string) {
    selectedCharacter.value = name
    SelectedCharacterStorage.set(name)
    targetRank.value = maxRank.value
    computeRequirements()
  }

  function setTargetRank(rank: number) {
    targetRank.value = Math.max(1, Math.min(maxRank.value, rank))
    computeRequirements()
  }

  function computeRequirements() {
    const charName = selectedCharacter.value
    if (!charName || !charData.value[charName]) {
      requirements.value = []
      materialNeeds.value = []
      plan.value = []
      totalStamina.value = 0
      return
    }

    const rosterStore = useRosterStore()
    const ogStore = useOwnedGearStore()
    const miStore = useMaterialInventoryStore()
    const char = charData.value[charName]
    const gear = char.gear
    if (!gear) {
      requirements.value = []
      materialNeeds.value = []
      return
    }

    const progress = rosterStore.getUnitProgress(charName)
    const currentRank = progress.currentRank
    const target = targetRank.value

    if (target < currentRank) {
      requirements.value = []
      materialNeeds.value = []
      plan.value = []
      totalStamina.value = 0
      return
    }

    const reqs: GearRequirement[] = []
    const aggregatedMaterials = new Map<number, number>()
    const rn = new Map<number, Map<number, number>>()

    for (let r = currentRank; r <= target; r++) {
      const rankGear = gear[r - 1]
      if (!rankGear) continue
      for (let s = 0; s < rankGear.length; s++) {
        const uid = rankGear[s]
        const info = getGearNameByUid(uid)
        const alreadyOwned = ogStore.isOwned(uid)
        const gearEntry = gearDb.value[String(uid)]
        const recipe = gearEntry?.recipe || []

        if (!alreadyOwned) {
          for (const mat of recipe) {
            aggregatedMaterials.set(mat.uid, (aggregatedMaterials.get(mat.uid) || 0) + mat.count)
            if (!rn.has(mat.uid)) rn.set(mat.uid, new Map())
            const rankMap = rn.get(mat.uid)!
            rankMap.set(r, (rankMap.get(r) || 0) + mat.count)
          }
        }

        reqs.push({
          uid,
          name: info.name,
          nameEn: info.nameEn,
          rank: r,
          slot: s,
          owned: alreadyOwned,
          recipe,
        })
      }
    }

    rankedNeeds.value = rn

    const mats: MaterialRequirement[] = []
    const sweepUidSet = new Set<number>()
    for (const entry of Object.values(sweepData.value)) {
      sweepUidSet.add(entry.uid)
    }

    for (const [uid, need] of aggregatedMaterials) {
      const info = getGearNameByUid(uid)
      let have = miStore.getCount(uid)
      if (gearDb.value[String(uid)] && ogStore.isOwned(uid)) {
        have += 1
      }
      const rankMap = rn.get(uid)
      const minRank = rankMap ? Math.min(...rankMap.keys()) : 99
      mats.push({
        uid,
        name: info.name,
        nameEn: info.nameEn,
        have,
        need,
        farmable: sweepUidSet.has(uid),
        minRank,
      })
    }

    mats.sort((a, b) => a.minRank - b.minRank || a.uid - b.uid)

    requirements.value = reqs
    materialNeeds.value = mats
    plan.value = []
    totalStamina.value = 0
    solverError.value = null
    infeasibleMaterials.value = []

    scheduleOptimization()
  }

  function buildStageDropsIndex(): Map<number, { stage: string; dropRate: number }[]> {
    const index = new Map<number, { stage: string; dropRate: number }[]>()
    for (const entry of Object.values(sweepData.value)) {
      const uid = entry.uid
      const stages = entry.stages || []
      for (const st of stages) {
        if (!index.has(uid)) index.set(uid, [])
        index.get(uid)!.push({ stage: st.code, dropRate: st.dropRate })
      }
    }
    return index
  }

  let _solverWorker: Worker | null = null
  let _optimizeTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleOptimization() {
    if (_optimizeTimer) clearTimeout(_optimizeTimer)
    _optimizeTimer = setTimeout(() => {
      _optimizeTimer = null
      runOptimization()
    }, 500)
  }

  function upgradeCharacter() {
    const name = selectedCharacter.value
    if (!name) return
    const rosterStore = useRosterStore()
    const ogStore = useOwnedGearStore()
    const miStore = useMaterialInventoryStore()
    const char = charData.value[name]
    if (!char) return
    const progress = rosterStore.getUnitProgress(name)
    const fromRank = progress.currentRank
    const toRank = targetRank.value
    if (fromRank >= toRank) return

    // Execute upgrade: iterate rank upward, equip gear, deduct resources
    let total101Cost = 0
    for (let r = fromRank; r <= toRank; r++) {
      const rankGear = char.gear?.[r - 1]
      if (!rankGear) continue
      for (let s = 0; s < rankGear.length; s++) {
        const uid = rankGear[s] as number
        if (ogStore.isOwned(uid)) continue

        const gearEntry = gearDb.value[String(uid)]
        if (gearEntry?.recipe) {
          for (const mat of gearEntry.recipe) {
            let remaining = mat.count
            // Deduct owned sub-material gear first
            if (gearDb.value[String(mat.uid)] && ogStore.isOwned(mat.uid)) {
              ogStore.setOwned(mat.uid, false)
              remaining -= 1
            }
            // Deduct from inventory
            const inv = miStore.getCount(mat.uid)
            const fromInv = Math.min(remaining, inv)
            if (fromInv > 0) {
              miStore.addCount(mat.uid, -fromInv)
              remaining -= fromInv
            }
            // remaining > 0 covered by 101 tokens
            if (remaining > 0) {
              total101Cost += remaining * (EQUIPMENT_101_COST[r] || 99)
            }
          }
        }

        ogStore.setOwned(uid, true)
        const info = getGearNameByUid(uid)
        rosterStore.setEquippedGear(name, s, info.name)
      }
    }

    if (total101Cost > 0) {
      equipment101Count.value = Math.max(0, equipment101Count.value - total101Cost)
      Equipment101Storage.set(equipment101Count.value)
    }

    rosterStore.setUnitRank(name, toRank)
    computeRequirements()
  }

  function getSolverWorker(): Worker {
    if (!_solverWorker) {
      _solverWorker = new Worker(
        new URL('../workers/optimizer.worker', import.meta.url),
        { type: 'module' },
      )
    }
    return _solverWorker
  }

  function disposeSolver() {
    if (_solverWorker) {
      _solverWorker.terminate()
      _solverWorker = null
    }
  }

  function runOptimization() {
    if (optimizing.value) return
    if (requirements.value.length === 0 || materialNeeds.value.length === 0) return

    const unfarmable: number[] = []
    const stageDropsIndex = buildStageDropsIndex()
    const varsMap = new Map<string, { code: string; drops: { uid: number; rate: number }[] }>()
    const constraintsMap = new Map<string, number>()

    for (const mat of materialNeeds.value) {
      const remaining = Math.max(0, mat.need - mat.have)
      if (remaining <= 0) continue

      if (!stageDropsIndex.has(mat.uid)) {
        unfarmable.push(mat.uid)
        continue
      }

      constraintsMap.set(`m${mat.uid}`, remaining)

      const stages = stageDropsIndex.get(mat.uid)!
      for (const st of stages) {
        if (!varsMap.has(st.stage)) {
          varsMap.set(st.stage, { code: st.stage, drops: [] })
        }
        varsMap.get(st.stage)!.drops.push({ uid: mat.uid, rate: st.dropRate })
      }
    }

    infeasibleMaterials.value = unfarmable

    if (constraintsMap.size === 0) {
      plan.value = []
      totalStamina.value = 0
      return
    }

    // Preprocess Equipment 101: greedy even-distribution across remaining material needs
    eq101ReplacedMats.value = []
    const replacedMap = new Map<number, number>()
    let total101Used = 0
    if (equipment101Count.value > 0) {
      let remBudget = equipment101Count.value
      const miStore = useMaterialInventoryStore()
      const ogStore2 = useOwnedGearStore()

      // Build per-(uid,rank) remaining entries (same inventory logic as before)
      type E101Entry = { uid: number; rank: number; remaining: number }
      const entries: E101Entry[] = []
      const rn = rankedNeeds.value
      for (const [uid, rankMap] of rn) {
        const matKey = `m${uid}`
        if (!constraintsMap.has(matKey)) continue
        let have = miStore.getCount(uid)
        if (gearDb.value[String(uid)] && ogStore2.isOwned(uid)) have += 1
        const sortedRanks = [...rankMap.entries()].sort(
          (a, b) => (EQUIPMENT_101_COST[b[0]] || 99) - (EQUIPMENT_101_COST[a[0]] || 99),
        )
        for (const [rank, need] of sortedRanks) {
          const take = Math.min(need, have)
          have -= take
          const rem = need - take
          if (rem > 0) entries.push({ uid, rank, remaining: rem })
        }
      }

      // Sort by rank ASC (cheapest 101 cost first)
      entries.sort((a, b) => (EQUIPMENT_101_COST[a.rank] || 99) - (EQUIPMENT_101_COST[b.rank] || 99))

      // Group by rank for per-rank reduce-peak
      const rankGroups = new Map<number, E101Entry[]>()
      for (const e of entries) {
        if (!rankGroups.has(e.rank)) rankGroups.set(e.rank, [])
        rankGroups.get(e.rank)!.push(e)
      }

      for (const [rank, group] of rankGroups) {
        const unitCost = EQUIPMENT_101_COST[rank] || 99
        if (remBudget < unitCost) break
        const totalRem = group.reduce((s, e) => s + e.remaining, 0)
        const affordable = Math.min(totalRem, Math.floor(remBudget / unitCost))
        if (affordable <= 0) continue

        // Reduce-peak: iteratively cut the highest remaining, spread evenly
        let toAlloc = affordable
        const final = group.map(e => e.remaining)
        while (toAlloc > 0) {
          let maxIdx = 0
          for (let i = 1; i < final.length; i++) {
            if (final[i] > final[maxIdx]) maxIdx = i
          }
          final[maxIdx]--
          toAlloc--
        }

        // Write back to constraintsMap
        for (let i = 0; i < group.length; i++) {
          const allocated = group[i].remaining - final[i]
          if (allocated <= 0) continue
          replacedMap.set(group[i].uid, (replacedMap.get(group[i].uid) || 0) + allocated)
          const matKey = `m${group[i].uid}`
          const cur = constraintsMap.get(matKey) || 0
          const next = cur - allocated
          if (next <= 0) {
            constraintsMap.delete(matKey)
          } else {
            constraintsMap.set(matKey, next)
          }
        }

        const used = affordable * unitCost
        remBudget -= used
        total101Used += used
      }

      equipment101Used.value = total101Used
    }

    eq101ReplacedMats.value = [...replacedMap.entries()]
      .map(([uid, count]) => {
        const info = getGearNameByUid(uid)
        return { uid, name: info.name, nameEn: info.nameEn, count }
      })
      .sort((a, b) => a.uid - b.uid)

    // Build CPLEX LP format string for HiGHS solver
    const stageCodeByVarKey = new Map<string, string>()
    const varKeys: string[] = []

    // Collect variable definitions: varKey -> { drops relevant to constraints }
    const varDrops = new Map<string, { matKey: string; rate: number }[]>()

    for (const [stageCode, v] of varsMap) {
      const varKey = `s_${stageCode.replace('-', '_')}`
      stageCodeByVarKey.set(varKey, stageCode)
      varKeys.push(varKey)
      const drops: { matKey: string; rate: number }[] = []
      for (const drop of v.drops) {
        const matKey = `m${drop.uid}`
        if (constraintsMap.has(matKey)) {
          drops.push({ matKey, rate: drop.rate })
        }
      }
      varDrops.set(varKey, drops)
    }

    // Build LP string
    const lpParts: string[] = ['Minimize', '  obj:']

    // Objective: minimize total stamina cost
    const objTerms = varKeys.map((vk, i) =>
      i === 0 ? `${STAMINA_PER_RUN} ${vk}` : `+ ${STAMINA_PER_RUN} ${vk}`,
    )
    lpParts.push(`    ${objTerms.join(' ')}`)

    // Constraints: each material need must be met
    lpParts.push('Subject To')
    for (const [matKey, need] of constraintsMap) {
      const terms: string[] = []
      for (const vk of varKeys) {
        const drops = varDrops.get(vk)!
        const drop = drops.find((d) => d.matKey === matKey)
        if (drop) {
          if (terms.length === 0) {
            terms.push(`${drop.rate} ${vk}`)
          } else {
            terms.push(`+ ${drop.rate} ${vk}`)
          }
        }
      }
      if (terms.length > 0) {
        lpParts.push(`  ${matKey}: ${terms.join(' ')} >= ${Math.ceil(need)}`)
      }
    }

    // Bounds: all variables >= 0
    lpParts.push('Bounds')
    for (const vk of varKeys) {
      lpParts.push(`  ${vk} >= 0`)
    }

    // Integer variables
    lpParts.push('General')
    lpParts.push(`  ${varKeys.join(' ')}`)
    lpParts.push('End')

    const lp = lpParts.join('\n')
    if (import.meta.env.DEV) {
      console.log(`[armory] LP model: ${varKeys.length} vars, ${constraintsMap.size} constraints, ${lp.length} chars`)
    }
    solveModel(lp, stageCodeByVarKey, varsMap)
  }

  function solveModel(
    lp: string,
    stageCodeByVarKey: Map<string, string>,
    varsMap: Map<string, { code: string; drops: { uid: number; rate: number }[] }>,
  ) {
    solverError.value = null
    optimizing.value = true
    optimizationProgress.value = 0

    console.log(`[armory] solving ILP: ${stageCodeByVarKey.size} vars, HiGHS WASM`)
    if (import.meta.env.DEV) {
      console.log('[armory] LP preview:\n', lp.slice(0, 500) + (lp.length > 500 ? '\n...' : ''))
    }

    const worker = getSolverWorker()
    const progressInterval = setInterval(() => {
      if (optimizationProgress.value < 90) {
        optimizationProgress.value += 5
      }
    }, 200)

    const workerTimeout = setTimeout(() => {
      cleanup()
      console.error('Solver worker timed out after 60s')
      solverError.value = 'Solver timed out. Try a simpler loadout.'
      plan.value = []
      totalStamina.value = 0
      optimizing.value = false
      optimizationProgress.value = 0
    }, 60000)

    function cleanup() {
      clearInterval(progressInterval)
      clearTimeout(workerTimeout)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    const onMessage = (e: MessageEvent) => {
      cleanup()
      const { result, error } = e.data
      if (error) {
        console.error('Solver worker error:', error)
        solverError.value = 'Solver failed. Your device may not support WASM.'
        plan.value = []
        totalStamina.value = 0
        optimizing.value = false
        optimizationProgress.value = 0
        return
      }

      // HiGHS solution format
      const solution = result as {
        Status: string
        ObjectiveValue: number
        Columns: Record<string, { Primal: number; Name: string }>
      }

      if (solution.Status !== 'Optimal') {
        console.warn('[armory] HiGHS status:', solution.Status)
        solverError.value = `Solver returned ${solution.Status}. Try different inputs.`
        if (import.meta.env.DEV) {
          console.warn('[armory] non-optimal solution:', solution)
        }
        plan.value = []
        totalStamina.value = 0
        optimizing.value = false
        optimizationProgress.value = 0
        return
      }

      // Build plan from column primal values
      const planRows: StagePlanRow[] = []
      let total = 0

      for (const [varKey, col] of Object.entries(solution.Columns)) {
        const runCount = Math.round(col.Primal)
        if (runCount <= 0) continue
        if (!stageCodeByVarKey.has(varKey)) continue

        const stageCode = stageCodeByVarKey.get(varKey)!
        const expectedDrops: StageDrop[] = []
        for (const drop of (varsMap.get(stageCode)?.drops || [])) {
          const info = getGearNameByUid(drop.uid)
          expectedDrops.push({
            uid: drop.uid,
            name: info.name,
            nameEn: info.nameEn,
            dropRate: drop.rate,
          })
        }
        expectedDrops.sort((a, b) => a.uid - b.uid)
        const st = runCount * STAMINA_PER_RUN
        total += st
        planRows.push({
          stage: stageCode,
          runs: runCount,
          stamina: st,
          expectedDrops,
        })
      }

      const uidRankMap = new Map<number, number>()
      let maxRank = 0
      for (const entry of Object.values(sweepData.value)) {
        uidRankMap.set(entry.uid, entry.rank)
        if (entry.rank > maxRank) maxRank = entry.rank
      }
      const stageAvgRank = (row: StagePlanRow): number => {
        const ranks = [...new Set(row.expectedDrops.map(d => uidRankMap.get(d.uid) ?? maxRank))]
        if (ranks.length === 0) return 0
        return ranks.length === 1 ? ranks[0] : ranks.reduce((s, r) => s + r, 0) / ranks.length
      }
      planRows.sort((a, b) => {
        const diff = stageAvgRank(a) - stageAvgRank(b)
        if (diff !== 0) return diff
        return b.runs - a.runs
      })

      plan.value = planRows
      totalStamina.value = total
      if (import.meta.env.DEV) {
        console.log(`[armory] solution: ${planRows.length} stages, ${total} total stamina`)
      }
      optimizing.value = false
      optimizationProgress.value = 100
    }

    const onError = (e: ErrorEvent) => {
      cleanup()
      console.error('Solver worker error:', e.message)
      solverError.value = 'Solver failed to initialize. Try a different browser.'
      plan.value = []
      totalStamina.value = 0
      optimizing.value = false
      optimizationProgress.value = 0
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ lp })
  }

  function toggleGearOwned(uid: number) {
    const ogStore = useOwnedGearStore()
    ogStore.toggleOwned(uid)
    computeRequirements()
  }

  function setMaterialCount(uid: number, count: number) {
    const miStore = useMaterialInventoryStore()
    miStore.setCount(uid, count)
    computeRequirements()
  }

  return {
    gearDb,
    materialDb,
    charData,
    sweepData,
    isLoaded,
    loading,
    selectedCharacter,
    targetRank,
    maxRank,
    materialNeeds,
    plan,
    totalStamina,
    optimizing,
    optimizationProgress,
    solverError,
    infeasibleMaterials,
    canUpgrade,
    equipment101Count,
    equipment101Used,
    eq101ReplacedMats,
    rankedNeeds,
    charNames,
    charList,
    loadData,
    selectCharacter,
    setTargetRank,
    computeRequirements,
    disposeSolver,
    runOptimization,
    upgradeCharacter,
    setEquipment101Count,
    toggleGearOwned,
    setMaterialCount,
    getGearNameByUid,
    getNameToUidMap,
  }
})
