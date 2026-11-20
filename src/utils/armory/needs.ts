import { tokenCost } from './constants'
import type {
  CharacterInput,
  MaterialRequirement,
  ShortfallEntry,
  StageIndex,
  StaticData,
  Stock,
  SweepData,
} from './types'

export type NotReadyReason = 'rank-above-target' | 'nothing-to-equip' | 'tokens'

export interface UpgradeResult {
  ready: boolean
  reason: NotReadyReason | null
  tokens: number
  consumeOwned: Record<number, number>
  consumeInventory: Record<number, number>
  nextRank: number
  nextEquipment: (string | null)[]
}

const SLOT_COUNT = 6

export interface NeedsResult {
  materials: MaterialRequirement[]
  shortfall: ShortfallEntry[]
  unfarmable: number[]
  /** Shortfall of unfarmable materials per (uid, rank); only Equipment 101 tokens could cover it. */
  unfarmableShortfall: ShortfallEntry[]
  gearWindow: { rank: number; slots: { uid: number; slotIdx: number }[] }[]
}

interface NeedsAnalysis {
  /** Uncovered ingredient counts: material uid -> rank -> count. */
  needByRank: Map<number, Map<number, number>>
  /** Owned copies used to fill slots, per gear uid. */
  covered: Map<number, number>
  /** Inventory plus leftover owned copies (gear-type uids only), per material uid. */
  have: Map<number, number>
  /** Remaining count after stock allocation: material uid -> rank -> count (> 0 only). */
  shortfallByRank: Map<number, Map<number, number>>
  gearWindow: NeedsResult['gearWindow']
}

export function buildStageIndex(sweep: SweepData): StageIndex {
  const index: StageIndex = new Map()
  for (const entry of Object.values(sweep)) {
    for (const st of entry.stages || []) {
      const list = index.get(entry.uid)
      const drop = { stage: st.code, dropRate: st.dropRate }
      if (list) list.push(drop)
      else index.set(entry.uid, [drop])
    }
  }
  return index
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function addTo(map: Map<number, Map<number, number>>, uid: number, rank: number, amount: number) {
  if (amount <= 0) return
  let ranks = map.get(uid)
  if (!ranks) {
    ranks = new Map()
    map.set(uid, ranks)
  }
  ranks.set(rank, (ranks.get(rank) ?? 0) + amount)
}

/**
 * Shared steps: gear demand -> owned-copy coverage -> per-(uid, rank) material
 * need -> stock allocation. Used for the combined view and for single characters.
 */
function analyzeNeeds(chars: CharacterInput[], data: StaticData, stock: Stock): NeedsAnalysis {
  const { gearDb, charData } = data

  const demandByRank = new Map<number, Map<number, number>>()
  const windowByRank = new Map<number, { uid: number; slotIdx: number }[]>()
  const windowSeen = new Set<number>()

  for (const c of chars) {
    const gear = charData[c.name]?.gear
    if (!gear) continue
    for (let rank = c.currentRank; rank <= c.targetRank; rank++) {
      const rankGear = gear[rank - 1]
      if (!rankGear) continue
      for (let slot = 0; slot < rankGear.length; slot++) {
        const uid = rankGear[slot]
        const entry = gearDb[String(uid)]
        if (!entry?.recipe || entry.recipe.length === 0) continue

        if (!windowSeen.has(uid)) {
          windowSeen.add(uid)
          const slots = windowByRank.get(rank)
          if (slots) slots.push({ uid, slotIdx: slot })
          else windowByRank.set(rank, [{ uid, slotIdx: slot }])
        }

        if (c.equipment[slot] === entry.name) continue
        addTo(demandByRank, uid, rank, 1)
      }
    }
  }

  const needByRank = new Map<number, Map<number, number>>()
  const covered = new Map<number, number>()
  for (const [uid, ranks] of demandByRank) {
    const recipe = gearDb[String(uid)].recipe ?? []
    let copies = count(stock.ownedGear[uid])
    let usedCopies = 0
    for (const rank of [...ranks.keys()].sort((a, b) => a - b)) {
      const slots = ranks.get(rank) ?? 0
      const use = Math.min(slots, copies)
      copies -= use
      usedCopies += use
      for (const mat of recipe) addTo(needByRank, mat.uid, rank, (slots - use) * mat.count)
    }
    covered.set(uid, usedCopies)
  }

  const have = new Map<number, number>()
  const shortfallByRank = new Map<number, Map<number, number>>()
  for (const [uid, ranks] of needByRank) {
    let remaining = count(stock.inventory[uid])
    if (gearDb[String(uid)]) {
      remaining += Math.max(0, count(stock.ownedGear[uid]) - (covered.get(uid) ?? 0))
    }
    have.set(uid, remaining)

    const ordered = [...ranks.keys()].sort((a, b) => tokenCost(b) - tokenCost(a) || b - a)
    for (const rank of ordered) {
      const needed = ranks.get(rank) ?? 0
      const use = Math.min(needed, remaining)
      remaining -= use
      if (needed - use > 0) addTo(shortfallByRank, uid, rank, needed - use)
    }
  }

  const gearWindow = [...windowByRank.keys()]
    .sort((a, b) => a - b)
    .map((rank) => ({ rank, slots: windowByRank.get(rank) ?? [] }))

  return { needByRank, covered, have, shortfallByRank, gearWindow }
}

function displayName(uid: number, data: StaticData): { name: string; nameEn: string } {
  const info = data.gearDb[String(uid)] ?? data.materialDb[String(uid)]
  return { name: info?.name ?? String(uid), nameEn: info?.nameEn ?? String(uid) }
}

/** Tokens the solver may spend: what is held minus the tokens the unfarmable shortfall will need. */
export function solverBudget(needs: Pick<NeedsResult, 'unfarmableShortfall'>, tokens: number): number {
  let reserved = 0
  for (const e of needs.unfarmableShortfall) reserved += tokenCost(e.rank) * e.count
  return Math.max(0, count(tokens) - reserved)
}

export function computeNeeds(
  chars: CharacterInput[],
  data: StaticData,
  stock: Stock,
  index?: StageIndex,
): NeedsResult {
  const analysis = analyzeNeeds(chars, data, stock)
  const farmableUids = new Set((index ?? buildStageIndex(data.sweepData)).keys())

  const materials: MaterialRequirement[] = []
  for (const [uid, ranks] of analysis.needByRank) {
    let need = 0
    let minRank = Infinity
    for (const [rank, amount] of ranks) {
      if (amount <= 0) continue
      need += amount
      minRank = Math.min(minRank, rank)
    }
    if (need <= 0) continue
    materials.push({
      uid,
      ...displayName(uid, data),
      have: analysis.have.get(uid) ?? 0,
      need,
      farmable: farmableUids.has(uid),
      minRank,
    })
  }
  materials.sort((a, b) => a.minRank - b.minRank || a.uid - b.uid)

  const shortfall: ShortfallEntry[] = []
  const unfarmable: number[] = []
  const unfarmableShortfall: ShortfallEntry[] = []
  for (const [uid, ranks] of analysis.shortfallByRank) {
    if (!farmableUids.has(uid)) {
      unfarmable.push(uid)
      for (const [rank, amount] of ranks) unfarmableShortfall.push({ uid, rank, count: amount })
      continue
    }
    for (const [rank, amount] of ranks) shortfall.push({ uid, rank, count: amount })
  }
  const byUidRank = (a: ShortfallEntry, b: ShortfallEntry) => a.uid - b.uid || a.rank - b.rank
  shortfall.sort(byUidRank)
  unfarmableShortfall.sort(byUidRank)
  unfarmable.sort((a, b) => a - b)

  return { materials, shortfall, unfarmable, unfarmableShortfall, gearWindow: analysis.gearWindow }
}

function sixSlots(equipment: (string | null)[]): (string | null)[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => equipment[i] ?? null)
}

