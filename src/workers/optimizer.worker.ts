import highsLoader from 'highs'
import { SOLVER_TIME_LIMIT_S, STAMINA_PER_RUN } from '@/utils/armory/constants'
import { solveLpCapped } from '@/utils/armory/highsSolve'
import type { HighsLikeSolution } from '@/utils/armory/lpModel'

type Highs = Awaited<ReturnType<typeof highsLoader>>
let highs: Highs | null = null
const isDev = import.meta.env.DEV

async function getSolver(): Promise<Highs> {
  if (!highs) {
    if (isDev) console.log('[solver] initializing HiGHS WASM...')
    const t0 = performance.now()
    highs = await highsLoader()
    if (isDev) console.log(`[solver] HiGHS ready in ${(performance.now() - t0).toFixed(0)}ms`)
  }
  return highs
}

type SolveReply = { id: number; result?: HighsLikeSolution; error?: string }

self.onmessage = async (e: MessageEvent<unknown>) => {
  const data: unknown = e?.data
  const { id, lp } = (typeof data === 'object' && data !== null ? data : {}) as { id?: unknown; lp?: unknown }
  if (typeof id !== 'number' || !Number.isFinite(id) || typeof lp !== 'string') {
    self.postMessage({ id: typeof id === 'number' ? id : -1, error: 'invalid request' } satisfies SolveReply)
    return
  }
  try {
    if (isDev) console.log(`[solver] received LP: ${lp.length} chars, ${lp.split('\n').length} lines`)

    const solver = await getSolver()
    const t0 = performance.now()
    const solution = solveLpCapped(solver, lp, SOLVER_TIME_LIMIT_S)
    const elapsed = performance.now() - t0

    if (isDev) {
      let objective = 0
      for (const [name, col] of Object.entries(solution.Columns)) {
        if (name.startsWith('s_')) objective += col.Primal * STAMINA_PER_RUN
      }
      console.log(
        `[solver] status: ${solution.Status}, objective: ${objective}, dual bound: ${solution.DualBound ?? 'n/a'}, time: ${elapsed.toFixed(0)}ms`,
      )
      if (solution.Status !== 'Optimal') {
        console.warn('[solver] non-optimal result, full solution:', solution)
        console.warn('[solver] LP input:\n', lp)
      }
    }

    self.postMessage({ id, result: solution } satisfies SolveReply)
  } catch (error) {
    if (isDev) {
      console.error('[solver] solve failed:', error)
      console.error('[solver] LP input:\n', lp)
    }
    self.postMessage({ id, error: String(error) } satisfies SolveReply)
  }
}
