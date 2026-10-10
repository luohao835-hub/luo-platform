import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const baseApi = env.VITE_APP_BASE_API || '/dev-api'
  const httpTarget = env.VITE_APP_HTTP_SERVICE_URL || 'http://192.168.0.208:10086'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      proxy: {
        [baseApi]: {
          target: httpTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^${baseApi}`), ''),
        },
      },
    },
  }
})
