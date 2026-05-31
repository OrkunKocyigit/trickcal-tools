import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { Logger } from '@/utils/logger'

// 樣式
import './styles/main.css'

// 請求持久化存儲，減少瀏覽器清除 localStorage 的風險
if (navigator.storage?.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      Logger.info('Persistent storage granted')
    } else {
      Logger.warn('Persistent storage denied — data may be evicted')
    }
  }).catch(() => {
    Logger.warn('Failed to request persistent storage')
  })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')

