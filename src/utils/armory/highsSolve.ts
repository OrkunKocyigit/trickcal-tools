import type { HighsLikeSolution } from './lpModel'

type OptionValue = boolean | number | string

/** The slice of a HiGHS model (`highs.withModel` callback argument) that solveLpCapped uses. */
export interface HighsModelLike {
  options: { set(values: Readonly<Record<string, OptionValue>>): unknown }
  info: { get(name: string): number | bigint }
  run(): unknown
  getModelStatus(): number
  getSolution(): { colValue: ArrayLike<number> }
  getColName(index: number): string
}

/** The slice of the loaded HiGHS runtime that solveLpCapped uses; the real `highs` package satisfies it. */
export interface HighsLike {
  constants: {
    modelStatus: Readonly<Record<string, number>> & { optimal: number; timeLimit: number }
    solutionStatus: { feasible: number }
  }
  withModel<Result>(
    source: { readonly format: 'lp'; readonly data: string },
    operation: (model: HighsModelLike) => Result,
  ): Result
}

export const STATUS_OPTIMAL = 'Optimal'
export const STATUS_TIME_LIMIT = 'Time limit reached'
const STATUS_NO_SOLUTION = 'No feasible solution'
const STATUS_UNKNOWN = 'Unknown'

function infoNumber(model: HighsModelLike, name: string): number | undefined {
  try {
    const raw = model.info.get(name)
    const value = typeof raw === 'bigint' ? Number(raw) : raw
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

function statusName(modelStatus: Readonly<Record<string, number>>, code: number): string {
  for (const [name, value] of Object.entries(modelStatus)) {
    if (value === code) return name
  }
  return STATUS_UNKNOWN
}

/**
 * Solve an LP-format MIP with an exact gap and a wall-clock cap. A solve stopped by the cap with a feasible plan
 * reports 'Time limit reached' plus the proven dual (lower) bound; any other non-optimal outcome reports a plain status name.
 */
export function solveLpCapped(highs: HighsLike, lp: string, timeLimitS: number): HighsLikeSolution {
  const { modelStatus, solutionStatus } = highs.constants
  return highs.withModel({ format: 'lp', data: lp }, (model) => {
    model.options.set({ output_flag: false, mip_rel_gap: 0, time_limit: timeLimitS })
    model.run()

    const status = model.getModelStatus()
    const timeLimited = status === modelStatus.timeLimit
    if (status !== modelStatus.optimal && !timeLimited) {
      return { Status: statusName(modelStatus, status), Columns: {} }
    }
    if (timeLimited && infoNumber(model, 'primal_solution_status') !== solutionStatus.feasible) {
      return { Status: STATUS_NO_SOLUTION, Columns: {} }
    }

    const { colValue } = model.getSolution()
    const Columns: HighsLikeSolution['Columns'] = {}
    for (let i = 0; i < colValue.length; i++) Columns[model.getColName(i)] = { Primal: colValue[i] }
    if (!timeLimited) return { Status: STATUS_OPTIMAL, Columns }

    const DualBound = infoNumber(model, 'mip_dual_bound')
    return DualBound === undefined
      ? { Status: STATUS_TIME_LIMIT, Columns }
      : { Status: STATUS_TIME_LIMIT, Columns, DualBound }
  })
}
