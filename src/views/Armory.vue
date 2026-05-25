<template>
  <AppLayout>
    <div class="armory-root">
      <img
        class="background-image"
        :src="getAssetUrl('assets/backgrounds/background.webp')"
        alt=""
        aria-hidden="true"
      />
      <div class="background-overlay"></div>

      <main class="armory-layout">
        <div class="left-column">
          <!-- Top Panel: Character Screen -->
          <section class="panel character-panel">
            <header>
              <h2>{{ $t('armory.characterScreen') }}</h2>
            </header>

            <!-- State A: Unselected -->
            <div v-if="!selectedChar" class="unselected-state">
              <div class="select-character-btn-area">
                <button
                  class="select-character-btn"
                  type="button"
                  @click="showCharSelect = !showCharSelect"
                >
                  + {{ $t('armory.selectCharacter') }}
                </button>
              </div>
              <div v-if="showCharSelect" class="char-dropdown-wrapper">
                <CharacterSelector
                  ref="charSelectorRef"
                  v-model="selectedChar"
                  :char-list="armoryStore.charList"
                />
              </div>
            </div>

            <!-- State B: Selected -->
            <div v-else class="selected-state">
              <div class="slots-row">
                <!-- Left slots: 0, 1, 5 -->
                <div class="slot-column">
                  <div
                    v-for="si in [0, 1, 5]"
                    :key="si"
                    class="gear-slot"
                    :class="gearSlotClass(si)"
                    @click="toggleOwnedForSlot(si)"
                  >
                    <div class="slot-check">{{ slotCheck(si) }}</div>
                    <img
                      v-if="slotGearName(si)"
                      :src="getGearImageUrl(slotGearName(si))"
                      :alt="slotGearName(si)"
                      class="slot-icon"
                      loading="lazy"
                      @error="($event.target as HTMLImageElement).style.display = 'none'"
                    />
                    <div class="slot-label">{{ $t(`armory.slot${si}`) }}</div>
                    <div class="slot-gear-name">{{ slotGearDisplayName(si) }}</div>
                  </div>
                </div>

                <!-- Center: Avatar + Character Info -->
                <div class="center-column">
                  <img
                    :src="getCharacterImageUrl(selectedChar)"
                    :alt="selectedChar"
                    class="character-avatar"
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                    @click="showCharSelect = true"
                  />
                  <div class="char-name">{{ displayCharName }}</div>
                  <div class="rank-row">
                    <button
                      class="rank-nav-btn"
                      type="button"
                      @click="prevRank"
                    >
                      ‹
                    </button>
                    <span class="rank-display" @click.stop="toggleRankDropdown()">
                      {{ $t('armory.currentRankLabel', { rank: String(currentRank).padStart(2, '0') }) }}
                    </span>
                    <Teleport to="body">
                      <div v-if="showRankDropdown" class="rank-dropdown" :style="rankDropdownStyle" @click.stop>
                        <button
                          v-for="r in armoryStore.maxRank"
                          :key="r"
                          class="rank-dropdown-item"
                          :class="{ active: r === currentRank }"
                          @click="setRank(r)"
                        >
                          {{ $t('armory.currentRankLabel', { rank: String(r).padStart(2, '0') }) }}
                        </button>
                      </div>
                    </Teleport>
                    <button
                      class="rank-nav-btn"
                      type="button"
                      @click="nextRank"
                    >
                      ›
                    </button>
                  </div>
                  <div v-if="showCharSelect" class="char-dropdown-wrapper">
                    <CharacterSelector
                      ref="charSelectorRef"
                      v-model="selectedChar"
                      :char-list="armoryStore.charList"
                    />
                  </div>
                </div>

                <!-- Right slots: 2, 4, 3 -->
                <div class="slot-column">
                  <div
                    v-for="si in [2, 4, 3]"
                    :key="si"
                    class="gear-slot"
                    :class="gearSlotClass(si)"
                    @click="toggleOwnedForSlot(si)"
                  >
                    <div class="slot-check">{{ slotCheck(si) }}</div>
                    <img
                      v-if="slotGearName(si)"
                      :src="getGearImageUrl(slotGearName(si))"
                      :alt="slotGearName(si)"
                      class="slot-icon"
                      loading="lazy"
                      @error="($event.target as HTMLImageElement).style.display = 'none'"
                    />
                    <div class="slot-label">{{ $t(`armory.slot${si}`) }}</div>
                    <div class="slot-gear-name">{{ slotGearDisplayName(si) }}</div>
                  </div>
                </div>
              </div>

              <!-- Target rank selector below character -->
              <div class="target-rank-bar">
                <span class="target-label">{{ $t('armory.targetRank') }}</span>
                <div v-if="rankOptions.length > 0" class="rank-selector">
                  <button
                    v-for="r in rankOptions"
                    :key="r"
                    class="rank-btn"
                    :class="{ active: r === armoryStore.targetRank }"
                    type="button"
                    :disabled="r < currentRank"
                    @click="setTarget(r)"
                  >
                    {{ r }}
                  </button>
                </div>
                <span v-else class="max-label">MAX</span>
              </div>
            </div>
          </section>

          <!-- Middle Panel: Requirements -->
          <section class="panel requirements-panel">
            <header>
              <h2>{{ $t('armory.gearAndMaterials') }}</h2>
            </header>
            <RequirementsPanel
              :mat-list="armoryStore.materialNeeds"
              @dec-material="decMaterial"
              @inc-material="incMaterial"
              @set-material-zero="setMaterialZero"
              @set-material-need="setMaterialNeed"
              @set-material-count="setMaterialCount"
            />
            <button
              v-if="selectedChar"
              class="owned-gear-btn"
              type="button"
              @click="showOwnedGearModal = true"
            >
              {{ $t('armory.manageOwnedGear') }}
            </button>
          </section>
        </div>

        <!-- Right Panel: Optimization -->
        <section class="panel plan-panel">
          <header>
            <h2>{{ $t('armory.plan') }}</h2>
          </header>
          <OptimizationPanel
            :plan="armoryStore.plan"
            :total-stamina="armoryStore.totalStamina"
            :optimizing="armoryStore.optimizing"
            :optimization-progress="armoryStore.optimizationProgress"
            :unfarmable="armoryStore.infeasibleMaterials"
            :can-upgrade="armoryStore.canUpgrade"
            :equipment-101-count="armoryStore.equipment101Count"
            :equipment-101-used="armoryStore.equipment101Used"
            @upgrade="armoryStore.upgradeCharacter()"
            @dec-101="armoryStore.setEquipment101Count(armoryStore.equipment101Count - 1)"
            @inc-101="armoryStore.setEquipment101Count(armoryStore.equipment101Count + 1)"
            @set-101="armoryStore.setEquipment101Count($event)"
          />
        </section>
      </main>

      <OwnedGearModal
        v-if="showOwnedGearModal"
        @close="showOwnedGearModal = false"
      />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArmoryStore } from '@/stores/armory'
