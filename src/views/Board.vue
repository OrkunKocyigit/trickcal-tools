<template>
  <AppLayout>
    <div class="board-root with-background">
      <!-- 背景圖片 -->
      <img 
        class="background-image" 
        :src="getAssetUrl('assets/backgrounds/background.webp')" 
        alt=""
        aria-hidden="true"
      />
      <div class="background-overlay"></div>
      
      <main class="board-layout">
        <!-- 左側面板：層級總覽 -->
        <aside class="panel layer-panel" :class="{ 'mobile-open': leftPanelOpen }">
          <div class="panel-header">
            <h3>{{ $t('board.layerPanel') }}</h3>
            <button 
              class="panel-close" 
              @click="leftPanelOpen = false"
              aria-label="關閉面板"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="layer-tabs">
            <button
              v-for="layer in (['layer1', 'layer2', 'layer3'] as const)"
              :key="layer"
              class="tab-btn"
              :class="{ active: boardStore.currentLayer === layer }"
              @click="boardStore.currentLayer = layer"
            >
              {{ $t(`layers.${layer}`) }}
            </button>
          </div>
          <div class="panel-card">
            <LayerSummary />
          </div>
        </aside>

        <!-- 中央區域：棋盤 -->
        <section class="board-stage">
          <div class="board-stage-header">
            <h2>{{ $t(`layers.${boardStore.currentLayer}`) }}</h2>
            <button class="settings-btn" @click="showSettings = true">
              {{ $t('nav.settings') }}
            </button>
          </div>

          <div class="board-stage-body">
            <!-- 搜尋輸入 -->
          <div class="board-search" ref="searchRef">
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              :placeholder="$t('board.searchPlaceholder')"
              @focus="onSearchFocus($event)"
              @blur="onSearchBlur"
              @keydown.escape="closeSearchDropdown"
              @keydown.enter="handleSearchEnter"
            />
            <div v-if="showSearchDropdown" class="search-dropdown">
              <div
                v-for="char in searchSuggestions"
                :key="char.name"
                class="search-dropdown-item"
                @mousedown.prevent="selectSearchResult(char)"
              >
                <span class="dropdown-name">{{ displayCharName(char) }}</span>
                <span class="dropdown-en">{{ locale.startsWith('zh') ? char.en : char.name }}</span>
              </div>
              <div v-if="searchSuggestions.length === 0" class="search-dropdown-empty">
                {{ searchQuery.trim() ? $t('errors.noData') : '' }}
              </div>
            </div>
          </div>

          <!-- 格子類型分頁 -->
            <div class="board-pagination">
              <button
                v-for="cellType in cellTypes"
                :key="cellType"
                class="page-btn"
                :class="{ active: boardStore.currentCellType === cellType }"
                @click="boardStore.currentCellType = cellType"
              >
                {{ $t(`cellTypes.${cellType}`) }}
              </button>
            </div>

            <!-- 格子類型標題 -->
            <CellTypeHeader
              :cell-type="boardStore.currentCellType"
              :activated="cellStats.activated"
              :total="cellStats.total"
            />

            <!-- 角色網格 -->
            <div class="board-grid">
              <CharacterCard
                v-for="char in filteredCharacters"
                :key="char.name"
                :character="char"
                :cell-type="boardStore.currentCellType"
                @click="handleCharacterClick(char)"
                @right-click="handleCharacterRightClick($event)"
              />
            </div>

            <!-- 格子類型底部統計 -->
            <CellTypeFooter
              :cell-type="boardStore.currentCellType"
              :activated="cellStats.activated"
              :total="cellStats.total"
            />
          </div>
        </section>

        <!-- 右側面板：統計 -->
        <aside class="panel insight-panel" :class="{ 'mobile-open': rightPanelOpen }">
          <div class="panel-header">
            <h3>{{ $t('board.statsPanel') }}</h3>
            <button 
              class="panel-close" 
              @click="rightPanelOpen = false"
              aria-label="關閉面板"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="panel-card">
            <OwnershipStats />
          </div>
          <div class="panel-card">
            <ResourceSummary />
          </div>
        </aside>
      </main>

      <!-- 手機端浮動按鈕 -->
      <div class="mobile-fab-group">
        <FloatingButton
          icon="layers"
          :label="$t('board.layerPanel')"
          :is-active="leftPanelOpen"
          @click="toggleLeftPanel"
        />
        <FloatingButton
          icon="stats"
          :label="$t('board.statsPanel')"
          :is-active="rightPanelOpen"
          @click="toggleRightPanel"
        />
      </div>

      <!-- 遮罩層（手機端） -->
      <div 
        v-if="leftPanelOpen || rightPanelOpen" 
        class="mobile-overlay"
        @click="closeAllPanels"
      ></div>

      <!-- 設置面板 -->
      <CharacterSettings v-model:show="showSettings" />

      <!-- 角色設定檔面板 -->
      <CharacterProfileModal
        v-if="profileCharacter"
        :character="profileCharacter"
        @close="closeProfile"
      />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useBoardStore } from '@/stores/board'
