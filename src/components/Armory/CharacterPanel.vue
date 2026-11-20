<template>
  <div class="character-row" :class="{ open, focused }">
    <div class="row-header" @click="emit('toggle-open')">
      <img
        :src="getCharacterImageUrl(name)"
        alt=""
        class="row-avatar"
        loading="lazy"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span class="row-name">{{ displayName }}</span>
      <span class="row-rank">{{ $t('armory.rankRange', { from: currentRank, to: targetRank }) }}</span>
      <span class="row-badge" :class="{ ready: isReady }">{{ badgeLabel }}</span>
      <button
        class="focus-btn"
        :class="{ active: focused }"
        type="button"
        :aria-pressed="focused"
        @click.stop="emit('toggle-focus')"
      >
        {{ focused ? $t('armory.focused') : $t('armory.focus') }}
      </button>
      <button
        class="chevron-btn"
        type="button"
        :aria-expanded="open"
        :aria-controls="bodyId"
        :aria-label="toggleLabel"
        @click.stop="emit('toggle-open')"
      >
        <span class="chevron" :class="{ open }" aria-hidden="true">▾</span>
      </button>
    </div>

    <div v-if="open" :id="bodyId" class="row-body">
      <div class="slots-row">
        <div class="slot-column">
          <GearSlot v-for="si in [0, 1, 5]" :key="si" :slot-index="si" :selected-char="name" />
        </div>

        <div class="center-column">
          <img
            :src="getCharacterImageUrl(name)"
            :alt="displayName"
            class="character-avatar"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div class="char-name">{{ displayName }}</div>
          <div class="rank-row">
            <button class="rank-nav-btn" type="button" @click="prevRank">‹</button>
            <button
              ref="rankLabelRef"
              class="rank-display"
              type="button"
              :aria-expanded="showRankDropdown"
              @click="toggleRankDropdown"
            >
              {{ $t('armory.currentRankLabel', { rank: String(currentRank).padStart(2, '0') }) }}
            </button>
            <Teleport to="body">
              <div
                v-if="showRankDropdown"
                ref="rankDropdownRef"
                class="rank-dropdown"
                :style="rankDropdownStyle"
              >
                <button
                  v-for="r in maxRank"
                  :key="r"
                  class="rank-dropdown-item"
                  :class="{ active: r === currentRank }"
                  type="button"
                  @click="setRank(r)"
                >
                  {{ $t('armory.currentRankLabel', { rank: String(r).padStart(2, '0') }) }}
                </button>
              </div>
            </Teleport>
            <button class="rank-nav-btn" type="button" @click="nextRank">›</button>
          </div>
        </div>

        <div class="slot-column">
          <GearSlot v-for="si in [2, 4, 3]" :key="si" :slot-index="si" :selected-char="name" />
        </div>
      </div>

      <div class="target-rank-bar">
        <span class="target-label">{{ $t('armory.targetRank') }}</span>
        <div v-if="rankOptions.length > 0" class="rank-selector">
          <button
            v-for="r in rankOptions"
            :key="r"
            class="rank-btn"
            :class="{ active: r === targetRank }"
            type="button"
            :disabled="r < currentRank"
            @click="armoryStore.setTargetRank(name, r)"
          >
            {{ r }}
          </button>
        </div>
        <span v-else class="max-label">{{ $t('armory.max') }}</span>
      </div>

      <div class="row-actions">
        <button class="remove-btn" type="button" @click="emit('remove')">
          {{ $t('armory.removeCharacter') }}
        </button>
        <button
          class="upgrade-btn"
          type="button"
          :disabled="!isReady"
          @click="armoryStore.upgradeCharacter(name)"
        >
          {{ $t('armory.upgradeNamed', { name: displayName }) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
let nextBodyId = 0
</script>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArmoryStore } from '@/stores/armory'
import { useRosterStore } from '@/stores/roster'
import GearSlot from '@/components/Armory/GearSlot.vue'
import { getCharacterImageUrl } from '@/utils/assets'
import { range } from '@/utils/helpers'

const props = defineProps<{
  name: string
  open: boolean
  focused: boolean
}>()

const emit = defineEmits<{
  'toggle-open': []
  'toggle-focus': []
  remove: []
}>()

const { locale, t } = useI18n()
const armoryStore = useArmoryStore()
const rosterStore = useRosterStore()

const bodyId = `armory-panel-body-${nextBodyId++}`

const rankLabelRef = ref<HTMLElement | null>(null)
const rankDropdownRef = ref<HTMLElement | null>(null)
const showRankDropdown = ref(false)
const rankDropdownStyle = ref({})

const maxRank = computed(() => armoryStore.maxRankOf(props.name))

const currentRank = computed(() => armoryStore.currentRankOf(props.name))

const targetRank = computed(() => armoryStore.targetRankOf(props.name))

const upgrade = computed(() => armoryStore.upgradeInfo[props.name])

const isReady = computed(() => !!upgrade.value?.ready)

const isMaxed = computed(() => upgrade.value?.reason === 'nothing-to-equip' && currentRank.value >= maxRank.value)

const badgeLabel = computed(() => {
  if (isMaxed.value) return t('armory.max')
  return isReady.value ? t('armory.ready') : t('armory.notReady')
})

const displayName = computed(() => {
  const entry = armoryStore.charList.find(c => c.name === props.name)
  if (!entry) return props.name
  return locale.value === 'en' ? entry.en : entry.name
})

const toggleLabel = computed(() => `${displayName.value}: ${props.open ? t('armory.collapse') : t('armory.expand')}`)

const rankOptions = computed(() =>
  isMaxed.value ? [] : range(armoryStore.minTargetOf(props.name), maxRank.value),
)

function setRank(r: number) {
  showRankDropdown.value = false
  rosterStore.setUnitRank(props.name, r)
}

function prevRank() {
  if (currentRank.value > 1) rosterStore.setUnitRank(props.name, currentRank.value - 1)
}

function nextRank() {
  if (currentRank.value < maxRank.value) rosterStore.setUnitRank(props.name, currentRank.value + 1)
}

function toggleRankDropdown() {
  showRankDropdown.value = !showRankDropdown.value
  if (!showRankDropdown.value) return
  const el = rankLabelRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  rankDropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left + rect.width / 2}px`,
    transform: 'translateX(-50%)',
    zIndex: 9999,
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!showRankDropdown.value) return
  const target = e.target as Node | null
  if (target && (rankLabelRef.value?.contains(target) || rankDropdownRef.value?.contains(target))) return
  showRankDropdown.value = false
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !showRankDropdown.value) return
  showRankDropdown.value = false
  rankLabelRef.value?.focus()
}

watch(() => props.open, (open) => {
  if (!open) showRankDropdown.value = false
})

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<style scoped>
.character-row {
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  transition: border-color 0.2s;
}

.character-row.focused {
  border-color: var(--primary-color);
}

.row-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  user-select: none;
  border-radius: 12px;
}

.row-header:hover {
  background: var(--hover-bg);
}

.row-avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 50%;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}

.row-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.row-rank {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.row-badge {
  margin-left: auto;
  padding: 0.125rem 0.625rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.row-badge.ready {
  border-color: var(--primary-color);
  color: var(--primary-color);
  font-weight: 600;
}

.focus-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-family: var(--site-font);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.focus-btn:hover {
  border-color: var(--primary-color);
}

.focus-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.chevron-btn {
  padding: 0 0.25rem;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: var(--site-font);
  cursor: pointer;
}

.chevron-btn:focus-visible,
.rank-display:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
  border-radius: 4px;
}

.chevron {
  display: inline-block;
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
}

.row-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.875rem;
  border-top: 1px solid var(--border-color);
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
  padding: 0;
  border: none;
  background: none;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: var(--site-font);
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

.target-rank-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--card-bg);
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

.row-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.remove-btn,
.upgrade-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--button-bg);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: var(--site-font);
  cursor: pointer;
  transition: all 0.2s;
}

.remove-btn:hover,
.upgrade-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
}

.upgrade-btn {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
  font-weight: 600;
}

.upgrade-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .row-header {
    flex-wrap: wrap;
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