/** True when every slot of the character's current rank already holds its gear. */
export function allSlotsEquipped(c: CharacterInput, data: StaticData): boolean {
  const gear = data.charData[c.name]?.gear
  if (!gear) return false
  const rankGear = gear[c.currentRank - 1] ?? []
  return rankGear.every((uid, slot) => {
    const entry = data.gearDb[String(uid)]
    return !entry || c.equipment[slot] === entry.name
  })
}

export function computeUpgrade(c: CharacterInput, data: StaticData, stock: Stock): UpgradeResult {
  const { gearDb, charData } = data
  const gear = charData[c.name]?.gear
  if (!gear) {
    return {
      ready: false,
      reason: 'nothing-to-equip',
      tokens: 0,
      consumeOwned: {},
      consumeInventory: {},
      nextRank: c.currentRank,
      nextEquipment: sixSlots(c.equipment),
    }
  }

  const analysis = analyzeNeeds([c], data, stock)

  let tokens = 0
  for (const ranks of analysis.shortfallByRank.values()) {
    for (const [rank, amount] of ranks) tokens += amount * tokenCost(rank)
  }

  const consumeOwned: Record<number, number> = {}
  const consumeInventory: Record<number, number> = {}
  for (const [uid, used] of analysis.covered) {
    if (used > 0) consumeOwned[uid] = used
  }
  for (const [uid, ranks] of analysis.needByRank) {
    let need = 0
    for (const amount of ranks.values()) need += amount
    let ownedUsed = 0
    if (gearDb[String(uid)]) {
      ownedUsed = Math.min(need, Math.max(0, count(stock.ownedGear[uid]) - (analysis.covered.get(uid) ?? 0)))
    }
    const invUsed = Math.min(need - ownedUsed, count(stock.inventory[uid]))
    if (ownedUsed > 0) consumeOwned[uid] = (consumeOwned[uid] ?? 0) + ownedUsed
    if (invUsed > 0) consumeInventory[uid] = invUsed
  }

  let reason: NotReadyReason | null = null
  if (c.currentRank > c.targetRank) reason = 'rank-above-target'
  else if (c.currentRank === c.targetRank && allSlotsEquipped(c, data)) reason = 'nothing-to-equip'
  else if (tokens > count(stock.tokens)) reason = 'tokens'

  const maxRank = gear.length
  const rollover = c.targetRank < maxRank
  const targetGear = gear[c.targetRank - 1] ?? []
  const nextEquipment = rollover
    ? sixSlots([])
    : sixSlots(targetGear.map((uid) => gearDb[String(uid)]?.name ?? null))

  return {
    ready: reason === null,
    reason,
    tokens,
    consumeOwned,
    consumeInventory,
    nextRank: rollover ? c.targetRank + 1 : c.targetRank,
    nextEquipment,
  }
}
