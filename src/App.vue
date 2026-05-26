<template>
  <div id="app" :data-theme="theme">
    <UpdateBanner
      :update-available="updateAvailable"
      @dismiss="dismiss"
    />
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { useVersionCheck } from '@/composables/useVersionCheck'
import UpdateBanner from '@/components/UpdateBanner.vue'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.currentTheme)

const { updateAvailable, dismiss } = useVersionCheck()
</script>

<style>
/* 全域樣式將在 styles/main.css 中定義 */
</style>