import { useRosterStore } from '@/stores/roster'
import { useOwnedGearStore } from '@/stores/ownedGear'
import { useMaterialInventoryStore } from '@/stores/materialInventory'
import AppLayout from '@/components/Layout/AppLayout.vue'
import CharacterSelector from '@/components/Armory/CharacterSelector.vue'
import RequirementsPanel from '@/components/Armory/RequirementsPanel.vue'
import OptimizationPanel from '@/components/Armory/OptimizationPanel.vue'
import OwnedGearModal from '@/components/Armory/OwnedGearModal.vue'
import { getAssetUrl, getCharacterImageUrl, getGearImageUrl } from '@/utils/assets'

const { locale } = useI18n()
const armoryStore = useArmoryStore()
const rosterStore = useRosterStore()
const ownedGearStore = useOwnedGearStore()
const inventoryStore = useMaterialInventoryStore()

const selectedChar = ref('')
const showCharSelect = ref(false)
const showOwnedGearModal = ref(false)
const charSelectorRef = ref<InstanceType<typeof CharacterSelector> | null>(null)
const showRankDropdown = ref(false)
const rankDropdownStyle = ref({})

const rankOptions = computed(() => {
  if (!selectedChar.value) return []
  const char = armoryStore.charData[selectedChar.value]
  const gear = char?.gear
  if (!gear) {
    const opts: number[] = []
    for (let r = 2; r <= armoryStore.maxRank; r++) opts.push(r)
    return opts
  }
  const rankIdx = currentRank.value - 1
  const rankGear = gear[rankIdx]
  if (!rankGear) {
    const opts: number[] = []
    for (let r = 2; r <= armoryStore.maxRank; r++) opts.push(r)
    return opts
  }
  const allEquipped = rankGear.every((uid: number) => ownedGearStore.isOwned(uid))
  const start = allEquipped ? currentRank.value + 1 : currentRank.value
  const options: number[] = []
  for (let r = start; r <= armoryStore.maxRank; r++) options.push(r)
  return options
})

