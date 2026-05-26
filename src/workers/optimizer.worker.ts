import highsLoader from 'highs'

type Highs = Awaited<ReturnType<typeof highsLoader>>
let highs: Highs | null = null
const isDev = import.meta.env.DEV

async function getSolver(): Promise<Highs> {
  if (!highs) {
    if (isDev) console.log('[solver] initializing HiGHS WASM...')
    const t0 = performance.now()
    highs = await highsLoader({
      locateFile: () => `${import.meta.env.BASE_URL}highs.wasm`,
    })
    if (isDev) console.log(`[solver] HiGHS ready in ${(performance.now() - t0).toFixed(0)}ms`)
  }
  return highs
}

self.onmessage = async (e: MessageEvent<{ lp: string }>) => {
  const { lp } = e.data
  try {
    if (isDev) console.log(`[solver] received LP: ${lp.length} chars, ${lp.split('\n').length} lines`)

    const solver = await getSolver()
    const t0 = performance.now()
    const solution = solver.solve(lp)
    const elapsed = performance.now() - t0

    if (isDev) {
      console.log(`[solver] status: ${solution.Status}, objective: ${solution.ObjectiveValue}, time: ${elapsed.toFixed(0)}ms`)
      if (solution.Status !== 'Optimal') {
        console.warn('[solver] non-optimal result, full solution:', solution)
        console.warn('[solver] LP input:\n', lp)
      }
    }

    self.postMessage({ result: solution })
  } catch (error) {
    if (isDev) {
      console.error('[solver] solve failed:', error)
      console.error('[solver] LP input:\n', lp)
    }
    self.postMessage({ error: String(error) })
  }
}
