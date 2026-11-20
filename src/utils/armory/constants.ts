export const STAMINA_PER_RUN = 10
export const MAX_SELECTED = 5
export const SOLVER_TIME_LIMIT_S = 3

export const EQUIPMENT_101_COST: Record<number, number> = {
  1: 4, 2: 5, 3: 6, 4: 10, 5: 12, 6: 14, 7: 22, 8: 24,
}

export function tokenCost(rank: number): number {
  return EQUIPMENT_101_COST[rank] ?? 99
}
