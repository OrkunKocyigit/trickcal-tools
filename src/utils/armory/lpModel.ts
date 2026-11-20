import { STAMINA_PER_RUN, tokenCost } from './constants'
import { STATUS_TIME_LIMIT } from './highsSolve'
import type { ShortfallEntry, StageIndex } from './types'

export interface SolveResult {
  runsByStage: Record<string, number>
  tokensByEntry: Record<string, number>
  stamina: number
  tokensUsed: number
  /** Stamina above the proven lower bound; 0 when the plan is optimal. */
  gap: number
}

export interface BuiltModel {
  lp: string
  stageByVar: Map<string, string>
  tokenByVar: Map<string, { uid: number; rank: number }>
}

export interface HighsLikeSolution {
  Status: string
  Columns: Record<string, { Primal: number }>
  /** Proven lower bound on the objective; set when the solve stopped at its time limit. */
  DualBound?: number
}

const EPS = 1e-9
// HiGHS dual bounds carry ~1e-7 noise; treat a bound this close above a whole run as that run so a real gap is never hidden.
const BOUND_TOLERANCE_RUNS = 1e-6

function normaliseBudget(budget: number): number {
  return Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0
}

function normaliseShortfall(shortfall: ShortfallEntry[]): ShortfallEntry[] {
  const merged = new Map<string, ShortfallEntry>()
  for (const e of shortfall) {
    if (!(e.count > 0)) continue
    const key = `${e.uid}@${e.rank}`
    const existing = merged.get(key)
    if (existing) existing.count += e.count
    else merged.set(key, { uid: e.uid, rank: e.rank, count: e.count })
  }
  return [...merged.values()].sort((a, b) => a.uid - b.uid || a.rank - b.rank)
}

function clampBudget(entries: ShortfallEntry[], budget: number): number {
  let useful = 0
  for (const e of entries) useful += tokenCost(e.rank) * e.count
  return Math.min(normaliseBudget(budget), useful)
}

/** Budget actually usable for this shortfall: spending beyond buying every missing unit changes nothing. */
export function effectiveBudget(shortfall: ShortfallEntry[], budget: number): number {
  return clampBudget(normaliseShortfall(shortfall), budget)
}

export function problemKey(shortfall: ShortfallEntry[], budget: number): string {
  const entries = normaliseShortfall(shortfall)
  if (entries.length === 0) return ''
  return `${entries.map((e) => `${e.uid}@${e.rank}:${e.count}`).join(',')}#b=${clampBudget(entries, budget)}`
}

function joinTerms(terms: string[]): string {
  return terms.join(' + ')
}

export function buildLp(shortfall: ShortfallEntry[], budget: number, index: StageIndex): BuiltModel {
  const entries = normaliseShortfall(shortfall)
  const cap = clampBudget(entries, budget)

  const stageByVar = new Map<string, string>()
  const tokenByVar = new Map<string, { uid: number; rank: number }>()
  const tokenCount = new Map<string, number>()
  const totalByUid = new Map<number, number>()

  for (const e of entries) {
    totalByUid.set(e.uid, (totalByUid.get(e.uid) ?? 0) + e.count)
    for (const s of index.get(e.uid) ?? []) {
      const varName = `s_${s.stage.replace('-', '_')}`
      if (!stageByVar.has(varName)) stageByVar.set(varName, s.stage)
    }
    if (tokenCost(e.rank) <= cap) {
      const varName = `t_${e.uid}_${e.rank}`
      tokenByVar.set(varName, { uid: e.uid, rank: e.rank })
      tokenCount.set(varName, e.count)
    }
  }

  // Stamina only: integer objective lets HiGHS prune by whole runs; a fractional token tie-break made solves take tens of seconds.
  const objective = [...stageByVar.keys()].map((v) => `${STAMINA_PER_RUN} ${v}`)

  const rows: string[] = []
  for (const [uid, total] of totalByUid) {
    const terms: string[] = []
    for (const s of index.get(uid) ?? []) {
      terms.push(`${s.dropRate} s_${s.stage.replace('-', '_')}`)
    }
    for (const [v, t] of tokenByVar) {
      if (t.uid === uid) terms.push(`1 ${v}`)
    }
    if (terms.length > 0) rows.push(`  m${uid}: ${joinTerms(terms)} >= ${total}`)
  }
  if (tokenByVar.size > 0) {
    const terms = [...tokenByVar].map(([v, t]) => `${tokenCost(t.rank)} ${v}`)
    rows.push(`  budget: ${joinTerms(terms)} <= ${cap}`)
  }

  const bounds = [
    ...[...stageByVar.keys()].map((v) => `  ${v} >= 0`),
    ...[...tokenCount].map(([v, count]) => `  0 <= ${v} <= ${count}`),
  ]
  const allVars = [...stageByVar.keys(), ...tokenByVar.keys()]

  const lp = [
    'Minimize',
    `  obj: ${joinTerms(objective)}`,
    'Subject To',
    ...rows,
    'Bounds',
    ...bounds,
    'General',
    `  ${allVars.join(' ')}`,
    'End',
  ].join('\n')

  return { lp, stageByVar, tokenByVar }
}

