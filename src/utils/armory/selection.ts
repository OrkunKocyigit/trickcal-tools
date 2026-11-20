import { MAX_SELECTED } from './constants'

/** Keep unique, known string names (first occurrence, original order), at most MAX_SELECTED. */
export function sanitizeSelection(raw: unknown, known: (name: string) => boolean): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (result.length >= MAX_SELECTED) break
    if (typeof item !== 'string' || seen.has(item) || !known(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/** Normalise an untrusted target rank to an integer in [min(currentRank, maxRank), maxRank]. */
export function clampTarget(raw: unknown, currentRank: number, maxRank: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return maxRank
  const lower = Math.min(currentRank, maxRank)
  return Math.min(maxRank, Math.max(lower, Math.floor(raw)))
}
