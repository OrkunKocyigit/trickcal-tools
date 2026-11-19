/**
 * 掃蕩工具 rank 篩選邏輯
 */

/** 舊版篩選器只支援 rank 1-8 */
const LEGACY_RANKS = [1, 2, 3, 4, 5, 6, 7, 8]

function isValidRank(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function uniqueSorted(ranks: number[]): number[] {
  return [...new Set(ranks)].sort((a, b) => a - b)
}

/**
 * 從素材資料收集所有 rank（排序、去重）
 */
export function collectRanks(materialInfos: Iterable<unknown>): number[] {
  const ranks: number[] = []
  for (const info of materialInfos) {
    if (info && typeof info === 'object') {
      const rank = (info as { rank?: unknown }).rank
      if (isValidRank(rank)) ranks.push(rank)
    }
  }
  return uniqueSorted(ranks)
}

/**
 * 清理儲存的 rank 陣列，只保留正整數
 */
export function sanitizeRanks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return uniqueSorted(raw.filter(isValidRank))
}

/**
 * 將舊版「已選 rank」轉換為「排除 rank」
 * 空選擇在舊版代表不篩選
 */
export function legacySelectionToExcluded(raw: unknown): number[] {
  const selected = sanitizeRanks(raw)
  if (selected.length === 0) return []
  return LEGACY_RANKS.filter(rank => !selected.includes(rank))
}

/**
 * 是否需要套用 rank 篩選（部分 rank 被排除時）
 * 全部排除時視同不篩選
 */
export function isRankFilterActive(
  availableRanks: number[],
  excluded: ReadonlySet<number>
): boolean {
  const excludedCount = availableRanks.filter(rank => excluded.has(rank)).length
  return excludedCount > 0 && excludedCount < availableRanks.length
}

/**
 * 要儲存的排除 rank
 * 全部排除時儲存空陣列，避免日後新增 rank 時只顯示新 rank
 */
export function excludedRanksToPersist(
  availableRanks: number[],
  excluded: ReadonlySet<number>
): number[] {
  if (availableRanks.length > 0 && availableRanks.every(rank => excluded.has(rank))) {
    return []
  }
  return sanitizeRanks([...excluded])
}
