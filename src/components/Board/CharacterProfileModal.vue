<template>
  <Teleport to="body">
    <div class="profile-overlay" tabindex="-1" ref="overlayRef" @click.self="close" @keydown.escape="close">
      <div class="profile-modal">
        <div class="profile-header">
          <div class="header-left">
            <button class="btn-close" @click="close" aria-label="Close">&times;</button>
            <span class="header-title">{{ $t('profile.title') }}</span>
          </div>

        </div>

        <div class="profile-body">
          <div v-if="!boardStore.boardData" class="loading-state">
            {{ $t('errors.noData') }}
          </div>
          <template v-else>
            <div class="char-panel">
              <h3 class="char-name-display">{{ displayName }}</h3>

              <div class="avatar-section" :class="`personality-${personalityClass}`">
                <img
                  :src="getCharacterImageUrl(character.name)"
                  :alt="character.name"
                  @error="handleImageError"
                />
                <div class="avatar-placeholder">{{ character.name.charAt(0) }}</div>
              </div>

              <div class="char-stars">
                <img
                  v-for="n in character.stars"
                  :key="n"
                  :src="getIconUrl('unit_star')"
                  alt="★"
                  class="star-icon"
                />
              </div>

              <div class="char-badges">
                <span class="badge badge-role">
                  <img
                    v-if="roleIconUrl"
                    :src="getAssetUrl(roleIconUrl)"
                    class="badge-icon"
                  />
                  {{ $t(`roles.${character.role}`) }}
                </span>
                <span class="badge badge-pos">
                  <img
                    v-if="deployRowIconUrl"
                    :src="getAssetUrl(deployRowIconUrl)"
                    class="badge-icon"
                  />
                  {{ $t(`deployRows.${character.deployRow}`) }}
                </span>
                <span class="badge badge-atk">
                  <img
                    v-if="attackTypeIconUrl"
                    :src="getAssetUrl(attackTypeIconUrl)"
                    class="badge-icon"
                  />
                  {{ $t(`attackTypes.${character.attackType}`) }}
                </span>
                <span class="badge badge-pers">
                  <img
                    v-if="personalityIconUrl"
                    :src="getAssetUrl(personalityIconUrl)"
                    class="badge-icon"
                  />
                  {{ $t(`personalities.${character.personality}`) }}
                </span>
              </div>

              <button class="ownership-btn" :class="{ owned: isOwned }" @click="toggleOwnership">
                {{ isOwned ? $t('profile.owned') : $t('profile.notOwned') }}
              </button>
            </div>

            <div class="board-panel">
              <h3 class="board-title">{{ $t('profile.boardTitle') }}</h3>

              <div v-for="layer in layers" :key="layer" class="board-section">
                <div class="layer-header">
                  <span class="layer-label">[ {{ $t(`layers.${layer}`) }} ]</span>
                  <span class="layer-divider"></span>
                  <span class="layer-bonus-label">
                    {{ $t('profile.bonusPerCell') }} +{{ getLayerBonus(layer) }}%
                  </span>
                </div>

                <div class="cell-grid">
                  <div
                    v-for="cellType in getCellTypes(layer)"
                    :key="cellType"
                    class="cell-item"
                    :class="{ active: isCellActivated(layer, cellType) }"
                    @click="toggleCell(layer, cellType)"
                  >
                    <span class="cell-check">{{ isCellActivated(layer, cellType) ? '✓' : '' }}</span>
                    <img
                      :src="getAssetUrl(getCellTypeIcon(cellType))"
                      :alt="cellType"
                      class="cell-icon"
                    />
                    <span class="cell-name">{{ $t(`cellTypes.${cellType}`) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useBoardStore } from '@/stores/board'
import type { Character } from '@/stores/board'
import { getAssetUrl, getCharacterImageUrl, getIconUrl } from '@/utils/assets'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  character: Character
}>()

const emit = defineEmits<{
  close: [void]
}>()

const { locale } = useI18n()
const boardStore = useBoardStore()
const overlayRef = ref<HTMLElement | null>(null)

onMounted(() => {
  overlayRef.value?.focus()
})

function close() {
  emit('close')
}

const displayName = computed(() => {
  return locale.value.startsWith('zh')
    ? props.character.name
    : props.character.en
})

const isOwned = computed(() =>
  boardStore.userProgress.ownedCharacters.has(props.character.name)
)

const layers = computed(() => {
  const allLayers = ['layer1', 'layer2', 'layer3'] as const
  return allLayers.filter(l => {
    const types = props.character.boardTypes?.[l]
    return types && types.length > 0
  })
})

function getCellTypes(layer: string): string[] {
  const types = props.character.boardTypes?.[layer as keyof typeof props.character.boardTypes]
  return types || []
}

function isCellActivated(layer: string, cellType: string): boolean {
  const cellKey = `${props.character.name}_${layer}_${cellType}`
  return boardStore.userProgress.activatedCells[cellKey] === true
}

function toggleCell(layer: string, cellType: string) {
  boardStore.toggleCellActivation(
    props.character,
    cellType,
    layer as 'layer1' | 'layer2' | 'layer3'
  )
}

function toggleOwnership() {
  boardStore.toggleCharacterOwnership(props.character.name)
}

function getLayerBonus(layer: string): number {
  return boardStore.boardData?.boardConfig?.[layer]?.bonusPerCell ?? 0
}

function getCellTypeIcon(cellType: string): string {
  const icons: Record<string, string> = {
    attack: 'assets/icons/board_atk.webp',
    crit: 'assets/icons/board_crit.webp',
    hp: 'assets/icons/board_hp.webp',
    critResist: 'assets/icons/board_critResist.webp',
    defense: 'assets/icons/board_def.webp',
  }
  return icons[cellType] || ''
}

