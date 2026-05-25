import lpSolver from 'javascript-lp-solver'

self.onmessage = (e: MessageEvent<{ model: any }>) => {
  const { model } = e.data
  try {
    const result = lpSolver.Solve(model)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
