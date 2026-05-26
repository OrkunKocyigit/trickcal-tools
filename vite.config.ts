import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { compression } from 'vite-plugin-compression2'

export default defineConfig({
  base: process.env.VITE_DEPLOY_TARGET === 'gh-pages' ? '/trickcal-tools/' : '/',
  plugins: [
    vue(),
    compression({
      algorithms: ['gzip', 'brotliCompress'],
      threshold: 10240,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          const n = id.replace(/\\/g, '/')
          if (
            n.includes('/node_modules/vue/') ||
            n.includes('/node_modules/pinia/') ||
            n.includes('/node_modules/vue-router/')
          ) return 'vue-vendor'
          if (n.includes('/node_modules/vue-i18n/')) return 'i18n-vendor'
        },
        minify: {
          compress: {
            dropConsole: true,
            dropDebugger: true,
          }
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.match(/\.(png|jpe?g|svg|gif|webp)$/)) {
            return 'assets/[name]-[hash][extname]'
          }
          if (assetInfo.name?.match(/\.(woff2?|eot|ttf|otf)$/)) {
            return 'assets/fonts/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    }
  },
  server: {
    port: 3000,
    host: true,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none'
    }
  }
})