import AppLayout from '@/components/Layout/AppLayout.vue'
import LayerSummary from '@/components/Board/LayerSummary.vue'
import CharacterCard from '@/components/Board/CharacterCard.vue'
import CellTypeHeader from '@/components/Board/CellTypeHeader.vue'
import CellTypeFooter from '@/components/Board/CellTypeFooter.vue'
import OwnershipStats from '@/components/Board/OwnershipStats.vue'
import ResourceSummary from '@/components/Board/ResourceSummary.vue'
import CharacterSettings from '@/components/Board/CharacterSettings.vue'
import CharacterProfileModal from '@/components/Board/CharacterProfileModal.vue'
import FloatingButton from '@/components/Board/FloatingButton.vue'
import type { Character } from '@/stores/board'
import { getAssetUrl } from '@/utils/assets'
import { useI18n } from 'vue-i18n'
import { toast } from '@/utils/toast'

const boardStore = useBoardStore()
const { locale, t } = useI18n()
const showSettings = ref(false)
const leftPanelOpen = ref(false)
const rightPanelOpen = ref(false)
const profileCharacter = ref<Character | null>(null)
const searchQuery = ref('')
const searchRef = ref<HTMLElement | null>(null)
const searchFocused = ref(false)

const cellOrder = ['attack', 'crit', 'hp', 'critResist', 'defense']

const cellTypes = computed(() => {
  if (!boardStore.characters || boardStore.characters.length === 0) return cellOrder

  const query = searchQuery.value.trim().toLowerCase()

  const types = new Set<string>()
  boardStore.characters.forEach(char => {
    const boardTypes = char.boardTypes?.[boardStore.currentLayer]
    if (!boardTypes || boardTypes.length === 0) return

    if (query) {
      const nameMatch = char.name.toLowerCase().includes(query)
      const enMatch = char.en.toLowerCase().includes(query)
      if (!nameMatch && !enMatch) return
    }

    boardTypes.forEach(t => types.add(t))
  })

  if (types.size === 0) return []
  return cellOrder.filter(t => types.has(t))
})

const filteredCharacters = computed(() => {
  if (!boardStore.characters || boardStore.characters.length === 0) return []
  
  const query = searchQuery.value.trim().toLowerCase()

  let chars = boardStore.characters.filter(char => {
    const boardTypes = char.boardTypes?.[boardStore.currentLayer]
    if (!boardTypes || boardTypes.length === 0) return false

    if (query) {
      const nameMatch = char.name.toLowerCase().includes(query)
      const enMatch = char.en.toLowerCase().includes(query)
      return nameMatch || enMatch
    }

    return boardTypes.includes(boardStore.currentCellType)
  })

  if (query) {
    chars.sort(sortBySearchRank(query))
  }

  return chars
})

const cellStats = computed(() => {
  const total = filteredCharacters.value.length
  let activated = 0
  
  filteredCharacters.value.forEach(char => {
    const cellKey = `${char.name}_${boardStore.currentLayer}_${boardStore.currentCellType}`
    if (boardStore.userProgress.activatedCells[cellKey] === true) {
      activated++
    }
  })
  
  return { total, activated }
})

