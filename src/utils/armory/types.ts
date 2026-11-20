export interface GearEntry {
  uid: number
  name: string
  nameEn: string
  type: string
  recipe?: { uid: number; count: number }[]
}

export type GearDb = Record<string, GearEntry>

export type MaterialDb = Record<string, { uid: number; name: string; nameEn: string }>

export interface SweepEntry {
  uid: number
  rank: number
  stages: { code: string; dropRate: number }[]
}

export type SweepData = Record<string, SweepEntry>

export type CharactersData = Record<string, { name?: string; en?: string; gear?: number[][] }>

export interface StaticData {
  gearDb: GearDb
  materialDb: MaterialDb
  charData: CharactersData
  sweepData: SweepData
}

export interface CharacterInput {
  name: string
  currentRank: number
  targetRank: number
  equipment: (string | null)[]
}

export interface Stock {
  ownedGear: Record<number, number>
  inventory: Record<number, number>
  tokens: number
}

export interface ShortfallEntry {
  uid: number
  rank: number
  count: number
}

export type StageIndex = Map<number, { stage: string; dropRate: number }[]>

export interface MaterialRequirement {
  uid: number
  name: string
  nameEn: string
  have: number
  need: number
  farmable: boolean
  minRank: number
}

export interface StageDrop {
  uid: number
  name: string
  nameEn: string
  dropRate: number
}

export interface StagePlanRow {
  stage: string
  runs: number
  stamina: number
  expectedDrops: StageDrop[]
}

export interface Eq101ReplacedMat {
  uid: number
  name: string
  nameEn: string
  count: number
}
