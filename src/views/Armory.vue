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
          <!-- Top Panel: Characters -->
          <section class="panel character-panel">
            <header>
              <h2>{{ $t('armory.characters') }}</h2>
            </header>

            <div class="character-list">
              <CharacterPanel
                v-for="name in armoryStore.selectedCharacters"
                :key="name"
                :name="name"
                :open="armoryStore.openPanel === name"
                :focused="armoryStore.focusedCharacter === name"
                @toggle-open="armoryStore.togglePanel(name)"
                @toggle-focus="armoryStore.toggleFocus(name)"
                @remove="armoryStore.removeCharacter(name)"
              />
            </div>

            <div
              v-if="armoryStore.selectedCharacters.length < MAX_SELECTED"
              class="add-character"
              :class="{ 'has-characters': armoryStore.selectedCharacters.length > 0 }"
            >
              <button
                class="select-character-btn"
                type="button"
                @click="toggleCharSelect"
              >
                + {{ $t('armory.addCharacter', { count: armoryStore.selectedCharacters.length, max: MAX_SELECTED }) }}
              </button>
              <div v-if="showCharSelect" class="char-dropdown-wrapper">
                <CharacterSelector
                  ref="charSelectorRef"
                  model-value=""
                  :char-list="armoryStore.charList"
                  :exclude="armoryStore.selectedCharacters"
                  @update:model-value="onPickCharacter"
                />
              </div>
            </div>
          </section>

          <!-- Middle Panel: Requirements -->
          <section class="panel requirements-panel">
            <header>
              <h2>{{ $t('armory.gearAndMaterials') }}</h2>
              <div v-if="armoryStore.focusedCharacter" class="focus-banner">
                <span class="focus-banner-text">{{ $t('armory.focusedBanner', { name: focusedName }) }}</span>
                <button
                  class="focus-banner-clear"
                  type="button"
                  :aria-label="$t('armory.clearFocus')"
                  :title="$t('armory.clearFocus')"
                  @click="armoryStore.clearFocus()"
                >✕</button>
              </div>
              <label class="hide-fulfilled-label">
                <input type="checkbox" v-model="hideMetReqs" />
                {{ $t('armory.hideFulfilled') }}
              </label>
            </header>
            <RequirementsPanel
              :mat-list="filteredMatList"
              @dec-material="decMaterial"
              @inc-material="incMaterial"
              @set-material-zero="setMaterialZero"
              @set-material-need="setMaterialNeed"
              @set-material-count="setMaterialCount"
            />
            <button
              v-if="armoryStore.selectedCharacters.length > 0"
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
            <div v-if="armoryStore.focusedCharacter" class="focus-banner">
              <span class="focus-banner-text">{{ $t('armory.focusedBanner', { name: focusedName }) }}</span>
              <button
                class="focus-banner-clear"
                type="button"
                :aria-label="$t('armory.clearFocus')"
                :title="$t('armory.clearFocus')"
                @click="armoryStore.clearFocus()"
              >✕</button>
            </div>
          </header>
          <OptimizationPanel
            :plan="armoryStore.planRows"
            :total-stamina="armoryStore.totalStamina"
            :gap="armoryStore.planGap"
            :solving="armoryStore.solving"
            :stale="armoryStore.planStale"
            :solver-error="armoryStore.solverError"
            :retryable="armoryStore.solverError !== null"
            :unfarmable="armoryStore.infeasibleMaterials"
            :equipment-101-count="armoryStore.equipment101Count"
            :equipment-101-used="armoryStore.equipment101Used"
            :eq101-replaced-mats="armoryStore.eq101ReplacedMats"
            @retry="armoryStore.retrySolve()"
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
import { useMaterialInventoryStore } from '@/stores/materialInventory'
import AppLayout from '@/components/Layout/AppLayout.vue'
import CharacterSelector from '@/components/Armory/CharacterSelector.vue'
import CharacterPanel from '@/components/Armory/CharacterPanel.vue'
import RequirementsPanel from '@/components/Armory/RequirementsPanel.vue'
import OptimizationPanel from '@/components/Armory/OptimizationPanel.vue'
import OwnedGearModal from '@/components/Armory/OwnedGearModal.vue'
import { getAssetUrl } from '@/utils/assets'
import { HideFulfilledStorage } from '@/utils/storage'
import { MAX_SELECTED } from '@/utils/armory/constants'

const { locale } = useI18n()
const armoryStore = useArmoryStore()
const inventoryStore = useMaterialInventoryStore()

const showCharSelect = ref(false)
const showOwnedGearModal = ref(false)
const hideMetReqs = ref(HideFulfilledStorage.get())
const charSelectorRef = ref<InstanceType<typeof CharacterSelector> | null>(null)

const focusedName = computed(() => {
  const focused = armoryStore.focusedCharacter
  if (!focused) return ''
  const entry = armoryStore.charList.find(c => c.name === focused)
  if (!entry) return focused
  return locale.value === 'en' ? entry.en : entry.name
})

const filteredMatList = computed(() => {
  if (!hideMetReqs.value) return armoryStore.materialNeeds
  return armoryStore.materialNeeds.filter(m => m.have < m.need)
})

function toggleCharSelect() {
  showCharSelect.value = !showCharSelect.value
  if (showCharSelect.value) {
    nextTick(() => charSelectorRef.value?.focus())
  }
}

function onPickCharacter(name: string) {
  if (name) armoryStore.addCharacter(name)
  showCharSelect.value = false
}

function decMaterial(uid: number) {
  const current = inventoryStore.getCount(uid)
  inventoryStore.setCount(uid, Math.max(0, current - 1))
}

function incMaterial(uid: number) {
  const current = inventoryStore.getCount(uid)
  inventoryStore.setCount(uid, current + 1)
}

function setMaterialZero(uid: number) {
  inventoryStore.setCount(uid, 0)
}

function setMaterialNeed(uid: number) {
  const mat = armoryStore.materialNeeds.find(m => m.uid === uid)
  if (mat) {
    inventoryStore.setCount(uid, Math.max(0, mat.need))
  }
}

function setMaterialCount(uid: number, count: number) {
  inventoryStore.setCount(uid, Math.max(0, count))
}

watch(hideMetReqs, (hide) => {
  HideFulfilledStorage.set(hide)
})

onMounted(async () => {
  armoryStore.setActive(true)
  await armoryStore.loadData()
})

onUnmounted(() => {
  armoryStore.setActive(false)
})
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
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.hide-fulfilled-label {
  margin-left: auto;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.hide-fulfilled-label input[type="checkbox"] {
  cursor: pointer;
}

.panel header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.focus-banner {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.25rem 0.125rem 0.625rem;
  border: 1px solid var(--primary-color);
  border-radius: 999px;
  color: var(--primary-color);
  font-size: 0.75rem;
  font-weight: 600;
  min-width: 0;
}

.focus-banner-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-banner-clear {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.focus-banner-clear:hover {
  background: var(--hover-bg);
}

/* Character Panel */
.character-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.add-character {
  text-align: center;
}

.add-character.has-characters {
  margin-top: 0.75rem;
}

.select-character-btn {
  width: 100%;
  padding: 0.75rem 1.5rem;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1rem;
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
  margin: 1rem auto 0;
  text-align: left;
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
}
</style>