const searchSuggestions = computed(() => {
  if (!searchQuery.value.trim() || !boardStore.characters) return []

  const query = searchQuery.value.trim().toLowerCase()

  return boardStore.characters
    .filter(char => {
      const boardTypes = char.boardTypes?.[boardStore.currentLayer]
      if (!boardTypes || boardTypes.length === 0) return false
      const nameMatch = char.name.toLowerCase().includes(query)
      const enMatch = char.en.toLowerCase().includes(query)
      return nameMatch || enMatch
    })
    .sort(sortBySearchRank(query))
    .slice(0, 3)
})

const showSearchDropdown = computed(() =>
  searchFocused.value && searchQuery.value.trim().length > 0
)

function onSearchFocus(e: Event) {
  searchFocused.value = true
  ;(e.target as HTMLInputElement)?.select()
}

function onSearchBlur() {
  setTimeout(() => { searchFocused.value = false }, 200)
}

function closeSearchDropdown() {
  searchFocused.value = false
  ;(searchRef.value?.querySelector('input') as HTMLInputElement)?.blur()
}

function displayCharName(char: Character): string {
  return locale.value.startsWith('zh') ? char.name : char.en
}

function handleSearchEnter() {
  const first = searchSuggestions.value[0]
  if (!first) return
  searchQuery.value = displayCharName(first)
  searchFocused.value = false
  profileCharacter.value = first
}

function selectSearchResult(char: Character) {
  searchQuery.value = displayCharName(char)
  searchFocused.value = false
}

function sortBySearchRank(query: string) {
  const q = query.toLowerCase()
  return (a: Character, b: Character): number => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    const ae = a.en.toLowerCase()
    const be = b.en.toLowerCase()

    const ra = an.startsWith(q) ? 0 : ae.startsWith(q) ? 1 : an.includes(q) ? 2 : ae.includes(q) ? 3 : 4
    const rb = bn.startsWith(q) ? 0 : be.startsWith(q) ? 1 : bn.includes(q) ? 2 : be.includes(q) ? 3 : 4
    return ra - rb
  }
}

function handleCharacterClick(char: Character) {
  boardStore.toggleCellActivation(char, boardStore.currentCellType)
}

function handleCharacterRightClick(char: Character) {
  profileCharacter.value = char
}

function closeProfile() {
  profileCharacter.value = null
  searchQuery.value = ''
  nextTick(() => searchRef.value?.querySelector('input')?.focus())
}

function toggleLeftPanel() {
  leftPanelOpen.value = !leftPanelOpen.value
  if (leftPanelOpen.value) {
    rightPanelOpen.value = false
  }
}

function toggleRightPanel() {
  rightPanelOpen.value = !rightPanelOpen.value
  if (rightPanelOpen.value) {
    leftPanelOpen.value = false
  }
}

function closeAllPanels() {
  leftPanelOpen.value = false
  rightPanelOpen.value = false
}

onMounted(async () => {
  await boardStore.loadGameData()
  boardStore.loadUserProgress()
  if (boardStore.progressError) {
    toast.warning(t('board.progressLoadError'))
  }
})


</script>

<style scoped>
.board-root {
  position: relative;
  min-height: calc(100vh - 140px);
}

.with-background {
  position: relative;
}