const personalityClass = computed(() => {
  const map: Record<string, string> = {
    '冷靜': 'cool',
    '狂亂': 'mad',
    '天真': 'naive',
    '活潑': 'jolly',
    '憂鬱': 'gloomy'
  }
  return map[props.character.personality] || ''
})

const personalityIconUrl = computed(() => {
  const icons: Record<string, string> = {
    '天真': 'assets/icons/unit_personality_naive.webp',
    '冷靜': 'assets/icons/unit_personality_cool.webp',
    '憂鬱': 'assets/icons/unit_personality_gloomy.webp',
    '活潑': 'assets/icons/unit_personality_jolly.webp',
    '狂亂': 'assets/icons/unit_personality_mad.webp'
  }
  return icons[props.character.personality] || ''
})

const attackTypeIconUrl = computed(() => {
  const icons: Record<string, string> = {
    '物理': 'assets/icons/unit_attack_physic.webp',
    '魔法': 'assets/icons/unit_attack_magic.webp'
  }
  return icons[props.character.attackType] || ''
})

const roleIconUrl = computed(() => {
  const icons: Record<string, string> = {
    '輸出': 'assets/icons/unit_type_dps.webp',
    '坦克': 'assets/icons/unit_type_tank.webp',
    '輔助': 'assets/icons/unit_type_support.webp'
  }
  return icons[props.character.role] || ''
})

const deployRowIconUrl = computed(() => {
  const icons: Record<string, string> = {
    '前排': 'assets/icons/unit_position_front.webp',
    '中排': 'assets/icons/unit_position_middle.webp',
    '後排': 'assets/icons/unit_position_back.webp'
  }
  return icons[props.character.deployRow] || ''
})

function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
  const placeholder = target.nextElementSibling as HTMLElement
  if (placeholder) {
    placeholder.style.display = 'flex'
  }
}
</script>

<style scoped>
.profile-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 1rem;
}

.profile-modal {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  width: 100%;
  max-width: 820px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  line-height: 1;
}

.btn-close:hover {
  background: var(--hover-bg);
}

.header-title {
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-primary);
}

.profile-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.loading-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  width: 100%;
}

.char-panel {
  width: 260px;
  flex-shrink: 0;
  padding: 1.5rem 1.5rem 1rem;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  overflow-y: auto;
}

.char-name-display {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
  width: 100%;
}

.avatar-section {
  width: 160px;
  height: 160px;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  border: 2px solid var(--border-color);
  flex-shrink: 0;
}

.avatar-section img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 45%;
  display: block;
}

.avatar-placeholder {
  display: none;
  position: absolute;
  inset: 0;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  color: var(--text-muted);
  background: var(--bg-tertiary);
}

.personality-cool { background: var(--personality-cool-bg); }
.personality-mad { background: var(--personality-mad-bg); }
.personality-naive { background: var(--personality-naive-bg); }
.personality-jolly { background: var(--personality-jolly-bg); }
.personality-gloomy { background: var(--personality-gloomy-bg); }

.char-stars {
  display: flex;
  gap: 2px;
  margin-top: 0.25rem;
}

.char-stars .star-icon {
  width: 16px;
  height: 16px;
}

.char-badges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.375rem;
  margin-top: 0.5rem;
  width: 100%;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  background: var(--bg-tertiary, rgba(64, 64, 64, 0.6));
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  white-space: nowrap;
}

.badge-icon {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.ownership-btn {
  margin-top: auto;
  padding: 0.625rem 1.5rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  width: 100%;
}

.ownership-btn:hover {
  background: var(--hover-bg);
  border-color: var(--primary-color);
}

.ownership-btn.owned {
  background: var(--success-color);
  color: white;
  border-color: var(--success-color);
}

.ownership-btn.owned:hover {
  background: #45b359;
}

.board-panel {
  flex: 1;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  min-width: 0;
}

.board-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-primary);
  text-align: center;
  flex-shrink: 0;
}

.board-section {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.layer-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary, rgba(64, 64, 64, 0.4));
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.layer-divider {
  flex: 1;
  height: 1px;
  background: var(--border-color);
  opacity: 0.5;
}

.layer-bonus-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  font-weight: 400;
  white-space: nowrap;
}

.cell-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.25rem;
  padding: 0.5rem;
}

.cell-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
  border: 1px solid transparent;
}

.cell-item:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
}

.cell-item.active {
  background: rgba(81, 207, 102, 0.12);
  border-color: var(--success-color);
}

.cell-check {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  font-size: 0.625rem;
  color: white;
  background: transparent;
  flex-shrink: 0;
  transition: all 0.15s;
}

.cell-item.active .cell-check {
  background: var(--success-color);
  border-color: var(--success-color);
}

.cell-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
}

.cell-name {
  font-size: 0.75rem;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .profile-body {
    flex-direction: column;
  }

  .char-panel {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
  }

  .avatar-section {
    width: 100px;
    height: 100px;
  }

  .char-name-display {
    width: 100%;
    margin-bottom: 0.5rem;
    font-size: 1rem;
  }

  .badge {
    font-size: 0.6875rem;
    padding: 0.25rem;
  }

  .badge-icon {
    width: 12px;
    height: 12px;
  }

  .ownership-btn {
    margin-top: 0;
    width: auto;
  }

  .board-panel {
    padding: 1rem;
  }

  .cell-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}

@media (max-width: 480px) {
  .profile-modal {
    max-height: 95vh;
    border-radius: 12px;
  }

  .char-panel {
    padding: 0.75rem;
  }

  .board-panel {
    padding: 0.75rem;
  }

  .cell-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