export function parseSolution(sol: HighsLikeSolution, model: BuiltModel): SolveResult {
  const runsByStage: Record<string, number> = {}
  const tokensByEntry: Record<string, number> = {}
  let totalRuns = 0
  let tokensUsed = 0

  for (const [name, col] of Object.entries(sol.Columns)) {
    const value = Math.round(col.Primal)
    if (!(value > 0)) continue
    const stage = model.stageByVar.get(name)
    if (stage !== undefined) {
      runsByStage[stage] = value
      totalRuns += value
      continue
    }
    const token = model.tokenByVar.get(name)
    if (token) {
      tokensByEntry[`${token.uid}@${token.rank}`] = value
      tokensUsed += tokenCost(token.rank) * value
    }
  }

  const stamina = STAMINA_PER_RUN * totalRuns
  return { runsByStage, tokensByEntry, stamina, tokensUsed, gap: planGap(sol, stamina) }
}

/** Whole runs make every plan a multiple of STAMINA_PER_RUN, so the dual bound rounds up to the next run. */
function planGap(sol: HighsLikeSolution, stamina: number): number {
  if (sol.Status !== STATUS_TIME_LIMIT || typeof sol.DualBound !== 'number' || !Number.isFinite(sol.DualBound)) return 0
  const lowerBound = Math.ceil(sol.DualBound / STAMINA_PER_RUN - BOUND_TOLERANCE_RUNS) * STAMINA_PER_RUN
  return Math.max(0, stamina - lowerBound)
}

export function isStillOptimal(
  prev: { shortfall: ShortfallEntry[]; budget: number; result: SolveResult },
  next: { shortfall: ShortfallEntry[]; budget: number },
  index: StageIndex,
): boolean {
  const prevEntries = normaliseShortfall(prev.shortfall)
  const nextEntries = normaliseShortfall(next.shortfall)

  const prevBudget = clampBudget(prevEntries, prev.budget)
  const nextBudget = clampBudget(nextEntries, next.budget)
  if (nextBudget > prevBudget) return false
  if (prev.result.tokensUsed > nextBudget) return false

  const nextCount = new Map(nextEntries.map((e) => [`${e.uid}@${e.rank}`, e.count]))
  for (const e of prevEntries) {
    if ((nextCount.get(`${e.uid}@${e.rank}`) ?? 0) < e.count) return false
  }

  const supplied = new Map<number, number>()
  for (const [stage, runs] of Object.entries(prev.result.runsByStage)) {
    for (const [uid, drops] of index) {
      const drop = drops.find((d) => d.stage === stage)
      if (drop) supplied.set(uid, (supplied.get(uid) ?? 0) + drop.dropRate * runs)
    }
  }
  for (const [key, count] of Object.entries(prev.result.tokensByEntry)) {
    const uid = Number(key.split('@')[0])
    supplied.set(uid, (supplied.get(uid) ?? 0) + count)
  }

  const needByUid = new Map<number, number>()
  for (const e of nextEntries) needByUid.set(e.uid, (needByUid.get(e.uid) ?? 0) + e.count)
  for (const [uid, need] of needByUid) {
    if ((supplied.get(uid) ?? 0) < need - EPS) return false
  }
  return true
}
