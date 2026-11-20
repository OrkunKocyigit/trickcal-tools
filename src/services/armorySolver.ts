import { STATUS_OPTIMAL, STATUS_TIME_LIMIT } from '@/utils/armory/highsSolve'
import { buildLp, isStillOptimal, parseSolution, problemKey } from '@/utils/armory/lpModel'
import type { HighsLikeSolution, SolveResult } from '@/utils/armory/lpModel'
import type { ShortfallEntry, StageIndex } from '@/utils/armory/types'

export type SolveFn = (lp: string) => Promise<HighsLikeSolution>

export type SolverFailureKind = 'timeout' | 'wasm' | 'init' | 'status'

export class SolverFailure extends Error {
  kind: SolverFailureKind
  status?: string

  constructor(kind: SolverFailureKind, status?: string) {
    super(`Solver failure: ${kind}`)
    this.name = 'SolverFailure'
    this.kind = kind
    this.status = status
  }
}

/** Rejection of an outstanding solve whose worker was torn down on purpose; not a failure of the problem. */
export class SolverCancelled extends Error {
  constructor() {
    super('Solver cancelled')
    this.name = 'SolverCancelled'
  }
}

export interface SolverView {
  key: string
  result: SolveResult | null
  solving: boolean
  stale: boolean
  error: SolverFailure | null
}

export interface SolverService {
  request(shortfall: ShortfallEntry[], budget: number): void
  retry(): void
  /** Abandon the in-flight solve and queued request but keep cache, displayed plan and failed keys. */
  suspend(): void
  /** Terminal: drop everything. */
  dispose(): void
  readonly solveCount: number
}

interface Problem {
  key: string
  shortfall: ShortfallEntry[]
  budget: number
}

interface Displayed extends Problem {
  result: SolveResult
}

/** Optimal, or stopped at the time limit with a plan and a proven bound to measure it against. */
function isUsable(solution: HighsLikeSolution): boolean {
  if (solution.Status === STATUS_OPTIMAL) return true
  return solution.Status === STATUS_TIME_LIMIT && typeof solution.DualBound === 'number' && Number.isFinite(solution.DualBound)
}

const DEFAULT_CACHE_SIZE = 50
const DEFAULT_TIMEOUT_MS = 60000

export function createSolverService(opts: {
  solve: SolveFn
  index: StageIndex
  onChange: (v: SolverView) => void
  cacheSize?: number
}): SolverService {
  const { solve, index, onChange } = opts
  const cacheSize = Math.max(1, opts.cacheSize ?? DEFAULT_CACHE_SIZE)

  const cache = new Map<string, SolveResult>()
  const failed = new Map<string, SolverFailure>()
  let current: Problem = { key: '', shortfall: [], budget: 0 }
  let displayed: Displayed | null = null
  let inFlight: string | null = null
  let pending: Problem | null = null
  let disposed = false
  let generation = 0
  let solveCount = 0

  function emit() {
    if (disposed) return
    onChange({
      key: current.key,
      result: displayed?.result ?? null,
      solving: inFlight === current.key || pending?.key === current.key,
      stale: displayed?.key !== current.key,
      error: failed.get(current.key) ?? null,
    })
  }

  function cacheGet(key: string): SolveResult | undefined {
    const hit = cache.get(key)
    if (hit !== undefined) {
      cache.delete(key)
      cache.set(key, hit)
    }
    return hit
  }

  function cacheSet(key: string, result: SolveResult) {
    cache.delete(key)
    cache.set(key, result)
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value as string
      cache.delete(oldest)
    }
  }

  async function startSolve(problem: Problem) {
    const started = generation
    inFlight = problem.key
    solveCount++
    const model = buildLp(problem.shortfall, problem.budget, index)
    emit()

    let result: SolveResult | null = null
    let failure: SolverFailure | null = null
    try {
      const solution = await solve(model.lp)
      if (isUsable(solution)) result = parseSolution(solution, model)
      else failure = new SolverFailure('status', solution.Status)
    } catch (e) {
      if (!(e instanceof SolverCancelled)) failure = e instanceof SolverFailure ? e : new SolverFailure('wasm')
    }
    if (disposed || started !== generation) return

    inFlight = null
    if (result) {
      cacheSet(problem.key, result)
      if (problem.key === current.key) displayed = { ...problem, result }
    } else if (failure) {
      failed.set(problem.key, failure)
    }

    const next = pending
    pending = null
    if (next) process(next)
    else emit()
  }

  function process(problem: Problem) {
    if (problem.key === '') {
      displayed = {
        ...problem,
        result: { runsByStage: {}, tokensByEntry: {}, stamina: 0, tokensUsed: 0, gap: 0 },
      }
      emit()
      return
    }
    if (displayed && problem.key === displayed.key) {
      emit()
      return
    }
    const cached = cacheGet(problem.key)
    if (cached) {
      displayed = { ...problem, result: cached }
      emit()
      return
    }
    if (failed.has(problem.key)) {
      emit()
      return
    }
    if (displayed && isStillOptimal(displayed, problem, index)) {
      displayed = { ...problem, result: displayed.result }
      cacheSet(problem.key, displayed.result)
      emit()
      return
    }
    if (inFlight !== null) {
      pending = problem
      emit()
      return
    }
    void startSolve(problem)
  }

  function request(shortfall: ShortfallEntry[], budget: number) {
    if (disposed) return
    current = { key: problemKey(shortfall, budget), shortfall, budget }
    pending = null
    process(current)
  }

  return {
    request,
    retry() {
      if (disposed || !failed.has(current.key)) return
      failed.delete(current.key)
      request(current.shortfall, current.budget)
    },
    suspend() {
      if (disposed) return
      generation++
      inFlight = null
      pending = null
      emit()
    },
    dispose() {
      disposed = true
      pending = null
    },
    get solveCount() {
      return solveCount
    },
  }
}

interface WorkerReply {
  id: number
  result?: HighsLikeSolution
  error?: string
}

export function createWorkerSolve(timeoutMs: number = DEFAULT_TIMEOUT_MS): { solve: SolveFn; dispose(): void } {
  let worker: Worker | null = null
  let nextId = 0
  let cancelOutstanding: (() => void) | null = null

  function dropWorker() {
    worker?.terminate()
    worker = null
  }

  function solve(lp: string): Promise<HighsLikeSolution> {
    return new Promise((resolve, reject) => {
      let w: Worker
      try {
        w = worker ?? (worker = new Worker(new URL('../workers/optimizer.worker', import.meta.url), { type: 'module' }))
      } catch {
        reject(new SolverFailure('init'))
        return
      }
      const id = ++nextId

      const cleanup = () => {
        clearTimeout(timer)
        w.onmessage = null
        w.onerror = null
        w.onmessageerror = null
        cancelOutstanding = null
      }
      const fail = (kind: SolverFailureKind) => {
        cleanup()
        dropWorker()
        reject(new SolverFailure(kind))
      }

      const timer = setTimeout(() => fail('timeout'), timeoutMs)
      cancelOutstanding = () => {
        cleanup()
        reject(new SolverCancelled())
      }

      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        if (e.data.id !== id) return
        if (e.data.error !== undefined || !e.data.result) {
          if (import.meta.env.DEV) console.error('[solver] worker error:', e.data.error)
          fail('wasm')
          return
        }
        cleanup()
        resolve(e.data.result)
      }
      w.onerror = () => fail('init')
      w.onmessageerror = () => fail('wasm')
      try {
        w.postMessage({ id, lp })
      } catch {
        fail('init')
      }
    })
  }

  return {
    solve,
    dispose() {
      cancelOutstanding?.()
      dropWorker()
    },
  }
}