.background-image {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: -2;
  opacity: 0.3;
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

.board-layout {
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem;
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: 2rem;
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
}

.layer-panel,
.insight-panel {
  position: sticky;
  top: 90px;
  height: fit-content;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.layer-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-btn {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.panel-card {
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.panel-card:last-child {
  margin-bottom: 0;
}

.board-stage {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 2rem;
  backdrop-filter: blur(10px);
}

.board-stage-header {
  margin-bottom: 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.board-stage-header h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--button-bg, rgba(0, 0, 0, 0.03));
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.settings-btn:hover {
  background: var(--button-hover, rgba(0, 0, 0, 0.08));
  border-color: var(--primary-color);
}

.board-pagination {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.page-btn {
  padding: 0.75rem 1.5rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.page-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.page-btn.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.board-stage-body {
  overflow: visible;
}

.board-search {
  position: relative;
  margin-bottom: 1rem;
}

.search-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  border-color: var(--primary-color);
}

.search-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-bottom: 4px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  z-index: 100;
  max-height: 150px;
  overflow-y: auto;
}

.search-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  transition: background 0.15s;
}

.search-dropdown-item:hover {
  background: var(--hover-bg);
}

.search-dropdown-item:first-child {
  border-radius: 8px 8px 0 0;
}

.search-dropdown-item:last-child {
  border-radius: 0 0 8px 8px;
}

.dropdown-name {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-weight: 500;
}

.dropdown-en {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.search-dropdown-empty {
  padding: 0.875rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.board-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
}

/* 手機端浮動按鈕組 */
.mobile-fab-group {
  position: fixed;
  bottom: 2rem;
  right: 1rem;
  display: none;
  flex-direction: column;
  gap: 1rem;
  z-index: 1000;
}

.mobile-overlay {
  display: none;
}

.panel-header {
  display: none;
}

.panel-close {
  display: none;
}

@media (max-width: 1200px) {
  .board-layout {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .layer-panel,
  .insight-panel {
    position: static;
    max-height: none;
  }
}

@media (max-width: 768px) {
  .board-layout {
    padding: 1rem;
    gap: 1rem;
    grid-template-columns: 1fr;
  }

  /* 隱藏側邊欄，改為抽屜式 */
  .layer-panel,
  .insight-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 85%;
    max-width: 320px;
    height: 100vh;
    max-height: none;
    z-index: 1001;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
    padding: 1rem;
  }

  .layer-panel {
    left: 0;
  }

  .insight-panel {
    right: 0;
    left: auto;
    transform: translateX(100%);
  }

  .layer-panel.mobile-open {
    transform: translateX(0);
  }

  .insight-panel.mobile-open {
    transform: translateX(0);
  }

  /* 面板標題 */
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: var(--hover-bg);
    color: var(--text-secondary);
    transition: all 0.2s;
  }

  .panel-close:hover {
    background: var(--secondary-hover);
    color: var(--text-primary);
  }

  /* 顯示浮動按鈕 */
  .mobile-fab-group {
    display: flex;
  }

  /* 遮罩層 */
  .mobile-overlay {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    animation: fadeIn 0.3s ease;
  }

  .board-stage {
    padding: 1rem;
  }

  .board-stage-header h2 {
    font-size: 1.25rem;
  }

  .layer-tabs {
    gap: 0.5rem;
  }

  .tab-btn {
    padding: 0.75rem;
  }

  .panel-card {
    padding: 1rem;
  }

  .board-pagination {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .page-btn {
    padding: 0.75rem;
    font-size: 0.875rem;
  }

  .board-grid {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 0.75rem;
  }
}

@media (max-width: 480px) {
  .board-root {
    min-height: calc(100vh - 60px);
  }

  .board-layout {
    padding: 0.75rem;
    gap: 0.75rem;
  }

  .board-stage {
    padding: 0.75rem;
    border-radius: 12px;
  }

  .layer-panel,
  .insight-panel {
    width: 90%;
    max-width: 300px;
    padding: 0.875rem;
  }

  .board-stage-header {
    margin-bottom: 1rem;
  }

  .board-stage-header h2 {
    font-size: 1.125rem;
  }

  .board-pagination {
    margin-bottom: 1rem;
    grid-template-columns: 1fr 1fr;
  }

  .page-btn {
    padding: 0.625rem;
    font-size: 0.8125rem;
  }

  .board-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .tab-btn {
    padding: 0.625rem;
    font-size: 0.8125rem;
  }

  .mobile-fab-group {
    bottom: 1.5rem;
    right: 0.75rem;
    gap: 0.75rem;
  }

  .panel-header h3 {
    font-size: 1rem;
  }

  .panel-card {
    padding: 0.875rem;
  }
}
</style>

