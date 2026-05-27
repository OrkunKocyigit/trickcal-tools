<template>
  <Transition name="banner-slide">
    <div v-if="visible" class="update-banner">
      <span class="update-banner__text">
        <span class="update-banner__icon">📦</span>
        {{ $t('updateBanner.available') }}
      </span>
      <div class="update-banner__actions">
        <button class="update-banner__refresh-btn" @click="refresh">
          {{ $t('updateBanner.refresh') }}
        </button>
        <button class="update-banner__dismiss-btn" @click="onDismiss" aria-label="Dismiss">
          &times;
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  updateAvailable: boolean
}>()

const emit = defineEmits<{
  dismiss: []
  refresh: []
}>()

const visible = computed(() => props.updateAvailable)

function refresh() {
  emit('refresh')
}

function onDismiss() {
  emit('dismiss')
}
</script>

<style scoped>
.update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.625rem 1rem;
  background: var(--primary-color, #4f46e5);
  color: #fff;
  font-size: 0.875rem;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.update-banner__text {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.update-banner__icon {
  font-size: 1rem;
}

.update-banner__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.update-banner__refresh-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 0.2s;
}

.update-banner__refresh-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.update-banner__dismiss-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1.25rem;
  cursor: pointer;
  transition: color 0.2s;
}

.update-banner__dismiss-btn:hover {
  color: #fff;
}

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.banner-slide-enter-from,
.banner-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
