import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

export function usePwaUpdate() {
  const updateAvailable = ref(false)

  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      updateAvailable.value = true
    },
    onOfflineReady() {},
  })

  function refresh() {
    updateServiceWorker(true)
  }

  function dismiss() {
    updateAvailable.value = false
  }

  return { updateAvailable, refresh, dismiss }
}