const currentRank = computed(() => {
  if (!selectedChar.value) return 1
  const prog = rosterStore.getUnitProgress(selectedChar.value)
  return prog.currentRank
})

const displayCharName = computed(() => {
  const entry = armoryStore.charList.find(c => c.name === selectedChar.value)
  if (!entry) return selectedChar.value
  return locale.value === 'en' ? entry.en : entry.name
})

function setTarget(r: number) {
  armoryStore.setTargetRank(r)
}

function setRank(r: number) {
  showRankDropdown.value = false
  rosterStore.setUnitRank(selectedChar.value, r)
  armoryStore.computeRequirements()
}

function toggleRankDropdown() {
  showRankDropdown.value = !showRankDropdown.value
  if (showRankDropdown.value) {
    const span = document.querySelector('.rank-display') as HTMLElement | null
    if (!span) return
    const rect = span.getBoundingClientRect()
    rankDropdownStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left + rect.width / 2}px`,
      transform: 'translateX(-50%)',
      zIndex: 9999,
    }
  }
}

function prevRank() {
  const r = rosterStore.getUnitProgress(selectedChar.value)
  if (r.currentRank > 1) {
    rosterStore.setUnitRank(selectedChar.value, r.currentRank - 1)
    armoryStore.computeRequirements()
  }
}

function nextRank() {
  const r = rosterStore.getUnitProgress(selectedChar.value)
  if (r.currentRank < armoryStore.maxRank) {
    rosterStore.setUnitRank(selectedChar.value, r.currentRank + 1)
    armoryStore.computeRequirements()
  }
}

function getSlotGearUid(slotIndex: number): number | null {
  const charName = selectedChar.value
  if (!charName) return null
  const char = armoryStore.charData[charName]
  if (!char) return null
  const gear = char.gear
  if (!gear) return null
  const rank = currentRank.value
  const rankIdx = rank - 1
  if (!gear[rankIdx]) return null
  return gear[rankIdx][slotIndex] as number
}

function slotGearName(slotIndex: number): string {
  const uid = getSlotGearUid(slotIndex)
  if (!uid) return ''
  const info = armoryStore.getGearNameByUid(uid)
  return info.name
}

function slotGearDisplayName(slotIndex: number): string {
  const uid = getSlotGearUid(slotIndex)
  if (!uid) return ''
  const info = armoryStore.getGearNameByUid(uid)
  return locale.value === 'en' ? info.nameEn : info.name
}

function isSlotOwned(slotIndex: number): boolean {
  const uid = getSlotGearUid(slotIndex)
  if (!uid) return false
  if (ownedGearStore.isOwned(uid)) return true
  const roster = rosterStore.rosterData[selectedChar.value]
  if (!roster) return false
  const equippedName = roster.equipment[slotIndex]
  if (!equippedName) return false
  const nameToUid = armoryStore.getNameToUidMap()
  const rosterUid = nameToUid.get(equippedName)
  return rosterUid === uid
}

function slotCheck(slotIndex: number): string {
  return isSlotOwned(slotIndex) ? '✓' : '○'
}

function gearSlotClass(slotIndex: number): Record<string, boolean> {
  return { equipped: isSlotOwned(slotIndex) }
}

function toggleOwnedForSlot(slotIndex: number) {
  if (!selectedChar.value) return
  const uid = getSlotGearUid(slotIndex)
  if (!uid) return
  ownedGearStore.toggleOwned(uid)
  armoryStore.computeRequirements()
}

function decMaterial(uid: number) {
  const current = inventoryStore.getCount(uid)
  inventoryStore.setCount(uid, Math.max(0, current - 1))
  armoryStore.computeRequirements()
}

function incMaterial(uid: number) {
  const current = inventoryStore.getCount(uid)
  inventoryStore.setCount(uid, current + 1)
  armoryStore.computeRequirements()
}

function setMaterialZero(uid: number) {
  inventoryStore.setCount(uid, 0)
  armoryStore.computeRequirements()
}

function setMaterialNeed(uid: number) {
  const mat = armoryStore.materialNeeds.find(m => m.uid === uid)
  if (mat) {
    inventoryStore.setCount(uid, mat.need)
    armoryStore.computeRequirements()
  }
}

function setMaterialCount(uid: number, count: number) {
  inventoryStore.setCount(uid, Math.max(0, count))
  armoryStore.computeRequirements()
}

watch(showCharSelect, (show) => {
  if (show) {
    nextTick(() => charSelectorRef.value?.focus())
  }
})

watch(selectedChar, (name) => {
  if (name) {
    armoryStore.selectCharacter(name)
    showCharSelect.value = false
  }
})

watch(rankOptions, (opts) => {
  if (!selectedChar.value) return
  if (opts.length > 0 && !opts.includes(armoryStore.targetRank)) {
    armoryStore.setTargetRank(opts[0])
  }
})

onMounted(async () => {
  await armoryStore.loadData()
  if (armoryStore.selectedCharacter) {
    selectedChar.value = armoryStore.selectedCharacter
  }

  document.addEventListener('click', closeRankDropdown)
})

onUnmounted(() => {
  armoryStore.disposeSolver()
  document.removeEventListener('click', closeRankDropdown)
})

function closeRankDropdown() {
  showRankDropdown.value = false
}
</script>

<style scoped>
.armory-root {
  position: relative;
  min-height: calc(100vh - 140px);
}

.background-image {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: -2;
}

.background-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--overlay-bg);
  z-index: -1;
}

.armory-layout {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 2rem;
  align-items: start;
}

.left-column {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
}

.panel header {
  margin-bottom: 1rem;
}

.panel header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Character Panel */
.unselected-state {
  text-align: center;
  padding: 2rem 0;
}

.select-character-btn-area {
  margin-bottom: 1rem;
}

.select-character-btn {
  padding: 1rem 2rem;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.125rem;
  font-family: var(--site-font);
  cursor: pointer;
  transition: all 0.2s;
}

.select-character-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.char-dropdown-wrapper {
  max-width: 320px;
  margin: 0 auto;
}

/* Selected state */
.selected-state {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.slots-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
}

.slot-column {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.gear-slot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  opacity: 0.65;
}

.gear-slot.equipped {
  opacity: 1;
  border-color: var(--primary-color);
}

.gear-slot:hover {
  border-color: var(--primary-color);
}

.slot-check {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.gear-slot.equipped .slot-check {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.slot-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 4px;
  background: var(--card-bg);
}

.slot-label {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  min-width: 2.5rem;
}

.slot-gear-name {
  font-size: 0.6875rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.center-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.character-avatar {
  width: 80px;
  height: 80px;
  object-fit: contain;
  border-radius: 50%;
  background: var(--panel-bg);
  border: 2px solid var(--border-color);
  cursor: pointer;
}

.char-name {
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.rank-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rank-nav-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 1rem;
  font-family: var(--site-font);
  cursor: pointer;
  transition: all 0.2s;
}

.rank-nav-btn:hover {
  border-color: var(--primary-color);
}

.rank-display {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  min-width: 7rem;
  text-align: center;
  cursor: pointer;
}

.rank-dropdown {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  min-width: 7rem;
}

.rank-dropdown-item {
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: var(--site-font);
  cursor: pointer;
  text-align: center;
  transition: background 0.15s;
}

.rank-dropdown-item:hover {
  background: var(--hover-bg);
}

.rank-dropdown-item.active {
  color: var(--primary-color);
  font-weight: 600;
}

/* Target Rank Bar */
.target-rank-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--panel-bg);
  border-radius: 8px;
}

.target-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.rank-selector {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.rank-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: var(--site-font);
  cursor: pointer;
  transition: all 0.2s;
}

.rank-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
}

.rank-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.rank-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.max-label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-color);
  letter-spacing: 0.05em;
}

/* Requirements Panel */
.requirements-panel {
  overflow: visible;
}

.owned-gear-btn {
  width: 100%;
  padding: 0.625rem;
  margin-top: 0.75rem;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-family: var(--site-font);
  cursor: pointer;
  transition: all 0.2s;
}

.owned-gear-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

/* Plan Panel */
.plan-panel {
  position: sticky;
  top: 90px;
  height: fit-content;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

@media (max-width: 1000px) {
  .armory-layout {
    grid-template-columns: 1fr;
  }

  .plan-panel {
    position: static;
    max-height: none;
  }
}

@media (max-width: 768px) {
  .armory-layout {
    padding: 1rem;
    gap: 1.5rem;
  }

  .panel {
    padding: 1rem;
  }

  .slots-row {
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .center-column {
    grid-column: 1 / -1;
    order: -1;
  }
}
</style>
