import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

interface VersionInfo {
  version: string
  buildTime: number
  commit: string
}

const LS_KEY = 'trickcal-app-version'
const LS_DISMISSED = 'trickcal-app-version-dismissed'
const POLL_INTERVAL = 300_000

export function useVersionCheck() {
  const router = useRouter()
  const updateAvailable = ref(false)
  const currentVersion = ref<VersionInfo | null>(null)
  let intervalId: ReturnType<typeof setInterval> | null = null
  let removeGuard: (() => void) | null = null

  function dismiss() {
    if (currentVersion.value) {
      try {
        localStorage.setItem(LS_DISMISSED, String(currentVersion.value.buildTime))
      } catch {}
    }
    updateAvailable.value = false
  }

  async function checkVersion() {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`)
      if (!res.ok) return
      const remote: VersionInfo = await res.json()
      currentVersion.value = remote

      const stored = Number(localStorage.getItem(LS_KEY) || '0')
      const dismissed = Number(localStorage.getItem(LS_DISMISSED) || '0')

      if (stored === 0) {
        localStorage.setItem(LS_KEY, String(remote.buildTime))
        return
      }

      if (remote.buildTime > stored && remote.buildTime > dismissed) {
        updateAvailable.value = true
      }
    } catch {
      // network error, skip
    }
  }

  onMounted(() => {
    checkVersion()
    intervalId = setInterval(checkVersion, POLL_INTERVAL)
    removeGuard = router.afterEach(checkVersion)
  })

  onUnmounted(() => {
    if (intervalId) clearInterval(intervalId)
    if (removeGuard) removeGuard()
  })

  return { updateAvailable, currentVersion, dismiss, checkVersion }
}
