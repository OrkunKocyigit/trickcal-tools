<template>
  <div id="app" :data-theme="theme">
    <UpdateBanner
      :update-available="updateAvailable"
      @dismiss="dismiss"
      @refresh="refresh"
    />
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { usePwaUpdate } from '@/composables/usePwaUpdate'
import UpdateBanner from '@/components/UpdateBanner.vue'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.currentTheme)

const { updateAvailable, refresh, dismiss } = usePwaUpdate()
</script>

<style>
/* 全域樣式將在 styles/main.css 中定義 */
</style>

